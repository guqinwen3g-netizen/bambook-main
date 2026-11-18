import { describe, expect, it } from 'vitest';
import type { TokenPayload } from '../auth/service';
import { createMistState, type MistFile } from '../shared/mistWorkspace';
import { canReadFile, projectState, MIST_READ_SECTIONS } from './access';

const context = { id: () => 'test-record', now: '2026-10-14T00:00:00Z', actorName: '测试' };
const empty = () => createMistState(context, 'empty');
const actor = (permissions: string[], userId = 'member'): TokenPayload => ({ userId, roles: [], permissions, authorizationLoaded: true, departmentIds: [] } as TokenPayload);
const file = (id: string, uploadedBy?: string): MistFile => ({ id, name: id + '.pdf', mimeType: 'application/pdf', size: 10, storageKey: 'space/' + id, createdAt: context.now, uploadedBy });

function orderFlowFixture(){
 const state=empty();state.orders=[{id:'own',code:'SO-OWN',ownerId:'member',owner:'业务员',type:'fabric'},{id:'peer',code:'SO-PEER',ownerId:'member',owner:'业务员',type:'fabric'}] as any;
 state.orderLines=[{id:'line',orderId:'own',qty:6,unit:'米',price:9},{id:'copy',orderId:'peer',qty:4,unit:'米',price:9}] as any;
 state.events=[{id:'flow',entityType:'order',entityId:'own',actor:'业务员',at:context.now,text:'拆分订单：A 4 米；分批',fileIds:[],orderFlow:{action:'split',sourceOrderId:'own',targetOrderId:'peer',lines:[{sourceLineId:'line',targetLineId:'copy',quantity:4,unit:'米'}]}} as any];return state;
}
it('removes the whole counterpart packet after row scope hides the other owner without rewriting raw history',()=>{
 const state=orderFlowFixture();state.orders[1].ownerId='other-owner';const raw=structuredClone(state);
 const view=projectState(state,actor(['orders:read']),empty,undefined,{userIds:['member'],teamIds:[]}).state;
 expect(view.orders.map(o=>o.id)).toEqual(['own']);expect(view.orders[0].ownerId).toBe('member');expect(view.events).toHaveLength(1);expect((view.events[0] as any).orderFlow).toBeUndefined();expect(view.events[0].text).toBe(raw.events[0].text);expect(JSON.stringify(view.events)).not.toContain('peer');expect(state).toEqual(raw);
});
it('whitelists visible movement facts and does not smuggle price/cost/amount fields through history metadata',()=>{
 const state=orderFlowFixture(),flow=(state.events[0] as any).orderFlow;flow.cost=717;flow.amount=81;flow.lines[0].price=9;flow.lines[0].supplierCost=7;const raw=structuredClone(state);
 const view=projectState(state,actor(['orders:read']),empty).state;
 expect((view.events[0] as any).orderFlow).toEqual({action:'split',sourceOrderId:'own',targetOrderId:'peer',lines:[{sourceLineId:'line',targetLineId:'copy',quantity:4,unit:'米'}]});expect(view.orders.map(o=>o.ownerId)).toEqual(['member','member']);expect(view.fulfillment.purchases).toEqual([]);expect(state).toEqual(raw);
});

describe('按已有业务查看权限投影，不因成员资格扩大权限', () => {
  it('keeps QC reading independent from writing and withholds QC records when read permission is absent', () => {
    const state = empty();
    state.fulfillment.qcTasks = [{ id: 'quality-task' }] as any;
    state.fulfillment.qcReports = [{ id: 'quality-report' }] as any;
    const reader = projectState(state, actor(['qc:read']), empty).state;
    expect(reader.fulfillment.qcTasks).toHaveLength(1);
    expect(reader.fulfillment.qcReports).toHaveLength(1);
    const denied = projectState(state, actor(['qc:write']), empty).state;
    expect(denied.fulfillment.qcTasks).toEqual([]);
    expect(denied.fulfillment.qcReports).toEqual([]);
  });
  it('所有业务集合都有明确读规则，未来增加集合不能静默开放给成员', () => {
    const state = empty(), paths = new Set(MIST_READ_SECTIONS.flatMap(section => section.paths.map(path => path.join('.'))));
    const shared = new Set(['schemaVersion', 'workspaceArchive', 'settings', 'files', 'events', 'tasks', 'notifications', 'calendar', 'reviewerIds', 'memberIds', 'members', 'memberLog']);
    for (const key of Object.keys(state).filter(key => !shared.has(key))) {
      if (['market', 'platform', 'fulfillment'].includes(key)) for (const child of Object.keys((state as any)[key])) expect(paths.has(key + '.' + child), key + '.' + child).toBe(true);
      else expect(paths.has(key), key).toBe(true);
    }
  });
  it('报价查看不能开放整组产品、供应商、营销或员工档案，原状态不被裁剪写回', () => {
    const state = empty();
    for (const key of Object.keys(state.market)) (state.market as any)[key] = [{ id: key }];
    state.platform.employees = [{ id: 'employee-private' }] as any;
    const original = structuredClone(state), result = projectState(state, actor(['quotations:read']), empty, 'owner');
    expect(result.state.market.quotations).toHaveLength(1);
    for (const key of Object.keys(state.market).filter(key => key !== 'quotations')) expect((result.state.market as any)[key]).toEqual([]);
    expect(result.state.platform.employees).toEqual([]);
    expect(result.hidden.map(section => section.key)).toContain('employees');
    expect(state).toEqual(original);
  });

  it('采购查看不能顺便开放库存、生产、质检或出运集合', () => {
    const state = empty();
    for (const key of Object.keys(state.fulfillment)) (state.fulfillment as any)[key] = [{ id: key }];
    const visible = projectState(state, actor(['procurement:read']), empty, 'owner').state;
    expect(visible.fulfillment.purchases).toHaveLength(1);
    expect(visible.fulfillment.receipts).toHaveLength(1);
    for (const key of Object.keys(state.fulfillment).filter(key => !['purchases', 'receipts'].includes(key))) expect((visible.fulfillment as any)[key]).toEqual([]);
  });

  it('仅有财务总览权限不能通过资金归属、事件和提醒绕过票款查看权限', () => {
    const state = empty();
    state.orderFunding = { assignments: [{ id: 'hidden-funding', amount: 8888 }] } as any;
    state.events = ['finance', 'invoice', 'payment', 'payable', 'orderFunding', 'unclassified-private'].map(entityType => ({ id: entityType, entityType, entityId: 'hidden', actor: '财务', at: context.now, text: '银行流水 SECRET-BANK', fileIds: [] }));
    state.tasks = [{ id: 'hidden-task', title: '付款 SECRET-BANK', due: '', done: false, kind: 'finance', target: { view: 'finance' } }] as any;
    state.notifications = [{ id: 'hidden-notice', title: '付款 SECRET-BANK', target: { view: 'payables' } }] as any;
    state.calendar = [{ id: 'hidden-calendar', title: '付款 SECRET-BANK', target: { view: 'funding' } }] as any;
    const visible = projectState(state, actor(['finance:read']), empty, 'owner').state;
    expect(visible.events).toEqual([]);
    expect(visible.tasks).toEqual([]);
    expect(visible.notifications).toEqual([]);
    expect(visible.calendar).toEqual([]);
    expect(JSON.stringify(visible)).not.toContain('SECRET-BANK');
    expect(JSON.stringify(visible.orderFunding)).not.toContain('hidden-funding');
  });

  it('未引用的历史附件只给所有者；新上传的未引用附件只给上传人及所有者', () => {
    const state = empty();
    state.files = [file('legacy-unattached'), file('member-upload', 'member'), file('other-upload', 'other')];
    expect(projectState(state, actor(['*']), empty, 'owner').state.files.map(item => item.id)).toEqual(['member-upload']);
    expect(projectState(state, actor(['*'], 'owner'), empty, 'owner').state.files).toHaveLength(3);
    expect(canReadFile(state, actor(['*']), 'legacy-unattached', empty, 'owner')).toBe(false);
  });

  it('隐藏来源附件不可下载，近似文本不能重新开放；可见来源附件仍可使用', () => {
    const state = empty();
    state.files = [file('finance-file', 'member'), file('product-file', 'owner')];
    state.payables = { bills: [{ id: 'bill', fileIds: ['finance-file'] }], payments: [], allocations: [] } as any;
    state.devs = [{ id: 'dev', fileIds: ['product-file'], note: '前缀 finance-file 后缀' }] as any;
    const member = actor(['products:read']);
    expect(projectState(state, member, empty, 'owner').state.files.map(item => item.id)).toEqual(['product-file']);
    expect(canReadFile(state, member, 'finance-file', empty, 'owner')).toBe(false);
    expect(canReadFile(state, member, 'product-file', empty, 'owner')).toBe(true);
  });

  it('权限上限撤销查看权限后，即使原来有全部权限也仍会隐藏', () => {
    const state = empty();
    state.invoices = [{ id: 'private-invoice' }] as any;
    const subject = { ...actor(['*']), permissionCeiling: ['orders:read'] } as TokenPayload;
    expect(projectState(state, subject, empty, 'owner').state.invoices).toEqual([]);
  });

  it('keeps a development invoice original readable through either authorised source, without opening it to unrelated roles', () => {
    const state = empty();
    state.files = [file('development-original', 'issuer')];
    state.devs = [{ id: 'dev', billing: { makingFees: [], invoices: [{ invoiceId: 'di', fileIds: ['development-original'] }] } }] as any;
    state.invoices = [{ id: 'di', devId: 'dev', fileIds: ['development-original'] }] as any;
    expect(canReadFile(state, actor(['invoices:read']), 'development-original', empty, 'owner')).toBe(true);
    expect(canReadFile(state, actor(['products:read']), 'development-original', empty, 'owner')).toBe(true);
    expect(canReadFile(state, actor(['orders:read']), 'development-original', empty, 'owner')).toBe(false);
  });
});

it('keeps replacement customs valuation and tax attachments behind customs reading, independent of order/claim visibility',()=>{
 const state=empty();state.files.push(file('replacement-contract'),file('tax-proof'),file('private-claim'));
 state.orders.push({id:'replacement-order',replacementSource:{schemaVersion:1,claimId:'claim',dispositionId:'disp'},governance:{contract:{confirmationFileIds:['replacement-contract']}}} as any);
 state.platform.claims.push({id:'claim',fileIds:['private-claim']} as any);
 state.fulfillment.customs.push({id:'declaration',replacementReviews:[{orderId:'replacement-order',taxHandling:'原单税务资料',fileIds:['tax-proof']}]} as any);
 state.events.push({id:'customs-event',entityType:'customs',entityId:'declaration',fileIds:['tax-proof']} as any);
 const orderReader=projectState(state,actor(['orders:read']),empty).state;expect(orderReader.orders[0].replacementSource).toMatchObject({claimId:'claim'});expect(orderReader.platform.claims).toEqual([]);expect(orderReader.fulfillment.customs).toEqual([]);expect(orderReader.files.map(f=>f.id)).toEqual(['replacement-contract']);
 const claimReader=projectState(state,actor(['aftersales:read']),empty).state;expect(claimReader.files.map(f=>f.id)).toEqual(['private-claim']);
 const customsReader=projectState(state,actor(['customs:read']),empty).state;expect(customsReader.fulfillment.customs[0].replacementReviews).toHaveLength(1);expect(customsReader.files.map(f=>f.id)).toEqual(['tax-proof']);
});

describe('lead follow-up history projection', () => {
  it('ships nested followUps with marketing read access, and hides them without read access', () => {
    const state = empty(), followUps = [{ at: context.now, actor: '经办人', actorId: 'sales', status: 'Following', note: '客户要求寄样' }];
    state.market.leads = [{ id: 'lead', source: 'show', note: '最初说明', followUps }, { id: 'legacy', source: 'campaign', note: '旧线索说明' }] as any;
    const before = structuredClone(state);
    const visible = projectState(state, actor(['marketing:read']), empty).state;
    expect(visible.market.leads[0].followUps).toEqual(followUps);
    expect(visible.market.leads[1].followUps).toBeUndefined();
    const scoped = projectState(state, actor(['marketing:read']), empty, 'owner', { userIds: ['member'], teamIds: [] }).state;
    expect(scoped.market.leads[0].followUps).toEqual(followUps);
    expect(projectState(state, actor(['marketing:write']), empty).state.market.leads).toEqual([]);
    expect(projectState(state, actor(['seasons:read']), empty).state.market.leads).toEqual([]);
    expect(state).toEqual(before);
  });
});

it('gives invoice readers only the linked payment-anchor date without granting transport or POD contents',()=>{
 const s=empty(),condition={kind:'deliveryAcceptance' as const,days:30,terms:'交付验收后30天付款'};
 s.invoices.push({id:'ar-condition',code:'CI-C',orderId:'o',order:'SO-C',customer:'Buyer',currency:'USD',due:'',amount:100,open:100,financeStatus:'confirmed',sourceDocumentId:'ci-condition',receivableDueCondition:condition});
 s.fulfillment.documents.push({id:'ci-condition',type:'CI',status:'issued',orderId:'o',invoiceId:'ar-condition',shipmentId:'ship-condition',receivableDueCondition:condition} as any);
 s.fulfillment.shipments.push({id:'ship-condition',lines:[],delivered:{at:'2026-10-20T10:00:00Z',receiver:'POD-SECRET-RECEIVER',evidence:'POD-SECRET-CONTENT',fileIds:['secret-pod'],recordedBy:'Ops'}} as any);
 const before=structuredClone(s),view=projectState(s,actor(['invoices:read']),empty).state;
 expect(view.invoices[0].receivableDueSource).toEqual({sourceCurrent:true,shipmentId:'ship-condition',deliveryAt:'2026-10-20T10:00:00Z'});
 expect(view.fulfillment.shipments).toEqual([]);expect(view.fulfillment.documents).toEqual([]);expect(JSON.stringify(view)).not.toContain('POD-SECRET');expect(JSON.stringify(view)).not.toContain('secret-pod');expect(s).toEqual(before);
 expect(projectState(s,actor(['shipments:read']),empty).state.invoices).toEqual([]);
});

it('keeps new unlinked assistant drafts on the author account without rewriting legacy or order drafts', () => {
  const state = empty(), base = { title: '业务备忘', content: '本地模拟', createdAt: context.now };
  state.platform.assistantDrafts = [
    { ...base, id: 'mine', orderId: '', ownerId: 'author' },
    { ...base, id: 'other', orderId: '', ownerId: 'peer' },
    { ...base, id: 'linked', orderId: 'order', ownerId: 'peer' },
    { ...base, id: 'legacy', orderId: '' },
  ];
  const before = structuredClone(state);
  const mine = projectState(state, actor(['ai:chat'], 'author'), empty).state.platform.assistantDrafts;
  const unassigned = projectState(state, actor(['ai:chat', 'company:admin'], 'another'), empty).state.platform.assistantDrafts;
  expect(mine.map(r => r.id)).toEqual(['mine', 'linked', 'legacy']);
  expect(unassigned.map(r => r.id)).toEqual(['linked', 'legacy']);
  expect(projectState(state, actor([], 'author'), empty).state.platform.assistantDrafts).toEqual([]);
  expect(state).toEqual(before);
});
