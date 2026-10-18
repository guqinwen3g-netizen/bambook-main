import {describe,it,expect} from 'vitest';
import {applyMistCommand,createMistState,mistCommandPermission,type MistContext,type MistCommand,type MistState} from './mistWorkspace';
import {readRfqs,rfqAwardFlags,rfqComparison} from './mistSourcing';

function fixture(){
  let id=0;const ctx={id:()=>`rfq-${++id}`,now:'2026-10-18T02:00:00Z',actorId:'demo-sales',actorName:'顾言',authority:{supplier:{'supplierCommitment.approvers.processing.garment':{version:1,userIds:['leader']}}}} as unknown as MistContext;
  let state=createMistState(ctx,'demo');
  const run=(command:MistCommand)=>{const result=applyMistCommand(state,command,ctx);state=result.state;return result.result as {id:string;purchaseId?:string;quoteId?:string};};
  const sup=(name:string)=>state.market.suppliers.find(s=>s.name===name)!.id;
  const as=<T,>(actorId:string,fn:()=>T)=>{const prev=ctx.actorId;ctx.actorId=actorId;try{return fn();}finally{ctx.actorId=prev;}};
  return {run,sup,as,get state(){return state as MistState;},get rfq(){return readRfqs(state)[0];}};
}
const input=(f:ReturnType<typeof fixture>,patch:Record<string,unknown>={})=>({orderId:'SO-G-2026-018',lineId:'SO-G-2026-018-line-0',kind:'processing',description:'双面羊毛大衣 CMT 加工',quantity:'1200',unit:'件',currency:'CNY',due:'2026-11-20',destination:'嘉兴成品仓',deadline:'2026-10-22',supplierIds:[f.sup('江南成衣'),f.sup('远山服装')],...patch});
const quote=(id:string,supplierId:string,patch:Record<string,unknown>={})=>({type:'rfq.quote',payload:{id,supplierId,price:'88',currency:'CNY',moq:'500',promisedDue:'2026-11-15',terms:'月结 30 天',validUntil:'2026-10-31',...patch}}) as MistCommand;

describe('供应商询价比价',()=>{
  it('发起询价：至少两家可合作供应商，截止日在今天与需求交期之间',()=>{
    const f=fixture();
    expect(()=>f.run({type:'rfq.save',payload:{input:input(f,{supplierIds:[f.sup('江南成衣')]})}} as MistCommand)).toThrow('至少邀请两家');
    expect(()=>f.run({type:'rfq.save',payload:{input:input(f,{supplierIds:[f.sup('江南成衣'),f.sup('恒彩印花')]})}} as MistCommand)).toThrow('已暂停合作');
    expect(()=>f.run({type:'rfq.save',payload:{input:input(f,{deadline:'2026-10-17'})}} as MistCommand)).toThrow('不能早于今天');
    expect(()=>f.run({type:'rfq.save',payload:{input:input(f,{deadline:'2026-11-21'})}} as MistCommand)).toThrow('不能晚于需求交期');
    expect(()=>f.run({type:'rfq.save',payload:{input:input(f,{lineId:'SO-G-2026-017-line-0'})}} as MistCommand)).toThrow('订单条目不存在');
    const {id}=f.run({type:'rfq.save',payload:{input:input(f)}} as MistCommand);
    expect(f.rfq).toMatchObject({id,code:'RFQ-2026-0002',state:'open',quantity:1200,currency:'CNY',domain:'garment'});
    expect(f.state.events.some(e=>e.entityType==='procurement'&&e.entityId===id&&e.text.includes('邀请 江南成衣、远山服装'))).toBe(true);
    expect(()=>f.run({type:'rfq.invite',payload:{id,supplierIds:[f.sup('江南成衣')]}} as MistCommand)).toThrow('尚未邀请');
    expect(mistCommandPermission({type:'rfq.save',payload:{input:input(f)}} as MistCommand)).toBe('procurement:write');
  });
  it('报价：仅限受邀供应商；重新报价保留历史；谢绝须写原因；比价折人民币并标出交期与 MOQ',()=>{
    const f=fixture();const {id}=f.run({type:'rfq.save',payload:{input:input(f)}} as MistCommand);
    expect(()=>f.run(quote(id,f.sup('宝泰辅料')))).toThrow('不在本次询价邀请名单');
    expect(()=>f.run(quote(id,f.sup('江南成衣'),{validUntil:'2026-10-10'}))).toThrow('有效期不能早于今天');
    f.run(quote(id,f.sup('江南成衣'),{price:'92'}));
    f.run(quote(id,f.sup('江南成衣'),{price:'86',promisedDue:'2026-11-25'}));
    f.run(quote(id,f.sup('远山服装'),{price:'12.5',currency:'USD',moq:'1500'}));
    expect(f.rfq.quotes).toHaveLength(3);expect(f.rfq.quotes[0].supersededAt).toBeTruthy();
    const cmp=rfqComparison(f.state,f.rfq,'2026-10-18');
    expect(cmp.basis).toBe('cny');
    expect(cmp.rows.map(r=>[r.quote.supplier,r.rank,r.lowest,r.late,r.moqOver])).toEqual([['江南成衣',1,true,true,false],['远山服装',2,false,false,true]]);
    expect(cmp.rows[1].cnyUnit).toBeCloseTo(12.5*7.118,6);
    expect(cmp.rows[0].grade).toBe('A');
    expect(()=>f.run({type:'rfq.quote',payload:{id,supplierId:f.sup('远山服装'),declined:true}} as MistCommand)).toThrow('谢绝原因');
  });
  it('定标：非最低价、单一来源、晚交期或 MOQ 超出须写理由；定标生成采购草稿并锁定询价',()=>{
    const f=fixture();const {id}=f.run({type:'rfq.save',payload:{input:input(f)}} as MistCommand);
    const a=f.run(quote(id,f.sup('江南成衣'),{price:'86'})).quoteId!;
    expect(rfqAwardFlags(f.state,f.rfq,a,'2026-10-18')).toEqual(['有效可比报价不足两家（单一来源）']);
    expect(()=>f.run({type:'rfq.award',payload:{id,quoteId:a}} as MistCommand)).toThrow('单一来源');
    const b=f.run(quote(id,f.sup('远山服装'),{price:'90'})).quoteId!;
    expect(()=>f.run({type:'rfq.award',payload:{id,quoteId:b}} as MistCommand)).toThrow('非最低价（排名第 2）');
    const {purchaseId}=f.run({type:'rfq.award',payload:{id,quoteId:b,reason:'江南成衣产能已排满，远山可保交期'}} as MistCommand);
    const po=f.state.fulfillment.purchases.find(p=>p.id===purchaseId)!;
    expect(po).toMatchObject({state:'draft',kind:'processing',supplier:'远山服装',quantity:1200,price:90,currency:'CNY',due:'2026-11-15',terms:'月结 30 天',orderId:'SO-G-2026-018',lineId:'SO-G-2026-018-line-0'});
    expect(po.note).toContain('询价 RFQ-2026-0002 定标（2 家报价）：江南成衣产能已排满');
    expect(f.rfq).toMatchObject({state:'awarded',award:{supplier:'远山服装',purchaseCode:po.code,flags:['非最低价（排名第 2）']}});
    expect(()=>f.run(quote(id,f.sup('江南成衣')))).toThrow('已定标');
    expect(()=>f.run({type:'rfq.cancel',payload:{id,reason:'x'}} as MistCommand)).toThrow('已定标');
  });
  it('最低价且满足交期可直接定标；谢绝或过期报价不能定标；取消须写原因',()=>{
    const f=fixture();const {id}=f.run({type:'rfq.save',payload:{input:input(f)}} as MistCommand);
    const a=f.run(quote(id,f.sup('江南成衣'),{price:'86'})).quoteId!;
    const d=f.run({type:'rfq.quote',payload:{id,supplierId:f.sup('远山服装'),declined:true,declineReason:'旺季产能不足'}} as MistCommand).quoteId!;
    expect(()=>f.run({type:'rfq.award',payload:{id,quoteId:d,reason:'x'}} as MistCommand)).toThrow('谢绝');
    f.run(quote(id,f.sup('远山服装'),{price:'95'}));
    expect(rfqAwardFlags(f.state,f.rfq,a,'2026-10-18')).toEqual([]);
    expect(f.run({type:'rfq.award',payload:{id,quoteId:a}} as MistCommand).purchaseId).toBeTruthy();
    const g=fixture();const r2=g.run({type:'rfq.save',payload:{input:input(g)}} as MistCommand).id;
    expect(()=>g.run({type:'rfq.cancel',payload:{id:r2,reason:''}} as MistCommand)).toThrow('取消原因');
    g.run({type:'rfq.cancel',payload:{id:r2,reason:'客户取消该款'}} as MistCommand);
    expect(g.rfq.state).toBe('cancelled');
  });
  it('在手合同转给其他供应商：已批准未收货整单转移，原合同取消、生产分支关闭，新供应商草稿重新审批',()=>{
    const f=fixture();const po=()=>f.state.fulfillment.purchases.find(p=>p.code==='PO-2026-00003')!;
    const transfer=(patch:Record<string,unknown>={})=>({type:'sourcing.purchase.transfer',payload:{purchaseId:po().id,supplierId:f.sup('江南成衣'),price:'88',currency:'CNY',due:'2026-11-18',reason:'远山服装产能被抽调，无法保交期',...patch}}) as MistCommand;
    expect(()=>f.run(transfer())).toThrow('尚未批准');
    f.run({type:'fulfillment.procurement.submit',payload:{id:po().id}} as MistCommand);
    f.as('leader',()=>f.run({type:'fulfillment.procurement.decide',payload:{id:po().id,decision:'approved',note:'同意'}} as MistCommand));
    const branch=f.state.productions.find(j=>j.sourcePurchaseId===po().id)!;expect(branch.closed).toBeUndefined();
    expect(()=>f.run(transfer({supplierId:po().supplierId}))).toThrow('须与原供应商不同');
    expect(()=>f.run(transfer({supplierId:f.sup('恒彩印花')}))).toThrow('已暂停合作');
    expect(()=>f.run(transfer({reason:' '}))).toThrow('转移原因');
    const received=f.state.fulfillment.purchases.find(p=>p.code==='PO-2026-00001')!;
    expect(()=>f.run(transfer({purchaseId:received.id}))).toThrow('已有收货，不能整单转移');
    const {id}=f.run(transfer());
    const next=f.state.fulfillment.purchases.find(p=>p.id===id)!, old=po();
    expect(old).toMatchObject({state:'cancelled',transferredTo:{purchaseId:id,purchaseCode:next.code,supplier:'江南成衣'}});
    expect(old.cancellation!.reason).toBe('转给 江南成衣：远山服装产能被抽调，无法保交期');
    expect(next).toMatchObject({state:'draft',supplier:'江南成衣',price:88,currency:'CNY',due:'2026-11-18',quantity:old.quantity,lineId:old.lineId,kind:'processing',terms:old.terms,transferredFrom:{purchaseCode:'PO-2026-00003',supplier:'远山服装'}});
    expect(f.state.productions.find(j=>j.id===branch.id)!.closed!.reason).toContain('PO-2026-00003 取消');
    expect(()=>f.run({type:'fulfillment.production.plan',payload:{productionId:branch.id,lines:[]}} as MistCommand)).toThrow('已随合同取消关闭');
    f.run({type:'fulfillment.procurement.submit',payload:{id}} as MistCommand);
    f.as('leader',()=>f.run({type:'fulfillment.procurement.decide',payload:{id,decision:'approved',note:'同意转单'}} as MistCommand));
    expect(f.state.productions.filter(j=>j.lineId===old.lineId&&!j.closed).map(j=>j.factory)).toEqual(['江南成衣']);
    expect(()=>f.run(transfer())).toThrow('已取消');
    expect(f.state.events.some(e=>e.entityId===id&&e.text.includes('由 PO-2026-00003（远山服装）转入 江南成衣'))).toBe(true);
  });
});
