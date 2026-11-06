/**
 * 电子公章（2026-11-05 用户定案）：对外单据（出运自制单据经 fulfillment.documents.issue 签发；PI / SC 经 order.document.generate 生成）可加盖公司印章。
 *
 * - 公司管理员（canMaintainCompany，同 settings.update）上传印章图片、指定用印人（seal.save），可停用（seal.disable）；停用后不能再用，历史保留。
 * - 用印人签发时选章并填写用途，系统按单据冻结快照重新渲染 PDF，把印章叠在出具方签字区；每次使用登记 sealUses（谁、何时、哪份单据、用途）。
 *   非用印人签发的单据不盖章；草稿从不盖章；Agent 不能管理也不能使用印章。
 * - 印章图片只给公司管理员和该章用印人读取（读投影与文件下载都按此裁剪，见 projectSeals / server/src/mist/access.ts）；
 *   印章图片文件不能被其他业务记录引用（仓储层拒绝），保存印章时也不能借用已被其他记录引用的文件。
 * - 渲染与写文件在仓储层（server/src/mist/repository.ts）完成：印章图片以 data URI 进入渲染输入，图片字节不写入状态。
 */
import { MistCommandError, type MistContext, type MistState } from './mistWorkspace';
import type { GeneratedDocArtifact, GeneratedDocRecord, GeneratedDocSnapshot } from './mistGeneratedDocument';
import type { FulfillmentDocument } from './mistFulfillment';
import { generatedDocFingerprint } from './mistGeneratedDocument';
import { resolveMember } from './mistAccounts';
import { decisionSignatureVisible } from './mistSignatures';

export type MistSealKind = 'company' | 'contract' | 'finance' | 'customs' | 'other';
export const SEAL_KINDS: readonly MistSealKind[] = ['company', 'contract', 'finance', 'customs', 'other'];
export type MistSeal = {
  id: string; name: string; kind: MistSealKind;
  /** 印章图片（PNG）；只给公司管理员与用印人，其他人的投影里省略。 */
  fileId?: string;
  userIds: string[]; status: 'active' | 'disabled';
  createdAt: string; createdBy: string; updatedAt: string;
  disabledAt?: string; disabledBy?: string; disabledReason?: string;
};
export type MistSealUse = {
  id: string; sealId: string; sealName: string;
  /** 单据类型：出运自制单据类型（CI、PL…）或 PI / SC。 */
  documentKind: string; documentId: string; documentNumber: string;
  /** 盖章后的 PDF；看不到该单据的人的投影里省略。 */
  fileId?: string;
  actorId: string; actor: string; at: string; reason: string;
};
export type SealCommand =
  | { type: 'seal.save'; payload: { id?: string; name: string; kind: MistSealKind; fileId: string; userIds: string[] } }
  | { type: 'seal.disable'; payload: { id: string; reason: string } };
export const SEAL_COMMANDS: readonly string[] = ['seal.save', 'seal.disable'];
/** 可以盖章的命令及其可选字段。 */
export const SEALABLE_COMMANDS: readonly string[] = ['fulfillment.documents.issue', 'order.document.generate'];
/** 只收 PNG：上传的 SVG 可以携带脚本或外部引用，而印章图片会原样进入 PDF 渲染。 */
export const SEAL_IMAGE_MIME_TYPES: readonly string[] = ['image/png'];
export const SEAL_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const SEAL_REASON_MAX = 200;
/** 公司维护动作，与 settings.update 同一门槛（COMPANY_MAINTAIN_SCOPE）；仓储层对本机空间另限所有者。 */
export const sealCommandPermission = (_command: SealCommand) => 'users:write';

/** 盖章渲染结果：仓储层渲染并写入私有文件后放入命令上下文，领域层核对后落账。 */
export type MistSealStamp = { sealId: string; reason: string; documentId?: string; baseRecordId?: string; artifact?: GeneratedDocArtifact; fileId?: string };
type SealContext = MistContext & { sealStamp?: MistSealStamp; generatedDocument?: GeneratedDocArtifact };
type GeneratedDocument = FulfillmentDocument & { sealUseId?: string };

const fail = (message: string, code = 'PRECONDITION', status = code === 'NOT_FOUND' ? 404 : code === 'FORBIDDEN' ? 403 : code === 'CONFLICT' ? 409 : 422): never => { throw new MistCommandError(code, message, status); };
const text = (value: unknown, label: string, max: number) => typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : fail(`${label}未填写或超过 ${max} 字`, 'VALIDATION');

export const sealsOf = (root: MistState): MistSeal[] => (root.seals ??= []);
export const sealUsesOf = (root: MistState): MistSealUse[] => (root.sealUses ??= []);
/** 被任一印章（含已停用）引用的图片文件。 */
export const sealFileIds = (root: Pick<MistState, 'seals'>): Set<string> => new Set((root.seals || []).map(seal => seal.fileId).filter((id): id is string => !!id));

/** 文件是否被印章以外的业务记录引用（精确匹配附件 ID）。 */
function referencedOutsideSeals(root: MistState, fileId: string): boolean {
  let found = false;
  const walk = (value: unknown): void => {
    if (found) return;
    if (typeof value === 'string') { if (value === fileId) found = true; return; }
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk({ ...root, files: [], seals: [] });
  return found;
}

export function applySealCommand(root: MistState, command: SealCommand, ctx: MistContext): { id: string } {
  if (ctx.viaAgent) fail('Agent 不能管理印章', 'FORBIDDEN');
  if (!ctx.actorId) fail('缺少真实经办人');
  const seals = sealsOf(root), p = command.payload as Record<string, unknown>;
  if (!p || typeof p !== 'object') fail('印章格式无效', 'VALIDATION');
  if (command.type === 'seal.save') {
    if (Object.keys(p).some(key => !['id', 'name', 'kind', 'fileId', 'userIds'].includes(key))) fail('印章字段无效', 'VALIDATION');
    const name = text(p.name, '印章名称', 60);
    if (!SEAL_KINDS.includes(p.kind as MistSealKind)) fail('印章类别无效', 'VALIDATION');
    const fileId = typeof p.fileId === 'string' ? p.fileId : fail('请上传印章图片', 'VALIDATION');
    const file = root.files.find(f => f.id === fileId) || fail('印章图片不存在', 'NOT_FOUND');
    if (!SEAL_IMAGE_MIME_TYPES.includes(file.mimeType) || file.size > SEAL_IMAGE_MAX_BYTES) fail('印章图片须为不超过 2 MB 的透明底 PNG', 'VALIDATION');
    if (!Array.isArray(p.userIds) || !p.userIds.length || p.userIds.length > 50) fail('请指定 1–50 名用印人', 'VALIDATION');
    const users = [...new Set(p.userIds as unknown[])].map(id => resolveMember(ctx, id, '用印人'));
    const existing = typeof p.id === 'string' && p.id ? seals.find(s => s.id === p.id) || fail('印章不存在', 'NOT_FOUND') : undefined;
    if (existing?.status === 'disabled') fail('已停用的印章不能修改');
    if (existing && existing.fileId !== fileId) fail('更换印章图片请停用原章后新建');
    if (!existing && seals.some(s => s.fileId === fileId)) fail('该图片已用于其他印章', 'CONFLICT');
    if (!existing && referencedOutsideSeals(root, fileId)) fail('该文件已用于其他业务，请重新上传印章图片', 'CONFLICT');
    if (seals.some(s => s.id !== existing?.id && s.status === 'active' && s.name === name)) fail('已有同名的在用印章', 'CONFLICT');
    const userIds = users.map(u => u.id);
    if (existing) {
      const added = users.filter(u => !existing.userIds.includes(u.id)).map(u => u.name), removed = existing.userIds.filter(id => !userIds.includes(id)).length;
      Object.assign(existing, { name, kind: p.kind, userIds, updatedAt: ctx.now });
      event(root, ctx, existing.id, `修改印章「${name}」${added.length ? ' · 新增用印人 ' + added.join('、') : ''}${removed ? ` · 移除 ${removed} 名用印人` : ''}`);
      return { id: existing.id };
    }
    const seal: MistSeal = { id: ctx.id(), name, kind: p.kind as MistSealKind, fileId, userIds, status: 'active', createdAt: ctx.now, createdBy: ctx.actorName, updatedAt: ctx.now };
    seals.push(seal);
    event(root, ctx, seal.id, `启用印章「${name}」· 用印人 ${users.map(u => u.name).join('、')}`);
    return { id: seal.id };
  }
  if (Object.keys(p).some(key => !['id', 'reason'].includes(key))) fail('印章字段无效', 'VALIDATION');
  const seal = seals.find(s => s.id === p.id) || fail('印章不存在', 'NOT_FOUND');
  if (seal.status === 'disabled') fail('印章已停用', 'CONFLICT');
  const reason = text(p.reason, '停用原因', SEAL_REASON_MAX);
  Object.assign(seal, { status: 'disabled', disabledAt: ctx.now, disabledBy: ctx.actorName, disabledReason: reason, updatedAt: ctx.now });
  event(root, ctx, seal.id, `停用印章「${seal.name}」· ${reason}`);
  return { id: seal.id };
}
const event = (root: MistState, ctx: MistContext, entityId: string, message: string, entityType = 'workspace') =>
  root.events.unshift({ id: ctx.id(), entityType, entityId, actor: ctx.actorName, at: ctx.auditNow ?? ctx.now, text: message, fileIds: [] });

/** 命令是否请求盖章（带 sealId 或 sealReason）。 */
export const requestsSeal = (command: { type: string; payload?: any }) => SEALABLE_COMMANDS.includes(command?.type) && !!command.payload && typeof command.payload === 'object' && (command.payload.sealId !== undefined || command.payload.sealReason !== undefined);
/** 去掉盖章字段后的原命令（交给原有领域处理与快照生成）。 */
export function withoutSeal<T extends { type: string; payload?: any }>(command: T): T {
  const { sealId: _s, sealReason: _r, ...payload } = command.payload || {};
  return { ...command, payload } as T;
}
/** 系统生成的、尚未盖章的最新版本（盖章依据的冻结快照）。 */
function baseRecord(d: GeneratedDocument): GeneratedDocRecord | undefined {
  const base = (d.generated || []).filter(g => !g.sealUseId).at(-1);
  if (!base) return undefined;
  const current = new Set(d.fileIds);
  // 草稿当前文件须仍是该版本（或其盖章件，财务退回后重新签发的情形）；人工换成其他文件的草稿不能按旧快照盖章。
  const stillCurrent = current.has(base.fileId) || (d.generated || []).some(g => g.sealUseId && current.has(g.fileId) && g.snapshotFingerprint === base.snapshotFingerprint);
  return stillCurrent ? base : undefined;
}

/**
 * 不盖章签发时：草稿当前文件若是之前的盖章件（财务退回后重新签发），换回同一快照的未盖章版本，避免非用印人签出带章单据。
 */
export function unsealDraft(root: MistState, documentId: unknown) {
  const d = root.fulfillment?.documents?.find(x => x.id === documentId) as GeneratedDocument | undefined;
  if (!d || d.status !== 'draft' || !d.generated?.some(g => g.sealUseId)) return;
  const stamped = new Map(d.generated.filter(g => g.sealUseId).map(g => [g.fileId, g]));
  if (!d.fileIds.some(id => stamped.has(id))) return;
  d.fileIds = d.fileIds.flatMap(id => {
    const g = stamped.get(id); if (!g) return [id];
    const base = d.generated!.filter(x => !x.sealUseId && x.snapshotFingerprint === g.snapshotFingerprint).at(-1);
    return base ? [base.fileId] : [];
  });
  delete d.sealUseId;
}

export type SealPlan = { seal: MistSeal; reason: string; snapshot?: GeneratedDocSnapshot; documentId?: string; baseRecordId?: string };
/**
 * 盖章前置核对（仓储渲染前与领域落账时各执行一次）：印章在用、当前账号是用印人、用途已填写、单据是系统生成的待签发草稿。
 */
export function prepareSeal(root: MistState, command: { type: string; payload?: any }, ctx: Pick<MistContext, 'actorId' | 'viaAgent'>): SealPlan {
  if (ctx.viaAgent) fail('Agent 不能使用印章', 'FORBIDDEN');
  const p = command.payload || {};
  const sealId = typeof p.sealId === 'string' && p.sealId ? p.sealId : fail('请选择印章', 'VALIDATION');
  const reason = text(p.sealReason, '用印用途', SEAL_REASON_MAX);
  const seal = (root.seals || []).find(s => s.id === sealId) || fail('印章不存在', 'NOT_FOUND');
  if (seal.status !== 'active') fail('印章已停用，不能使用');
  if (!ctx.actorId || !seal.userIds.includes(ctx.actorId)) fail('当前账号不是该印章的用印人', 'FORBIDDEN');
  if (command.type === 'order.document.generate') return { seal, reason };
  if (command.type !== 'fulfillment.documents.issue') fail('该操作不能盖章', 'VALIDATION');
  const d = root.fulfillment.documents.find(x => x.id === p.id) as GeneratedDocument | undefined;
  if (!d) fail('单据不存在', 'NOT_FOUND');
  if (d!.status !== 'draft') fail('仅草稿可签发');
  const base = baseRecord(d!);
  if (!base) fail('只有系统生成的单据可以盖章；上传或改换文件的单据请不选印章签发');
  if (generatedDocFingerprint(base!.snapshot) !== base!.snapshotFingerprint) fail('单据快照无法核验，请重新生成后签发');
  return { seal, reason, snapshot: structuredClone(base!.snapshot), documentId: d!.id, baseRecordId: base!.id };
}

/**
 * 盖章命令：先核对印章与单据，去掉盖章字段执行原命令，成功后把盖章件挂到单据并登记用印记录。
 * 渲染好的盖章件由仓储放在 ctx.sealStamp；缺失或与本次请求不符一律拒绝。
 */
export function applySealedCommand<R extends Record<string, unknown>>(root: MistState, command: { type: string; payload?: any }, ctx: MistContext, run: (state: MistState, command: any) => { state: MistState; result: R }): { state: MistState; result: R } {
  const plan = prepareSeal(root, command, ctx), stamp = (ctx as SealContext).sealStamp;
  if (!stamp || stamp.sealId !== plan.seal.id || stamp.reason !== plan.reason) fail('盖章单据须由服务端生成');
  if (command.type === 'fulfillment.documents.issue') {
    const artifact = stamp!.artifact;
    if (!artifact || stamp!.documentId !== plan.documentId || stamp!.baseRecordId !== plan.baseRecordId || artifact.record.fileId !== artifact.file.id) fail('盖章单据须由服务端生成');
    const base = (root.fulfillment.documents.find(x => x.id === plan.documentId) as GeneratedDocument).generated!.find(g => g.id === plan.baseRecordId)!;
    if (artifact!.record.snapshotFingerprint !== base.snapshotFingerprint || generatedDocFingerprint(artifact!.record.snapshot) !== base.snapshotFingerprint) fail('盖章单据与草稿快照不一致');
    if (root.files.some(f => f.id === artifact!.file.id)) fail('盖章单据已归档', 'CONFLICT');
  }
  const out = run(root, withoutSeal(command)), state = out.state;
  const use: MistSealUse = { id: ctx.id(), sealId: plan.seal.id, sealName: plan.seal.name, documentKind: '', documentId: '', documentNumber: '', fileId: '', actorId: ctx.actorId!, actor: ctx.actorName, at: ctx.auditNow ?? ctx.now, reason: plan.reason };
  if (command.type === 'fulfillment.documents.issue') {
    const artifact = stamp!.artifact!, d = state.fulfillment.documents.find(x => x.id === plan.documentId) as GeneratedDocument;
    const generatedIds = new Set((d.generated || []).map(g => g.fileId));
    state.files.push(structuredClone(artifact.file) as MistState['files'][number]);
    d.fileIds = [...d.fileIds.filter(id => !generatedIds.has(id)), artifact.file.id];
    d.generated = [...(d.generated || []), { ...structuredClone(artifact.record), sealUseId: use.id }];
    d.sealUseId = use.id;
    Object.assign(use, { documentKind: d.type, documentId: d.id, documentNumber: d.number, fileId: artifact.file.id });
    event(state, ctx, d.id, `加盖「${plan.seal.name}」签发 ${d.number} · ${plan.reason}`, 'document');
  } else {
    const generated = (ctx as SealContext).generatedDocument;
    const order = state.orders.find(o => o.id === command.payload.orderId) as (MistState['orders'][number] & { documents?: Array<GeneratedDocRecord & { orderKind: string }> }) | undefined;
    const record = order?.documents?.at(-1);
    if (!generated || !record || record.fileId !== generated.file.id || record.fileId !== stamp!.fileId) fail('盖章单据须由服务端生成');
    record!.sealUseId = use.id;
    Object.assign(use, { documentKind: record!.orderKind, documentId: record!.id, documentNumber: record!.number, fileId: record!.fileId });
    event(state, ctx, order!.id, `加盖「${plan.seal.name}」生成 ${record!.number} · ${plan.reason}`, 'order');
  }
  sealUsesOf(state).push(use);
  return { state, result: { ...out.result, sealUseId: use.id } };
}

/**
 * 读投影：印章名称、类别、状态与用印人给全公司；印章图片只给公司管理员与该章用印人（Agent 一律不给）。
 * 用印记录：能看到所盖单据的人看完整记录；用印人、管理员与盖章人本人看到不含文件的记录；其他人不下发。
 * 决定签字：签字人本人与能看到所签业务记录的人。返回本次读者不能读取的印章图片文件。
 */
export function projectSeals(full: MistState, next: MistState, actorId: string, maintainer: boolean, agent: boolean): Set<string> {
  const hidden = new Set<string>();
  const imageAllowed = (seal: MistSeal) => !agent && (maintainer || seal.userIds.includes(actorId));
  if (full.seals) next.seals = full.seals.map(seal => {
    if (imageAllowed(seal)) return { ...seal, userIds: [...seal.userIds] };
    if (seal.fileId) hidden.add(seal.fileId);
    const { fileId: _file, ...rest } = seal;
    return { ...rest, userIds: [...seal.userIds] };
  });
  if (full.sealUses) {
    const docs = new Set([...(next.fulfillment?.documents || []).map(d => d.id), ...(next.orders || []).flatMap(o => ((o as { documents?: Array<{ id: string }> }).documents || []).map(d => d.id))]);
    const userOf = new Map((full.seals || []).map(seal => [seal.id, seal.userIds]));
    next.sealUses = full.sealUses.flatMap(use => {
      if (docs.has(use.documentId)) return [{ ...use }];
      if (maintainer || use.actorId === actorId || userOf.get(use.sealId)?.includes(actorId)) { const { fileId: _file, ...rest } = use; return [rest]; }
      return [];
    });
  }
  if (full.decisionSignatures) next.decisionSignatures = full.decisionSignatures.filter(row => decisionSignatureVisible(next, row, actorId));
  return hidden;
}
