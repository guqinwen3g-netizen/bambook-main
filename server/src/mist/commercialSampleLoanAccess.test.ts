import {expect,it} from 'vitest';
import type {TokenPayload} from '../auth/service';
import {createMistState,applyMistCommand} from '../shared/mistWorkspace';
import {stockDepartureAtomicFixture} from './__tests__/stockDepartureAtomic';
import {projectState,MIST_READ_SECTIONS} from './access';
import {projectCommercialSampleLoanSources} from './commercialSampleLoanAccess';
import {scopedWriteViolation} from '../shared/mistDataScope';
const actor=(userId='sales',permissions=['products:read','products:write'])=>({userId,companyId:'company-a',roles:[],permissions,authorizationLoaded:true,departmentIds:[]}as TokenPayload);
const empty=()=>createMistState({id:()=>'',now:'2026-10-13T12:00:00Z',actorName:'测试'},'empty');
const scope={userIds:['sales'],teamIds:[]};
it.each([false,true])('keeps a legal minimal projection without synthesizing sample collections (fulfillment present %s)',present=>{
 const state=empty();if(present)(state as any).fulfillment={};else delete(state as any).fulfillment;const before=structuredClone(state),who=actor('sales',[...new Set(MIST_READ_SECTIONS.flatMap(section=>section.permissions))]);
 const result=projectState(state,who,()=>structuredClone(before),'owner').state;
 expect(Object.prototype.hasOwnProperty.call(result,'fulfillment')).toBe(present);
 // The existing inventory projection supplies stockMovements; the loan projection must add neither sample collection.
 if(present){expect(result.fulfillment).toEqual({stockMovements:[]});expect(result.fulfillment).not.toHaveProperty('sampleMovements');}expect(state).toEqual(before);
});
it.each(['raw missing','raw empty','visible missing','visible empty','visible non-array'])('withholds commercial capabilities for %s sample collections without changing the input contract',kind=>{
 const x=stockDepartureAtomicFixture(),full=structuredClone(x.f.state),visible=structuredClone(full);
 if(kind==='raw missing')delete(full as any).fulfillment;if(kind==='raw empty')(full as any).fulfillment={};if(kind==='visible missing')delete(visible as any).fulfillment;if(kind==='visible empty')(visible as any).fulfillment={};if(kind==='visible non-array')(visible.fulfillment as any).samples={};
 const before=structuredClone([full,visible]);expect(projectCommercialSampleLoanSources(full,visible,actor(),undefined,'company-a')).toBeUndefined();expect([full,visible]).toEqual(before);
});
it('gives source-owner product writer a bounded action source without general inventory/financial reads',()=>{
 const x=stockDepartureAtomicFixture(),original=structuredClone(x.f.state),who=actor(),visible=projectState(structuredClone(original),who,empty,'owner',scope).state;
 expect(visible.fulfillment.stock).toEqual([]);expect(visible.fulfillment.purchases).toEqual([]);expect(visible.fulfillment.samples.some(s=>s.id===x.sampleId)).toBe(true);
 const metadata=projectCommercialSampleLoanSources(original,visible,who,scope,'company-a')!;
 expect(metadata[x.sampleId]).toMatchObject({status:'available',quantity:4,unit:'件',options:[{stockId:x.stockId,location:'成品仓',maxQuantity:4}]});
 expect(JSON.stringify(metadata)).not.toMatch(/price|currency|supplierId|receiptIds|sourceSnapshot|quantity":10/);expect(x.f.state).toEqual(original);
 x.f.context.members=[{id:'borrower',name:'同事',active:true,groups:[]}];const applied=applyMistCommand(original,{type:'fulfillment.samples.move',payload:{id:x.sampleId,kind:'lend',quantity:4,person:'',borrowerId:'borrower',location:'',note:'使用本人的精确来源'}},x.f.context).state;
 expect(scopedWriteViolation(original,applied,scope)).toBeNull();
 expect(scopedWriteViolation(original,applied,{userIds:['unrelated-owner'],teamIds:[]})).not.toBeNull();
 const projected=projectState(structuredClone(applied),who,empty,'owner',scope).state,loan=projected.fulfillment.sampleMovements.find(m=>m.kind==='lend'&&m.sampleId===x.sampleId)!;
 expect(loan.commercialLoan).toBeUndefined();expect(loan.commercialReturn).toEqual({quantity:4,unit:'件',location:'A01'});expect(JSON.stringify(projected.fulfillment.sampleMovements)).not.toContain(x.stockId);
});
it('never gives a borrower extra order/sample access merely because their account is recorded in an order-source loan',()=>{
 const x=stockDepartureAtomicFixture();x.f.context.members=[{id:'borrower',name:'同事',active:true,groups:[]}];x.f.run({type:'fulfillment.samples.move',payload:{id:x.sampleId,kind:'lend',quantity:4,person:'',borrowerId:'borrower',location:'',note:'来源权限保持'}});
 const who=actor('borrower'),ownScope={userIds:['borrower'],teamIds:[]},visible=projectState(structuredClone(x.f.state),who,empty,'owner',ownScope).state;
 expect(visible.fulfillment.samples.find(s=>s.id===x.sampleId)).toBeUndefined();expect(visible.orders).toEqual([]);expect(projectCommercialSampleLoanSources(x.f.state,visible,who,ownScope,'company-a')).toBeUndefined();
});
it('distinguishes a read-only role and rejects hidden sample/cross-company metadata',()=>{
 const x=stockDepartureAtomicFixture(),who=actor('sales',['products:read']),visible=projectState(structuredClone(x.f.state),who,empty,'owner',scope).state;
 expect(projectCommercialSampleLoanSources(x.f.state,visible,who,scope,'company-a')?.[x.sampleId]).toMatchObject({status:'forbidden'});
 expect(projectCommercialSampleLoanSources(x.f.state,visible,{...actor(),companyId:'other'},scope,'company-a')).toBeUndefined();
 visible.fulfillment.samples=[];expect(projectCommercialSampleLoanSources(x.f.state,visible,actor(),scope,'company-a')).toBeUndefined();
});
