import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, type MistContext, type MistState } from './mistWorkspace';

const ctx = (): MistContext => { let n = 0; return { id: () => `lc-${++n}`, now: '2026-10-14T02:00:00.000Z', actorName: '顾言', actorId: 'u-gu' }; };
const demo = () => { const c = ctx(); return { c, s: createMistState(c, 'demo') }; };
const run = (s: MistState, command: any, c: MistContext) => applyMistCommand(s, command, c);

describe('线索一键转 CRM', () => {
  it('按线索公司新建客户与联系人并建立商机，线索记录转化去向', () => {
    const { c, s } = demo(); const lead = s.market.leads.find(l => l.name === 'Anna Rossi')!;
    const r = run(s, { type: 'market.lead.convertToCrm', payload: { id: lead.id, opportunity: { title: 'Rossi 西装面料', domain: 'fabric', amount: '4000.00', currency: 'EUR', expectedDate: '2026-12-01' } } }, c);
    const st = r.state, customerId = String(r.result.customerId);
    expect(st.customers.find(x => x.id === customerId)!.name).toBe('Studio Rossi Milano');
    expect(st.contacts.some(x => x.customerId === customerId && x.name === 'Anna Rossi')).toBe(true);
    const opp = st.crm.opportunities.find(o => o.id === r.result.opportunityId)!;
    expect(opp).toMatchObject({ customerId, stage: 'intent', currency: 'EUR' }); expect(opp.note).toContain('Première Vision Paris');
    expect(st.market.leads.find(l => l.id === lead.id)).toMatchObject({ status: 'Converted', customerId, opportunityId: opp.id });
    expect(() => run(st, { type: 'market.lead.convertToCrm', payload: { id: lead.id } }, c)).toThrow(/已转化/);
  });
  it('同名客户不重复建立；失败时不落下半截数据', () => {
    const { c, s } = demo(); const lead = s.market.leads.find(l => l.name === 'Clara Weiss')!;
    const named = run(s, { type: 'market.customer.create', payload: { input: { name: 'weiss & söhne', country: '', city: '', industry: '', ownerId: 'u-gu', grade: '', currency: 'EUR', terms: '', incoterm: '', categories: '', creditLimit: 0, since: '2026-10-14' } } }, c).state;
    const before = named.customers.length;
    expect(() => run(named, { type: 'market.lead.convertToCrm', payload: { id: lead.id } }, c)).toThrow(/已有同名客户/);
    expect(() => run(s, { type: 'market.lead.convertToCrm', payload: { id: lead.id, opportunity: { title: '', domain: 'fabric', amount: '1', currency: 'EUR', expectedDate: '' } } }, c)).toThrow();
    expect(s.customers.some(x => x.name === 'Weiss & Söhne')).toBe(false); expect(named.customers.length).toBe(before);
    const existing = named.customers.find(x => x.name === 'weiss & söhne')!;
    const r = run(named, { type: 'market.lead.convertToCrm', payload: { id: lead.id, customerId: existing.id } }, c);
    expect(r.state.customers.length).toBe(before); expect(r.state.market.leads.find(l => l.id === lead.id)!.customerId).toBe(existing.id);
  });
});

describe('线索跟进接续', () => {
  it.each(['show', 'campaign'] as const)('接续 %s 线索原经办与日期，待办和日历归线索负责人', source => {
    const { c, s } = demo(), lead = s.market.leads.find(l => l.source === source)!;
    Object.assign(lead, { ownerId: 'owner', owner: '线索负责人', note: '客户要求寄送色卡', followUpDate: '2026-10-10', updatedAt: '2026-10-09T02:00:00.000Z' });
    delete lead.followUps;
    delete lead.communication; // Exercise legacy event provenance as well as new structured provenance.
    s.events.unshift({ id: 'original-communication', entityType: 'lead', entityId: lead.id, actor: '原经办人', at: lead.updatedAt, text: '登记线索', fileIds: [] });
    const context = { ...c, members: [{ id: 'owner', name: '线索负责人', active: true, groups: ['fabric' as const] }] };
    const { state, result } = run(s, { type: 'market.lead.convertToCrm', payload: { id: lead.id, opportunity: { title: '色卡需求', domain: 'fabric', amount: '100', currency: 'USD', expectedDate: '2026-12-01' } } }, context);
    const followUp = state.crm.followUps.find(f => f.customerId === result.customerId)!;
    expect(followUp).toMatchObject({ content: lead.note, actor: '原经办人', at: lead.updatedAt, nextDate: '2026-10-10' });
    expect(state.tasks.find(t => t.id === followUp.nextTaskId)).toMatchObject({ kind: 'crm-follow-up', due: '2026-10-10', assigneeIds: ['owner'], target: { view: 'crm', id: result.customerId } });
    expect(state.calendar.find(e => e.target?.id === result.customerId)).toMatchObject({ date: '2026-10-10', time: '09:00', ownerId: 'owner' });
    expect(state.customers.find(c => c.id === result.customerId)?.ownerId).toBe('owner');
    expect(state.crm.opportunities.find(o => o.id === result.opportunityId)?.ownerId).toBe('owner');
    expect(() => run(state, { type: 'market.lead.convertToCrm', payload: { id: lead.id } }, context)).toThrow(/已转化/);
    expect(state.crm.followUps.filter(f => f.customerId === result.customerId)).toHaveLength(1);
  });
  it('直接营销线索转现有客户也接续；无下次日期不制造待办', () => {
    const { c, s } = demo(), lead = s.market.leads.find(l => l.source === 'campaign' && l.status !== 'Converted')!;
    delete lead.followUps;
    lead.followUpDate = ''; lead.note = '展后已电话沟通';
    const { state } = run(s, { type: 'market.lead.transition', payload: { id: lead.id, status: 'Converted', customerId: s.customers[0].id, note: '已转客户' } }, c);
    const record = state.crm.followUps[0];
    expect(record).toMatchObject({ customerId: s.customers[0].id, content: '展后已电话沟通', nextTaskId: '', nextDate: '' });
    expect(state.tasks.some(t => t.id === record.nextTaskId)).toBe(false);
  });
});


describe('线索沟通归属不可被后续编辑覆盖', () => {
  it('按保存沟通时的服务端经办与时间转入 CRM，不采信客户端归属字段', () => {
    const { c, s } = demo(), lead = s.market.leads.find(l => l.source === 'show')!;
    const recordedAt = '2026-10-15T02:00:00.000Z';
    const saved = run(s, { type: 'market.lead.save', payload: { id: lead.id, input: { ...lead, note: '展会现场已沟通', communication: { actor: '伪造人', at: '2026-01-01' } } } }, { ...c, now: recordedAt, actorName: '沟通经办' }).state;
    expect(saved.market.leads.find(l => l.id === lead.id)?.communication).toEqual({ actor: '沟通经办', actorId: c.actorId, at: recordedAt });
    const edited = run(saved, { type: 'market.lead.save', payload: { id: lead.id, input: { ...saved.market.leads.find(l => l.id === lead.id), phone: '123' } } }, { ...c, now: '2026-10-16T02:00:00.000Z' }).state;
    const { state, result } = run(edited, { type: 'market.lead.convertToCrm', payload: { id: lead.id } }, { ...c, now: '2026-10-17T02:00:00.000Z' });
    expect(state.crm.followUps.find(f => f.customerId === result.customerId)).toMatchObject({ content: '展会现场已沟通', actor: '沟通经办', at: recordedAt });
  });
});

describe('线索逐次跟进历史', () => {
  it.each(['show', 'campaign'] as const)('%s 跟进、流失、恢复与转化逐条留痕，CRM 迁移历史且只建一个提醒', source => {
    const { c, s } = demo(), lead = s.market.leads.find(l => l.source === source && l.status !== 'Converted')!;
    delete lead.followUps;
    lead.note = '最初录入说明'; lead.followUpDate = '2026-10-20';
    let state = s;
    const statuses = [source === 'show' ? 'Following' : 'Contacted', 'Lost', 'New'];
    const entries = statuses.map((status, index) => ({ at: `2026-10-${15 + index}T02:00:00.000Z`, actor: `经办${index}`, actorId: `recorder-${index}`, status, note: `本次说明${index}` }));
    for (const entry of entries) {
      state = run(state, { type: source === 'show' ? 'market.showLead.transition' : 'market.lead.transition', payload: { id: lead.id, status: entry.status, note: entry.note } }, { ...c, now: entry.at, actorName: entry.actor, actorId: entry.actorId }).state;
      expect(state.market.leads.find(l => l.id === lead.id)?.note).toBe('最初录入说明');
    }
    expect(state.market.leads.find(l => l.id === lead.id)?.followUps).toEqual(entries);
    // Saving profile fields must not accept client-written history or lose server history.
    const current = state.market.leads.find(l => l.id === lead.id)!;
    state = run(state, { type: 'market.lead.save', payload: { id: lead.id, input: { ...current, phone: '123', followUps: [{ actor: '伪造', note: '替换历史' }] } } }, c).state;
    expect(state.market.leads.find(l => l.id === lead.id)?.followUps).toEqual(entries);
    const convertedAt = '2026-10-18T02:00:00.000Z';
    const out = run(state, { type: 'market.lead.convertToCrm', payload: { id: lead.id } }, { ...c, now: convertedAt });
    const converted = out.state.market.leads.find(l => l.id === lead.id)!;
    expect(converted.note).toBe('最初录入说明');
    expect(converted.followUps).toEqual([...entries, { at: convertedAt, actor: c.actorName, actorId: c.actorId, status: 'Converted', note: '转为 CRM 客户' }]);
    const records = out.state.crm.followUps.filter(f => f.customerId === out.result.customerId);
    expect(records).toHaveLength(entries.length);
    for (const entry of entries) expect(records).toContainEqual(expect.objectContaining({ content: entry.note, actor: entry.actor, actorId: entry.actorId, at: entry.at }));
    expect(records.filter(f => f.nextTaskId)).toHaveLength(1);
    expect(records.find(f => f.nextTaskId)).toMatchObject({ content: entries.at(-1)!.note, nextDate: '2026-10-20' });
    expect(out.state.calendar.filter(e => e.target?.id === out.result.customerId)).toHaveLength(1);
  });
  it('记跟进时约定下次跟进日，不能早于今天；未填时沿用原日期', () => {
    const { c, s } = demo(), lead = s.market.leads.find(l => l.name === 'Anna Rossi')!;
    const followed = run(s, { type: 'market.showLead.transition', payload: { id: lead.id, status: 'Following', note: '电话沟通', followUpDate: '2026-10-21' } }, c).state;
    expect(followed.market.leads.find(l => l.id === lead.id)).toMatchObject({ status: 'Following', followUpDate: '2026-10-21' });
    expect(() => run(followed, { type: 'market.showLead.transition', payload: { id: lead.id, status: 'Following', note: '再沟通', followUpDate: '2026-10-13' } }, c)).toThrow(/不能早于今天/);
    const kept = run(followed, { type: 'market.showLead.transition', payload: { id: lead.id, status: 'Following', note: '补充' } }, c).state;
    expect(kept.market.leads.find(l => l.id === lead.id)!.followUpDate).toBe('2026-10-21');
  });
  it('没有账号 ID 的经办也保留姓名时间；失败的 transition 不追加历史', () => {
    const { c, s } = demo(), lead = s.market.leads.find(l => l.source === 'show')!;
    delete lead.followUps;
    const state = run(s, { type: 'market.showLead.transition', payload: { id: lead.id, status: 'Following', note: '继续沟通' } }, { ...c, actorId: undefined }).state;
    expect(state.market.leads.find(l => l.id === lead.id)?.followUps).toEqual([{ at: c.now, actor: c.actorName, status: 'Following', note: '继续沟通' }]);
    const before = structuredClone(state);
    expect(() => run(state, { type: 'market.showLead.transition', payload: { id: lead.id, status: 'Invalid', note: '无效状态' } }, c)).toThrow();
    expect(state).toEqual(before);
  });
});
