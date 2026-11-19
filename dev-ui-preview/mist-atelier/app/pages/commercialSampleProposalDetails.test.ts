import {expect,it,vi} from 'vitest';
import {stockDepartureAtomicFixture} from '../../../../server/src/mist/__tests__/stockDepartureAtomic';
import {commercialSampleLoanSources} from '../../../../server/src/shared/mistCommercialSampleLoan';
import {commercialSampleProposalDetails} from './commercialSampleProposalDetails';
import type {AgentProposalCommandBody} from '../../../../server/src/shared/mistAgentProposals';

function fixture(processing=false){
 const x=stockDepartureAtomicFixture(processing);x.f.context.members=[{id:'borrower',name:'借用同事',active:true,groups:[]}];x.f.state.members=[{userId:'borrower',name:'借用同事',addedBy:'sales',addedByName:'业务员',addedAt:x.f.context.now}];
 const sample=x.f.state.fulfillment.samples.find(s=>s.id===x.sampleId)!,caps={[sample.id]:commercialSampleLoanSources(x.f.state,sample)},command:AgentProposalCommandBody={type:'fulfillment.samples.move',payload:{id:sample.id,kind:'lend',quantity:4,borrowerId:'borrower',person:'借用同事',location:'A01',note:'原颜色尺码完整组合，使用后原位归还',expectedReturn:'2026-10-14'}};
 return{x,sample,caps,command,review:()=>commercialSampleProposalDetails(command,x.f.state,caps,true,x.f.context.now)!};
}
it('shows the current unique commercial source, whole group and original text without UUIDs or technical JSON',()=>{
 const f=fixture(),original=structuredClone(f.x.f.state),review=f.review();expect(review.reason).toBe('');expect(review.title).toBe('借出商业内样');const text=review.rows.map(row=>row.value).join(' ');expect(text).toContain(f.sample.code);expect(text).toContain('M × 1');expect(text).toContain('L × 3');expect(text).toContain('成品仓');expect(text).toContain('4 件');expect(text).toContain('借用同事');expect(text).toContain(f.command.payload.note);expect(text).not.toContain(f.sample.id);expect(text).not.toContain(f.x.stockId);expect(text).not.toContain('sourceSnapshot');expect(text).not.toContain('commercialSources');expect(review.fingerprint).not.toBe('');expect(f.x.f.state).toEqual(original);
});
it.each(['sampleLoan','commercialLoan','commercialReturn','reservationIds','hiddenFlag'])('blocks extra %s fields without rendering an unreviewed instruction',field=>{
 const f=fixture();f.command.payload[field]='override';const review=f.review();expect(review.reason).not.toBe('');expect(review.rows).toEqual([]);expect(review.fingerprint).toBe('');
});
it.each(['unreadable','forbidden','unavailable','insufficient']as const)('fails closed for a current %s capsule',status=>{
 const f=fixture();f.caps[f.sample.id]={status,reason:'当前来源不能办理'};expect(f.review().reason).toBe('当前来源不能办理');expect(f.review().rows).toEqual([]);
});
it('requires current authority and a current action capsule, rather than a model-supplied capability',()=>{
 const f=fixture();expect(commercialSampleProposalDetails(f.command,f.x.f.state,f.caps,false,f.x.f.context.now)!.reason).toMatch(/当前账号/);expect(commercialSampleProposalDetails(f.command,f.x.f.state,undefined,true,f.x.f.context.now)!.reason).toMatch(/未读取/);expect(commercialSampleProposalDetails(f.command,null,f.caps,true,f.x.f.context.now)!.reason).toMatch(/读取/);
});
it.each(['quantity','unit','source','group','borrower','date','position'])('blocks changed %s facts',change=>{
 const f=fixture();if(change==='quantity')f.command.payload.quantity=5;if(change==='unit')f.sample.unit='份';if(change==='source'&&f.sample.source.kind==='orderLine')f.sample.source.orderId='other-order';if(change==='group')f.command.payload.quantity=1;if(change==='borrower')f.command.payload.borrowerId='hidden-member';if(change==='date')f.command.payload.expectedReturn='2026-10-12';if(change==='position')f.command.payload.sourceLocation='not-a-position';expect(f.review().reason).not.toBe('');expect(f.review().rows).toEqual([]);
});
it('requires explicit choices for ambiguous locations and accepts only exact current selections',()=>{
 const f=fixture(),cap=f.caps[f.sample.id];if(cap.status!=='available')throw Error('fixture');cap.options.push({...cap.options[0],location:'B01',label:'原批次 · B01'});f.x.f.state.fulfillment.stock[0].positions=[{location:cap.options[0].location,available:6},{location:'B01',available:4}];expect(f.review().reason).toMatch(/请选择准确商业来源/);
 f.command.payload.commercialSources=[{stockId:f.x.stockId,location:'B01',quantity:4}];expect(f.review().reason).toBe('');expect(f.review().rows.some(row=>row.value==='B01')).toBe(true);
 f.command.payload.commercialSources=[{stockId:'other-stock',location:'B01',quantity:4}];expect(f.review().reason).toMatch(/来源或可借数量/);
 f.command.payload.commercialSources=[{stockId:f.x.stockId,location:'B01',quantity:4,sampleLoan:true}];expect(f.review().reason).not.toBe('');
});
it('rejects duplicate allocations and allocations exceeding the current capsule maximum',()=>{
 const f=fixture(),cap=f.caps[f.sample.id];if(cap.status!=='available')throw Error('fixture');cap.options[0].maxQuantity=3;f.command.payload.commercialSources=[{stockId:f.x.stockId,location:cap.options[0].location,quantity:4}];expect(f.review().reason).toMatch(/可借数量/);cap.options[0].maxQuantity=4;f.command.payload.commercialSources=[{stockId:f.x.stockId,location:cap.options[0].location,quantity:2},{stockId:f.x.stockId,location:cap.options[0].location,quantity:2}];expect(f.review().reason).toMatch(/重复/);
});
it('rechecks visible stock source identity while respecting a product-only capsule when inventory is hidden',()=>{
 const f=fixture();const original=f.x.f.state.fulfillment.stock;f.x.f.state.fulfillment.stock=[];expect(f.review().reason).toBe('');f.x.f.state.fulfillment.stock=original;original[0].orderId='other-order';expect(f.review().reason).toMatch(/原商业来源不匹配/);
});
it('reviews direct handover without making up a warehouse or accepting a stock choice',()=>{
 const f=fixture(true);expect(f.review().reason).toBe('');expect(f.review().rows.some(row=>row.value==='原直交实物')).toBe(true);f.command.payload.commercialSources=[];expect(f.review().reason).toMatch(/不能改选仓储/);
});
it('returns by the original visible commercialReturn summary without inventory IDs or a fresh lend capability',()=>{
 const f=fixture(),id=f.x.f.run(f.command as any).id!,loan=f.x.f.state.fulfillment.sampleMovements.find(row=>row.id===id)!,raw=loan.commercialLoan!;loan.commercialReturn={quantity:raw.quantity,unit:raw.unit,location:raw.sampleLocation};delete loan.commercialLoan;f.x.f.state.fulfillment.stock=[];
 f.command.payload={id:f.sample.id,kind:'return',loanId:id,quantity:4,person:'',location:'A01',note:'按原组合完整归还'};const review=commercialSampleProposalDetails(f.command,f.x.f.state,undefined,true,f.x.f.context.now)!;expect(review.reason).toBe('');expect(review.title).toBe('归还商业内样');expect(review.rows).toContainEqual(expect.objectContaining({field:'原归还位置',value:'A01'}));const text=review.rows.map(row=>row.value).join(' ');expect(text).not.toContain(id);expect(text).not.toContain(f.x.stockId);
 f.command.payload.location='另一个仓库';expect(commercialSampleProposalDetails(f.command,f.x.f.state,undefined,true,f.x.f.context.now)!.reason).toMatch(/原借出位置/);
});
it('blocks lost original loans, changed return units and already returned balances',()=>{
 for(const issue of ['missing','unit','returned']){const f=fixture(),id=f.x.f.run(f.command as any).id!,loan=f.x.f.state.fulfillment.sampleMovements.find(row=>row.id===id)!;f.command.payload={id:f.sample.id,kind:'return',loanId:id,quantity:4,person:'',location:'A01',note:'原组归还'};
  if(issue==='missing')f.x.f.state.fulfillment.sampleMovements=f.x.f.state.fulfillment.sampleMovements.filter(row=>row.id!==id);if(issue==='unit')loan.commercialLoan!.unit='份';if(issue==='returned')f.x.f.state.fulfillment.sampleMovements.push({...loan,id:'returned-id',kind:'return',loanId:id});expect(f.review().reason).not.toBe('');expect(f.review().rows).toEqual([]);
 }
});
it('fingerprints current caps, loans and source facts, and does not clone unrelated company state',()=>{
 const f=fixture(),first=f.review();const cap=f.caps[f.sample.id];if(cap.status!=='available')throw Error('fixture');cap.options[0].label+=' · 已核库位';expect(f.review().fingerprint).not.toBe(first.fingerprint);const second=f.review();f.x.f.state.fulfillment.packing[0].note='当前装箱事实变化';expect(f.review().fingerprint).not.toBe(second.fingerprint);const third=f.review();
 Object.defineProperty(f.x.f.state,'unrelatedCompanyData',{get:()=>{throw Error('must not clone whole company');}});const spy=vi.spyOn(globalThis,'structuredClone').mockImplementation(()=>{throw Error('whole-state clone forbidden');});try{expect(f.review().fingerprint).toBe(third.fingerprint);}finally{spy.mockRestore();}
});
it('shows all 4000 characters and blocks longer original text instead of clipping it',()=>{
 const f=fixture();f.command.payload.note='甲'.repeat(4000);expect(f.review().rows.find(row=>row.field==='交接说明')?.value).toBe(f.command.payload.note);f.command.payload.note+='乙';expect(f.review().reason).toMatch(/内容过多/);expect(f.review().rows).toEqual([]);
});
it('leaves unrelated and independent sample flows to their own formatter',()=>{
 const f=fixture();expect(commercialSampleProposalDetails({type:'calendar.save',payload:{}},f.x.f.state,f.caps,true,f.x.f.context.now)).toBeNull();f.sample.shippingQuantityBasis!.kind='independent';expect(f.review()).toBeNull();
});
it('fails closed for a malformed commercial payload or incomplete current capability',()=>{
 const f=fixture();expect(commercialSampleProposalDetails({type:'fulfillment.samples.move',payload:null}as any,f.x.f.state,f.caps,true,f.x.f.context.now)!.reason).not.toBe('');const cap=f.caps[f.sample.id];if(cap.status!=='available')throw Error('fixture');(cap as any).options=undefined;expect(f.review().reason).not.toBe('');
});
it('includes visible current stock facts in the fingerprint and blocks a stale over-allocation',()=>{
 const f=fixture(),first=f.review(),stock=f.x.f.state.fulfillment.stock[0];stock.available=9;stock.positions=[{location:stock.location,available:9}];expect(f.review().reason).toBe('');expect(f.review().fingerprint).not.toBe(first.fingerprint);
 stock.reservations=[{id:'other-reservation',orderId:f.x.otherOrderId,lineId:f.x.otherLineId,purpose:'其它订单实际预留',quantity:8,at:f.x.f.context.now,actor:'业务员'}];expect(f.review().reason).toMatch(/可借合计/);
});
