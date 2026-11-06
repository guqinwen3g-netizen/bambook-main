import {describe, expect, it} from 'vitest';
import {applyMistCommand, createMistState, type MistCommand, type MistContext, type MistNotification} from './mistWorkspace';
import {notifyMist, notificationOwners} from './mistNotifications';
import {projectState} from '../mist/access';
import type {TokenPayload} from '../auth/service';

function fixture() {
  let n = 0;
  const context: MistContext = {id: () => `notice-${++n}`, now: '2026-10-14T08:00:00Z', actorId: 'sales', actorName: '提交人', members: [
    {id:'sales',name:'提交人',active:true,groups:['garment']}, {id:'owner',name:'负责人',active:true,groups:['garment']}, {id:'peer',name:'协作人',active:true,groups:['garment']},
  ], authority:{supplier:{},orderReviewerIds:{garment:['leader','sales']}}};
  let state = createMistState(context, 'empty');
  state.customers.push({id:'customer',name:'模拟客户',code:'C',country:'CN',city:'',industry:'',owner:'负责人',ownerId:'owner',grade:'',currency:'USD',terms:'',incoterm:'',categories:'',creditLimit:0,since:''});
  state.files.push({id:'contract',name:'contract.pdf',mimeType:'application/pdf',size:1,storageKey:'fixture/contract',createdAt:context.now});
  const run = (command: MistCommand, actorId = 'sales', extra: Partial<MistContext> = {}) => {
    const result = applyMistCommand(state, command, {...context,actorId,...extra}); state = result.state; return result.result;
  };
  const orderId = run({type:'order.create',payload:{type:'garment',customerId:'customer',season:'AW',currency:'USD',due:'2026-12-01',ownerId:'owner',governance:{kind:'external',poNumber:'PO-N',confirmationFileIds:['contract'],internalPurpose:'',receiver:'',paymentMethod:'OA',depositPercent:null,paymentNote:'30天',incoterm:'FOB',deliveryPlace:'上海'},lines:[{fulfillmentMode:'cmt',cmtIncludedItems:[],name:'外套',style:'A',qty:1,unit:'件',price:10,img:'coat'}]}}).orderId!;
  const empty = () => createMistState(context, 'empty');
  const view = (userId: string, permissions = ['orders:read']) => projectState(state, {userId,roles:[],permissions,authorizationLoaded:true,departmentIds:[]} as unknown as TokenPayload, empty).state;
  return {context, run, orderId, view, get state(){return state;}};
}

describe('账号收件箱与独立已读', () => {
  it.each(['approved','rejected'] as const)('审批%s只返回提交人，不额外广播给订单负责人', decision => {
    const f=fixture(); f.run({type:'order.governance.submit',payload:{orderId:f.orderId}});
    f.run({type:'order.governance.decide',payload:{id:f.orderId,decision,note:'核对合同'}},'leader');
    expect(f.state.notifications).toHaveLength(1);
    expect(f.state.notifications[0].recipientIds).toEqual(['sales']);
    expect(f.view('owner').notifications).toEqual([]);
    expect(f.view('sales').notifications).toHaveLength(1);
  });
  it('本人经授权自批仍保留处理记录，但不通知本人', () => {
    const f=fixture(); f.run({type:'order.governance.submit',payload:{orderId:f.orderId}});
    f.run({type:'order.governance.decide',payload:{id:f.orderId,decision:'approved',note:'授权范围自批'}});
    expect(f.state.notifications).toEqual([]);
    expect(f.state.events.some(e=>e.text.includes('订单审批通过'))).toBe(true);
  });
  it('他人修改我负责的订单通知我，本人修改不通知本人', () => {
    const f=fixture(); f.run({type:'order.update',payload:{orderId:f.orderId,ownerId:'owner'}},'peer');
    expect(f.state.notifications[0].recipientIds).toEqual(['owner']);
    expect(f.view('peer').notifications).toEqual([]);
    const count=f.state.notifications.length;
    f.run({type:'order.update',payload:{orderId:f.orderId,ownerId:'owner'}},'owner');
    expect(f.state.notifications).toHaveLength(count);
  });
  it('转派订单只通知接收负责人，不给原负责人或操作者发流水', () => {
    const f=fixture(); f.run({type:'order.update',payload:{orderId:f.orderId,ownerId:'peer'}},'sales');
    expect(f.state.notifications[0].recipientIds).toEqual(['peer']);
    expect(f.view('owner').notifications).toEqual([]);
  });
  it('A已读不影响B，投影不泄露其他收件人的已读时间且不修改原状态', () => {
    const f=fixture(); notifyMist(f.state,f.context,{title:'待跟进',detail:'',target:{view:'orders/detail',id:f.orderId}},['owner','peer','sales','owner']);
    const id=f.state.notifications[0].id;
    expect(f.state.notifications[0].recipientIds).toEqual(['owner','peer']);
    f.run({type:'notification.read',payload:{id}},'owner');
    expect(f.state.notifications[0].readBy).toEqual({owner:f.context.now});
    expect(f.state.notifications[0].readAt).toBeNull();
    const before=structuredClone(f.state);
    expect(f.view('owner').notifications[0]).toMatchObject({readAt:f.context.now,recipientIds:['owner']});
    expect(f.view('owner').notifications[0].readBy).toBeUndefined();
    expect(f.view('peer').notifications[0].readAt).toBeNull();
    expect(f.state).toEqual(before);
  });
  it('全部已读同时受本人收件人与可见集合限制', () => {
    const f=fixture();
    for(const recipients of [['owner','peer'],['peer'],['owner']]) notifyMist(f.state,f.context,{title:'待跟进',detail:'',target:{view:'orders/detail',id:f.orderId}},recipients);
    const [visible,other,hidden]=f.state.notifications;
    f.run({type:'notification.readAll',payload:{}},'owner',{visibleNotificationIds:[visible.id,other.id]});
    expect(f.state.notifications[0].readBy).toEqual({owner:f.context.now});
    expect(f.state.notifications.find(n=>n.id===other.id)?.readBy).toBeUndefined();
    expect(f.state.notifications.find(n=>n.id===hidden.id)?.readBy).toBeUndefined();
    f.run({type:'notification.readAll',payload:{}},'peer');
    expect(f.view('owner').notifications.find(n=>n.id===hidden.id)?.readAt).toBeNull();
    expect(f.view('peer').notifications.every(n=>n.readAt===f.context.now)).toBe(true);
  });
  it('非收件人、匿名账号、不可见通知均不能标已读', () => {
    const f=fixture(); notifyMist(f.state,f.context,{title:'待跟进',detail:'',target:{view:'orders/detail',id:f.orderId}},['owner']);
    const id=f.state.notifications[0].id;
    for(const [actorId,extra] of [['peer',{}],['owner',{visibleNotificationIds:[]}],['',{}]] as const)
      expect(()=>f.run({type:'notification.read',payload:{id}},actorId,extra)).toThrow(/无权/);
    expect(f.state.notifications[0].readBy).toBeUndefined();
  });
  it('普通无收件人流水仅进入events，空收件人及只有操作者不会生成通知', () => {
    const f=fixture(); expect(f.state.events.length).toBeGreaterThan(0); expect(f.state.notifications).toEqual([]);
    notifyMist(f.state,f.context,{title:'操作流水',detail:'',target:{view:'cockpit'}});
    notifyMist(f.state,f.context,{title:'本人操作',detail:'',target:{view:'cockpit'}},['sales']);
    expect(f.state.notifications).toEqual([]);
  });
  it('旧公司流水不向任何账号展示，旧共享readAt不能当作个人已读', () => {
    const f=fixture();
    f.state.notifications.push({id:'legacy',title:'旧流水',detail:'',at:f.context.now,readAt:f.context.now,target:{view:'orders/detail',id:f.orderId}} as MistNotification);
    f.state.notifications.push({id:'new',recipientIds:['owner','peer'],title:'待办',detail:'',at:f.context.now,readAt:f.context.now,target:{view:'orders/detail',id:f.orderId}});
    expect(f.view('owner').notifications.map(n=>[n.id,n.readAt])).toEqual([['new',null]]);
    expect(f.view('sales').notifications).toEqual([]);
    f.run({type:'notification.readAll',payload:{}},'owner');
    expect(f.state.notifications.find(n=>n.id==='legacy')?.readBy).toBeUndefined();
  });
  it('收件关系不能绕过单据读取权限', () => {
    const f=fixture(); notifyMist(f.state,f.context,{title:'订单变更',detail:'',target:{view:'orders/detail',id:f.orderId}},['owner']);
    expect(f.view('owner',[]).notifications).toEqual([]);
  });
  it('QC回传关联发起人、订单负责人及采购经办，不按显示名猜账号', () => {
    const f=fixture();
    f.state.fulfillment.purchases.push({id:'po',orderId:f.orderId,requesterId:'buyer'} as never);
    f.state.fulfillment.stock.push({id:'stock',purchaseId:'po'} as never);
    f.state.fulfillment.qcTasks.push({id:'qc',requesterId:'initiator',requestedBy:'与其他人同名',source:{kind:'orderLine',orderId:f.orderId,lineId:'line'},incoming:{stockId:'stock'}} as never);
    expect(notificationOwners(f.state,'qc','qc')).toEqual(['initiator','owner','buyer']);
  });
  it('指派个人事项通知被指派人', () => {
    const f=fixture(); f.run({type:'task.save',payload:{title:'核对单据',due:'2026-10-15',assigneeId:'peer'}});
    expect(f.state.notifications[0].recipientIds).toEqual(['peer']);
  });
  it('财务确认应收通知订单负责人及开票人，而不是财务本人', () => {
    const f=fixture(); f.state.invoices.push({id:'invoice',code:'CI-N',orderId:f.orderId,order:'SO-N',customer:'模拟客户',due:'2026-12-01',amount:10,open:0,currency:'USD',issuedById:'peer',financeStatus:'pending'});
    f.run({type:'finance.receivable.confirm',payload:{invoiceId:'invoice'}},'finance');
    expect(f.state.notifications[0].recipientIds).toEqual(['owner','peer']);
    expect(f.state.notifications[0].title).toContain('财务确认应收');
  });

});
