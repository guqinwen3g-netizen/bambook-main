import { isCalendarDay } from './mistBusinessClock';
import { developmentDomain } from './mistDevelopmentDomain';
import { applyMarketCommand } from './mistMarket';
import { stableJson } from './stableJson';
import { MistCommandError, type MistContext, type MistDev, type MistFile, type MistState } from './mistWorkspace';

type TrimRequest = { requirements: string; supplierId: string; contact: string; quantity: string; unit: string; dueDate: string; fileIds: string[] };
type TrimResult = { name: string; specification: string; color: string; fileIds: string[] };
type ConfirmedTrim = TrimResult & { at: string; by: string; actorId: string };
export type TrimNoticeContent = {
  title: string; devCode: string; devName: string; taskId: string; taskCode: string;
  issuer: Pick<NonNullable<MistState['settings']['companyProfile']>, 'legalName' | 'address' | 'phone'>;
  supplier: string; contact: string; quantity: string; unit: string; dueDate: string; requirements: string;
  attachments: Array<{ fileId: string; name: string }>;
};
export type TrimNoticeSnapshot = TrimNoticeContent & { noticeNo: string; generatedAt: string; generatedBy: string };
export type TrimNotice = { fileId: string; noticeNo: string; generatedAt: string; snapshot: TrimNoticeSnapshot };
export type TrimNoticeArtifact = { file: MistFile; snapshot: TrimNoticeSnapshot };
export type GarmentTrimTask = TrimRequest & {
  id: string; code: string; supplierName: string; notices: TrimNotice[];
  confirmed?: ConfirmedTrim; catalogProductId?: string;
};
export type GarmentTrimTaskCommand =
  | { type: 'development.trimTask.save'; payload: TrimRequest & { devId: string; taskId?: string } }
  | { type: 'development.trimTask.notice'; payload: { devId: string; taskId: string } }
  | { type: 'development.trimTask.confirm'; payload: TrimResult & { devId: string; taskId: string } }
  | { type: 'development.trimTask.catalog'; payload: { devId: string; taskId: string; sku: string } };

export function trimTaskChangeBlocker(dev: MistDev): string | null {
  if (developmentDomain(dev.values) !== 'garment') return '仅成衣开发可安排辅料任务';
  if (dev.closure || dev.billing?.request) return '当前开发案不能修改辅料任务';
  return null;
}

function text(value: unknown, label: string, max: number, required = true): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new MistCommandError('VALIDATION', label + '格式无效');
  }
  return value.trim();
}

function attachments(state: MistState, value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20 ||
      value.some(id => typeof id !== 'string' || !state.files.some(file => file.id === id))) {
    throw new MistCommandError('VALIDATION', '请选择本公司可用附件，最多20份');
  }
  return [...new Set<string>(value)];
}

function taskTarget(state: MistState, devId: string, taskId?: string) {
  const dev = state.devs.find(row => row.id === devId);
  if (!dev) throw new MistCommandError('NOT_FOUND', '开发案不存在', 404);
  const stop = trimTaskChangeBlocker(dev);
  if (stop) throw new MistCommandError('PRECONDITION', stop);
  const task = dev.trimTasks?.find(row => row.id === taskId);
  if (taskId !== undefined && !task) throw new MistCommandError('NOT_FOUND', '辅料任务不属于本开发案', 404);
  return { dev, task };
}

function noticeContent(state: MistState, dev: MistDev, task: GarmentTrimTask): TrimNoticeContent {
  const issuer = state.settings.companyProfile;
  if (!issuer?.legalName) throw new MistCommandError('PRECONDITION', '请先填写公司抬头');
  return {
    title: '辅料开发通知单', devCode: dev.code, devName: dev.name, taskId: task.id, taskCode: task.code,
    issuer: { legalName: issuer.legalName, address: issuer.address || '', phone: issuer.phone || '' },
    supplier: task.supplierName, contact: task.contact, quantity: task.quantity, unit: task.unit,
    dueDate: task.dueDate, requirements: task.requirements,
    attachments: task.fileIds.map(fileId => {
      const file = state.files.find(row => row.id === fileId);
      if (!file) throw new MistCommandError('PRECONDITION', '任务原件不可用，请核对附件');
      return { fileId, name: file.name };
    }),
  };
}

function snapshotContent(snapshot: TrimNoticeSnapshot): TrimNoticeContent {
  const { noticeNo: _no, generatedAt: _at, generatedBy: _by, ...content } = snapshot;
  return content;
}

export function trimNoticeCurrent(state: MistState, dev: MistDev, task: GarmentTrimTask): boolean {
  const notice = task.notices.at(-1);
  if (!notice || !state.settings.companyProfile?.legalName) return false;
  if (task.fileIds.some(id => !state.files.some(file => file.id === id))) return false;
  return stableJson(snapshotContent(notice.snapshot)) === stableJson(noticeContent(state, dev, task));
}

export function prepareTrimTaskNotice(state: MistState, input: { devId: string; taskId: string }, ctx: MistContext): TrimNoticeSnapshot {
  const { dev, task } = taskTarget(state, input.devId, input.taskId);
  if (!task || task.confirmed) throw new MistCommandError('PRECONDITION', '只能为待确认的辅料任务生成通知单');
  if (trimNoticeCurrent(state, dev, task)) throw new MistCommandError('PRECONDITION', '本次通知单已生成，请下载原件');
  return {
    ...noticeContent(state, dev, task),
    noticeNo: task.code + '-N' + String(task.notices.length + 1).padStart(2, '0'),
    generatedAt: ctx.now, generatedBy: ctx.actorName,
  };
}

function saveRequest(state: MistState, input: Extract<GarmentTrimTaskCommand, { type: 'development.trimTask.save' }>['payload'], dev: MistDev, prior: GarmentTrimTask | undefined, ctx: MistContext): GarmentTrimTask {
  if (!ctx.can?.('suppliers:read')) throw new MistCommandError('FORBIDDEN', '没有供应商资料读取权限', 403);
  if (prior?.confirmed) throw new MistCommandError('PRECONDITION', '已确认的辅料任务不能修改');
  const supplier = state.market.suppliers.find(row => row.id === input.supplierId && row.status === 'active');
  if (!supplier) throw new MistCommandError('PRECONDITION', '请选择在用供应商');
  const quantity = text(input.quantity, '数量', 24);
  if (!/^\d{1,9}(?:\.\d{1,4})?$/.test(quantity) || Number(quantity) <= 0) {
    throw new MistCommandError('VALIDATION', '数量须为正数，最多四位小数');
  }
  if (typeof input.dueDate !== 'string' || !isCalendarDay(input.dueDate)) {
    throw new MistCommandError('VALIDATION', '请选择有效交期');
  }
  return {
    id: prior?.id ?? ctx.id(), code: prior?.code ?? dev.code + '-TL' + String((dev.trimTasks?.length ?? 0) + 1).padStart(2, '0'),
    requirements: text(input.requirements, '开发要求', 3000), supplierId: supplier.id, supplierName: supplier.name,
    contact: text(input.contact, '联系人', 120, false), quantity, unit: text(input.unit, '单位', 24), dueDate: input.dueDate,
    fileIds: attachments(state, input.fileIds), notices: prior?.notices ?? [],
  };
}

export function applyGarmentTrimTask(state: MistState, command: GarmentTrimTaskCommand, ctx: MistContext) {
  const input = command.payload, { dev, task } = taskTarget(state, input.devId, input.taskId);
  let result: { id: string; devId: string; fileId?: string; productId?: string };
  let action: string;
  if (command.type === 'development.trimTask.save') {
    const updated = saveRequest(state, command.payload, dev, task, ctx);
    dev.trimTasks = task ? dev.trimTasks!.map(row => row.id === task.id ? updated : row) : [...(dev.trimTasks ?? []), updated];
    result = { id: updated.id, devId: dev.id };
    action = task ? '修改辅料任务' : '安排辅料任务';
  } else {
    if (!task) throw new MistCommandError('NOT_FOUND', '辅料任务不存在', 404);
    result = { id: task.id, devId: dev.id };
    switch (command.type) {
      case 'development.trimTask.notice': {
        const snapshot = prepareTrimTaskNotice(state, command.payload, ctx), artifact = ctx.trimTaskNotice;
        if (!artifact || stableJson(snapshot) !== stableJson(artifact.snapshot) ||
            artifact.file.mimeType !== 'application/pdf' || state.files.some(row => row.id === artifact.file.id)) {
          throw new MistCommandError('PRECONDITION', '辅料通知单须由服务端按本次任务生成');
        }
        state.files.push(artifact.file);
        task.notices.push({ fileId: artifact.file.id, noticeNo: snapshot.noticeNo, generatedAt: snapshot.generatedAt, snapshot });
        result.fileId = artifact.file.id;
        action = '生成辅料通知单';
        break;
      }
      case 'development.trimTask.confirm': {
        if (!ctx.actorId || ctx.viaAgent) throw new MistCommandError('FORBIDDEN', '须由业务员本人确认辅料', 403);
        if (task.confirmed) throw new MistCommandError('PRECONDITION', '辅料任务已确认');
        if (!trimNoticeCurrent(state, dev, task)) throw new MistCommandError('PRECONDITION', '请先生成当前要求的通知单');
        const { name, specification, color, fileIds } = command.payload;
        task.confirmed = {
          name: text(name, '辅料名称', 80), specification: text(specification, '最终规格', 500),
          color: text(color, '颜色', 100, false), fileIds: attachments(state, fileIds),
          at: ctx.now, by: ctx.actorName, actorId: ctx.actorId,
        };
        action = '确认辅料';
        break;
      }
      case 'development.trimTask.catalog': {
        const confirmed = task.confirmed;
        if (!confirmed) throw new MistCommandError('PRECONDITION', '请先确认辅料');
        if (task.catalogProductId) throw new MistCommandError('PRECONDITION', '该辅料已转档');
        if (!ctx.can?.('suppliers:read')) throw new MistCommandError('FORBIDDEN', '没有供应商资料读取权限', 403);
        const product = applyMarketCommand(state, {
          type: 'market.product.save', payload: { input: {
            sku: command.payload.sku, name: confirmed.name, category: 'trimming', season: '',
            supplierId: task.supplierId, supplierCode: '', composition: '', specification: confirmed.specification,
            color: confirmed.color, unit: task.unit, cost: '0', refPrice: '', currency: 'CNY',
            fileIds: confirmed.fileIds, note: '', sourceDevId: '', sourceVersionId: '',
          } },
        }, ctx);
        task.catalogProductId = product.id!;
        result.productId = task.catalogProductId;
        action = '确认辅料转档';
        break;
      }
    }
  }
  dev.updatedAt = ctx.now;
  state.events.unshift({
    id: ctx.id(), entityType: 'development', entityId: dev.id, at: ctx.now, actor: ctx.actorName,
    text: action, fileIds: result.fileId ? [result.fileId] : [],
  });
  return result;
}

export function trimTaskReadKeys(state: MistState, command: { type: string; payload: unknown }): string[][] {
  if (!command.type.startsWith('development.trimTask.')) return [];
  const input = (command as GarmentTrimTaskCommand).payload;
  const dev = state.devs.find(row => row.id === input.devId);
  if (!dev) return [];
  const task = dev.trimTasks?.find(row => row.id === input.taskId);
  const supplierId = 'supplierId' in input ? input.supplierId : task?.supplierId;
  return [
    ['k:devs', 'i:' + dev.id, 'k:trimTasks'], ['k:devs', 'i:' + dev.id, 'k:closure'],
    ['k:devs', 'i:' + dev.id, 'k:billing'], ['k:settings', 'k:companyProfile'],
    ...(supplierId ? [['k:market', 'k:suppliers', 'i:' + supplierId]] : []),
  ];
}
