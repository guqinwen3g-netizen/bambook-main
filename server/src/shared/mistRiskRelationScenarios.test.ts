import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, type MistCommand, type MistContext } from './mistWorkspace';
import { getRiskReviews, pendingEscalation, riskSignals } from './mistRisk';
import { heldShipmentRelease, relationHoldReason } from './mistRelationHold';
import { supplierStatusOn } from './mistSupplierStatus';

function fixture() {
  let n = 0;
  const ctx: MistContext = { id: () => `scenario-${++n}`, now: '2026-10-14T02:00:00.000Z', actorId: 'sales', actorName: '业务员', members: [{ id: 'sales', name: '业务员', active: true, groups: ['fabric', 'garment'] }], authority: { supplier: {}, risk: { all: true, orders: true, customers: true }, riskReviewerIds: ['manager'] } };
  let state = createMistState(ctx, 'empty');
  const run = (command: MistCommand, actor = ctx) => { const next = applyMistCommand(state, command, actor); state = next.state; return next.result; };
  const customer = (name: string) => String(run({ type: 'market.customer.create', payload: { input: { name, country: '', city: '', industry: '', ownerId: 'sales', grade: '', currency: 'USD', terms: '', incoterm: '', categories: '', creditLimit: 0, since: '' } } }).id);
  const customerId = customer('场景客户');
  const supplierId = String(run({ type: 'market.supplier.save', payload: { input: { code: 'S1', name: '场景供应商', type: '工厂', country: '', address: '', capabilities: '', capacity: 0, capacityUnit: '', leadDays: 0 } } }).id);
  const relation = () => state.market.relations.find(r => r.customerId === customerId)!;
  return { ctx, run, customer, customerId, supplierId, relation, get state() { return state; } };
}

describe('风险与往来组织服务端场景回归', () => {
  it('供应商资料修改保留财务核实的收款账户及停用历史，不接受资料接口伪造账户', () => {
    const f = fixture();
    f.run({ type: 'market.supplier.bank.save', payload: { supplierId: f.supplierId, currency: 'CNY', accountName: '场景供应商', bankName: '模拟银行', accountNo: 'TEST000001', verification: '按模拟合同电话核实收款账户' } });
    f.run({ type: 'market.supplier.bank.save', payload: { supplierId: f.supplierId, currency: 'CNY', accountName: '场景供应商', bankName: '模拟银行', accountNo: 'TEST000002', verification: '按模拟合同电话再次核实账户' } });
    const before = structuredClone(f.state.market.suppliers[0].bankAccounts);
    f.run({ type: 'market.supplier.save', payload: { id: f.supplierId, input: { name: '场景供应商更名', bankAccounts: [] } as any } });
    expect(f.state.market.suppliers[0].bankAccounts).toEqual(before);
    expect(f.state.market.suppliers[0].bankAccounts!.map(a => a.state)).toEqual(['replaced', 'active']);
  });

  it.each(['paused', 'blocked'] as const)('不能关联已生效的 %s 供应商；恢复后可关联且不能重复关联', status => {
    const f = fixture();
    f.run({ type: 'market.supplier.status', payload: { id: f.supplierId, status, reason: '资质待复核' } });
    const link: MistCommand = { type: 'market.relation.linkSupplier', payload: { id: f.relation().id, supplierId: f.supplierId } };
    const before = structuredClone(f.state);
    expect(() => f.run(link)).toThrow(/暂停|停用/);
    expect(f.state).toEqual(before);
    f.run({ type: 'market.supplier.status', payload: { id: f.supplierId, status: 'active', reason: '资质已复核' } });
    f.run(link);
    expect(f.relation().supplierId).toBe(f.supplierId);
    expect(() => f.run(link)).toThrow(/已关联供应商/);
  });

  it('未来生效的停用不阻止当前关联，资质到期仅产生预警而不擅改合作状态', () => {
    const f = fixture();
    f.run({ type: 'market.supplier.certificate.save', payload: { supplierId: f.supplierId, name: '场景认证', number: 'CERT-1', issuer: '模拟机构', validUntil: '2026-10-14', fileIds: [] } });
    expect(riskSignals(f.state, '2026-10-14').some(s => s.key.startsWith('cert-expiring:'))).toBe(true);
    expect(riskSignals(f.state, '2026-10-15').some(s => s.key.startsWith('cert-expired:') && s.level === 'critical')).toBe(true);
    expect(f.state.market.suppliers[0].status).toBe('active');
    f.run({ type: 'market.supplier.status', payload: { id: f.supplierId, status: 'blocked', reason: '到期复核', effectiveDate: '2026-10-20' } });
    f.run({ type: 'market.relation.linkSupplier', payload: { id: f.relation().id, supplierId: f.supplierId } });
    expect(supplierStatusOn(f.state.market.suppliers[0], '2026-10-19')).toBe('active');
    expect(supplierStatusOn(f.state.market.suppliers[0], '2026-10-20')).toBe('blocked');
  });

  it('冻结解除后再次冻结，上一轮尚未使用的出运批准不能复用', () => {
    const f = fixture(), id = f.relation().id;
    f.run({ type: 'market.relation.hold', payload: { id, frozen: true, reason: '首次逾期' } });
    f.state.platform!.risks.push({ id: 'hold-risk', orderId: '', title: '信用冻结', basis: '首次逾期', owner: '业务员', level: 'warning', state: 'InProgress', resolution: '', createdAt: f.ctx.now, signalKey: 'relation-hold:' + id, release: { escalationId: 'old-approval', approvedBy: '主管', at: f.ctx.now, note: '仅本次一票' } });
    expect(heldShipmentRelease(f.state, f.customerId).risk?.id).toBe('hold-risk');
    f.run({ type: 'market.relation.hold', payload: { id, frozen: false, reason: '首次逾期已清偿' } });
    expect(heldShipmentRelease(f.state, f.customerId).held).toBe('');
    f.run({ type: 'market.relation.hold', payload: { id, frozen: true, reason: '新增逾期' } }, { ...f.ctx, now: '2026-10-15T02:00:00.000Z' });
    expect(heldShipmentRelease(f.state, f.customerId).held).toContain('新增逾期');
    expect(heldShipmentRelease(f.state, f.customerId).risk).toBeUndefined();
    const risk = f.state.platform!.risks.find(r => r.id === 'hold-risk')!;
    expect(risk.release?.escalationId).toBe('old-approval');
    risk.release = { escalationId: 'new-approval', approvedBy: '主管', at: '2026-10-15T03:00:00.000Z', note: '新冻结本次放行' };
    expect(heldShipmentRelease(f.state, f.customerId).risk?.id).toBe(risk.id);
    risk.release.shipmentId = 'shipment-used';
    expect(heldShipmentRelease(f.state, f.customerId).risk).toBeUndefined();
    delete risk.release.shipmentId;
    risk.state = 'Resolved';
    expect(heldShipmentRelease(f.state, f.customerId).risk).toBeUndefined();
  });

  it('双身份冻结同时识别客户与供方，解冻后恢复且历史保留', () => {
    const f = fixture(), id = f.relation().id;
    f.run({ type: 'market.relation.linkSupplier', payload: { id, supplierId: f.supplierId } });
    f.run({ type: 'market.relation.hold', payload: { id, frozen: true, reason: '合同核实' } });
    expect(relationHoldReason(f.state, { customerId: f.customerId })).toContain('合同核实');
    expect(relationHoldReason(f.state, { supplierId: f.supplierId })).toContain('合同核实');
    f.run({ type: 'market.relation.hold', payload: { id, frozen: false, reason: '核实完成' } });
    expect(relationHoldReason(f.state, { customerId: f.customerId, supplierId: f.supplierId })).toBe('');
    expect(f.relation().holdHistory!.map(h => h.action)).toEqual(['freeze', 'release']);
  });

  it('联系人不能通过旧命令移到另一个客户；删除联系人不改写已记录的客户跟进', () => {
    const f = fixture(), otherId = f.customer('另一个场景客户');
    const payload = { customerId: f.customerId, name: '场景采购', role: '采购', email: 'buyer@example.com', phone: '' };
    const id = String(f.run({ type: 'contact.save', payload }).id);
    f.run({ type: 'crm.followUp.save', payload: { customerId: f.customerId, method: 'call', content: '场景采购确认交期', at: f.ctx.now, nextDate: '', link: null } });
    const followUps = structuredClone(f.state.crm.followUps), before = structuredClone(f.state);
    expect(() => f.run({ type: 'contact.save', payload: { ...payload, id, customerId: otherId } })).toThrow(/客户/);
    expect(f.state).toEqual(before);
    f.run({ type: 'contact.delete', payload: { id } });
    expect(f.state.contacts.some(c => c.id === id)).toBe(false);
    expect(f.state.crm.followUps).toEqual(followUps);
  });

  it('风险先接手再处理、关闭必须填依据，撤回重提不残留旧审批决定', () => {
    const f = fixture();
    const id = String(f.run({ type: 'platform.risk.save', payload: { title: '场景风险', basis: '待核实', owner: '业务员', level: 'warning', source: { kind: 'customer', id: f.customerId } } }).id);
    expect(() => f.run({ type: 'platform.risk.plan', payload: { id, plan: '直接处理' } })).toThrow(/先接手/);
    expect(() => f.run({ type: 'platform.risk.transition', payload: { id, state: 'Resolved', resolution: '跳过接手' } })).toThrow(/先确认接手/);
    f.run({ type: 'platform.risk.transition', payload: { id, state: 'Acknowledged', resolution: '' } });
    expect(() => f.run({ type: 'platform.risk.transition', payload: { id, state: 'Acknowledged', resolution: '' } })).toThrow(/已被接手/);
    expect(() => f.run({ type: 'platform.risk.transition', payload: { id, state: 'Resolved', resolution: ' ' } })).toThrow(/关闭依据/);
    f.run({ type: 'platform.risk.plan', payload: { id, plan: '核实凭据' } });
    f.run({ type: 'platform.risk.escalate', payload: { id, action: 'close', reason: '旧依据' } });
    const old = pendingEscalation(f.state.platform!.risks[0])!.id;
    f.run({ type: 'platform.risk.withdraw', payload: { id, escalationId: old, reason: '补充凭据' } });
    f.run({ type: 'platform.risk.escalate', payload: { id, action: 'close', reason: '新依据' } });
    const current = pendingEscalation(f.state.platform!.risks[0])!;
    expect(current).toMatchObject({ decision: 'pending', reason: '新依据', decidedBy: '', decidedAt: '', decisionNote: '' });
    expect(current.id).not.toBe(old);
    expect(getRiskReviews(f.state).filter(t => t.target.id === id)).toHaveLength(1);
    expect(() => f.run({ type: 'platform.risk.decide', payload: { id, escalationId: old, decision: 'approved', note: '旧审批' } }, { ...f.ctx, actorId: 'manager' })).toThrow(/已答复或已变化/);
    f.run({ type: 'platform.risk.decide', payload: { id, escalationId: current.id, decision: 'approved', note: '核实新依据' } }, { ...f.ctx, actorId: 'manager', actorName: '主管' });
    expect(f.state.platform!.risks[0]).toMatchObject({ state: 'Resolved', resolution: '新依据' });
    expect(() => f.run({ type: 'platform.risk.plan', payload: { id, plan: '重新处理' } })).toThrow(/已关闭/);
  });
});

describe('客户档案与附件的入口一致性', () => {
  it.each(['customer.update', 'market.customer.update'] as const)('%s 拒绝非法币种、日期，并同步往来组织档案', type => {
    const f = fixture();
    for (const patch of [{ currency: '美元' }, { since: '2026-02-30' }, { creditLimit: -1 }]) {
      const before = structuredClone(f.state);
      expect(() => f.run({ type, payload: { id: f.customerId, patch } })).toThrow();
      expect(f.state).toEqual(before);
    }
    f.run({ type, payload: { id: f.customerId, patch: { name: '客户新名称', city: '杭州', currency: 'EUR' } } });
    expect(f.state.customers.find(c => c.id === f.customerId)).toMatchObject({ name: '客户新名称', city: '杭州', currency: 'EUR' });
    expect(f.relation()).toMatchObject({ name: '客户新名称', address: '杭州' });
  });

  it('关系附件去重，未知附件被拒且原列表不变；归档客户保留跟进与商机历史', () => {
    const f = fixture(), id = f.relation().id;
    f.state.files.push({ id: 'evidence', name: 'evidence.pdf', mimeType: 'application/pdf', size: 10, storageKey: 'workspace/evidence', createdAt: f.ctx.now });
    f.run({ type: 'market.attachment.set', payload: { kind: 'relation', id, fileIds: ['evidence', 'evidence'] } });
    expect(f.relation().fileIds).toEqual(['evidence']);
    const before = structuredClone(f.state);
    expect(() => f.run({ type: 'market.attachment.set', payload: { kind: 'relation', id, fileIds: ['unknown'] } })).toThrow(/附件不存在/);
    expect(f.state).toEqual(before);
    f.run({ type: 'crm.followUp.save', payload: { customerId: f.customerId, method: 'meeting', content: '会议历史记录', at: f.ctx.now, nextDate: '', link: null } });
    const opportunityId = String(f.run({ type: 'crm.opportunity.save', payload: { input: { customerId: f.customerId, title: '历史商机', domain: 'fabric', amount: '10.00', currency: 'USD', expectedDate: '2026-10-20', ownerId: 'sales', note: '', devIds: [], quotationIds: [], orderIds: [] } } }).id);
    f.run({ type: 'crm.opportunity.stage', payload: { id: opportunityId, stage: 'lost', note: '本季需求取消' } });
    const history = structuredClone(f.state.crm);
    f.run({ type: 'market.relation.status', payload: { id, status: 'archived' } });
    expect(f.state.customers.some(c => c.id === f.customerId)).toBe(true);
    expect(f.state.crm).toEqual(history);
    expect(f.relation()).toMatchObject({ status: 'archived', fileIds: ['evidence'] });
  });
});
