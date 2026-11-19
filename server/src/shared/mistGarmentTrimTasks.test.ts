import { describe, expect, it } from 'vitest';
import { prepareTrimTaskNotice } from './mistGarmentTrimTasks';
import { applyMistCommand, createMistState, type MistCommand, type MistContext, type MistFile } from './mistWorkspace';
import { developmentNoticeContent } from './mistDevelopmentNotice';

function fixture() {
  let serial = 0;
  const ctx: MistContext = { id: () => 'trim-' + ++serial, now: '2026-11-18T04:00:00Z', actorName: '业务员', actorId: 'sales', can: () => true };
  let state = createMistState(ctx, 'empty');
  const run = (command: MistCommand, actor = ctx) => {
    const applied = applyMistCommand(state, command, actor);
    state = applied.state;
    return applied.result;
  };
  const addFile = (id: string, name: string, mimeType = 'text/plain'): MistFile => ({
    id, name, mimeType, createdAt: ctx.now, uploadedBy: 'sales', storageKey: 'company/' + id, size: 120,
  });
  state.files.push(addFile('requirement', '系绳规格.txt'), addFile('updated', '系绳修改要求.txt'), addFile('returned', '系绳确认.txt'));
  state.settings.companyProfile = { legalName: '测试公司', bankAccount: 'private-bank-data' } as NonNullable<typeof state.settings.companyProfile>;
  state.customers.push({ id: 'customer', name: '模拟客户', code: 'C', country: '', city: '', industry: '',
    owner: '业务员', ownerId: 'sales', grade: '', currency: 'USD', terms: '', incoterm: '', categories: '', creditLimit: 0, since: '' });
  const supplierId = String(run({ type: 'market.supplier.save', payload: { input: { name: '织带供应商', type: '辅料' } } }).id);
  const factory = String(run({ type: 'market.supplier.save', payload: { input: { name: '样衣工厂', type: '成衣加工' } } }).id);
  const development = () => run({ type: 'development.submit', payload: { values: {
    domain: 'garment', name: '连帽工装夹克', customer: 'customer', style: 'JK-1', season: 'SS27',
    category: '夹克', kind: 'new', requestType: 'design', fabric: '棉斜纹', color: '橄榄绿',
    target: '', sizeBase: 'M', goal: '抽绳穿入顺畅', factories: [factory], due: '2026-11-25', collaborators: [], sampleQuantity: 1,
  }, fileIds: [] } });
  const devId = String(development().devId), anotherId = String(development().devId);
  const versionId = state.devs.find(d => d.id === devId)!.currentVersionId!;
  const request = { devId, supplierId, contact: '王师傅', requirements: '直径4毫米，有色卡', quantity: '12.5', unit: '米', dueDate: '2026-11-24', fileIds: ['requirement'] };
  const taskId = String(run({ type: 'development.trimTask.save', payload: request }).id);
  const target = { devId, taskId };
  const result = { ...target, name: '棉编织抽绳', specification: '实测直径4.2 mm，棉芯，哑面', color: '橄榄绿', fileIds: ['returned'] };
  const usage = { devId, versionId, trimTaskId: taskId, position: '帽口', specification: result.specification,
    color: result.color, perPiece: '0.8', unit: '米', provider: 'company' as const, colorMode: 'specified' as const, colorReference: '' };
  const notice = (id: string) => {
    const snapshot = prepareTrimTaskNotice(state, target, ctx);
    return run({ type: 'development.trimTask.notice', payload: target }, {
      ...ctx, trimTaskNotice: { snapshot, file: addFile(id, snapshot.noticeNo + '.pdf', 'application/pdf') },
    });
  };
  return { ctx, run, taskId, anotherId, devId, versionId, target, usage, result, request, notice,
    state: () => state, dev: () => state.devs.find(d => d.id === devId)!, version: () => state.versions.find(v => v.id === versionId)! };
}

describe('lightweight supplier trim development', () => {
  it('requires the current supplier notice and freezes the actual result in the selected garment version', () => {
    const f = fixture();
    const otherFactories = structuredClone(f.state().versions.filter(version => version.id !== f.versionId));
    const before = f.state(), approve = { type: 'development.trimTask.confirm', payload: f.result } as const;
    expect(() => f.run(approve)).toThrow('请先生成');
    expect(() => f.run({ type: 'development.material.addDeveloped', payload: f.usage })).toThrow('已确认');
    expect(() => f.run({ type: 'development.trimTask.notice', payload: { ...f.target, devId: f.anotherId } })).toThrow('不属于');
    expect(() => f.run({ type: 'development.trimTask.notice', payload: f.target })).toThrow('服务端');
    expect(f.state()).toEqual(before);
    f.notice('notice-one');
    expect(() => f.notice('duplicate')).toThrow('已生成');
    f.run({ type: 'development.trimTask.save', payload: { ...f.request, ...f.target, requirements: '实测直径4.2毫米', fileIds: ['updated'] } });
    expect(() => f.run(approve)).toThrow('请先生成');
    f.notice('notice-two');
    expect(() => f.run(approve, { ...f.ctx, viaAgent: true })).toThrow('本人确认');
    f.run(approve);
    const task = f.dev().trimTasks![0];
    expect(task.confirmed).toMatchObject({ actorId: 'sales', specification: f.result.specification, fileIds: ['returned'] });
    expect(task.notices.map(row => row.snapshot.attachments.map(file => file.fileId))).toEqual([['requirement'], ['updated']]);
    expect(JSON.stringify(task.notices)).not.toContain('private-bank-data');
    f.run({ type: 'development.material.addDeveloped', payload: f.usage });
    const frozen = structuredClone(f.version().materialUses);
    expect(frozen?.[0]).toMatchObject({ nature: 'developed', trimTaskId: f.taskId, perPiece: '0.8', unit: '米',
      catalog: { specification: f.result.specification, name: f.result.name, fileIds: ['returned'] } });
    expect(developmentNoticeContent(f.state(), f.dev(), f.version()).materials?.[0]).toMatchObject({
      name: f.result.name, specification: f.result.specification, perPiece: '0.8', nature: '开发料',
    });
    const archive = f.run({ type: 'development.trimTask.catalog', payload: { ...f.target, sku: 'TR-CORD' } });
    expect(f.state().market.products.find(row => row.id === archive.productId)).toMatchObject({
      category: 'trimming', specification: f.result.specification, fileIds: ['returned'], unit: '米',
    });
    expect(() => f.run({ type: 'development.trimTask.catalog', payload: { ...f.target, sku: 'TR-CORD-2' } })).toThrow('已转档');
    expect(f.version().materialUses).toEqual(frozen);
    expect(f.state().versions.filter(version => version.id !== f.versionId)).toEqual(otherFactories);
    expect(f.state().fulfillment.stock).toEqual([]);
  });
});
