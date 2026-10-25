import {expect,it} from 'vitest';
import {createMistState,type MistContext} from './mistWorkspace';
import {applyFulfillmentCommand,fulfillmentDocumentFamily,type FulfillmentCommand} from './mistFulfillment';

function fixture(){
 let sequence=0;const context:MistContext={id:()=>`document-${++sequence}`,now:'2026-10-08T08:18:00Z',actorName:'后勤',actorId:'ops'};
 const state=createMistState(context,'empty');state.orders.push({id:'order',code:'SO-1',type:'garment',currency:'EUR'} as any);
 state.fulfillment.shipments.push({id:'shipment',code:'SHP-1',state:'preparing',lines:[{orderId:'order',lineId:'line',quantity:10}]} as any,{id:'other-shipment',code:'SHP-2',state:'preparing',lines:[{orderId:'order',lineId:'line',quantity:10}]} as any);
 const save=(number:string,patch:Record<string,unknown>={})=>{const result=applyFulfillmentCommand(state,{type:'fulfillment.documents.save',payload:{shipmentId:'shipment',orderId:'',type:'OTHER',number,title:'外部原件',dueDate:'',content:'机构原件',fileIds:[],...patch}} as FulfillmentCommand,context);return state.fulfillment.documents.find(d=>d.id===result.id)!;};
 return{state,save};
}

it('starts unrelated factory and booking originals at independent version1',()=>{
 const f=fixture(),packing=f.save('PK-1'),booking=f.save('BOOK-1');
 expect([packing.version,booking.version]).toEqual([1,1]);expect(packing.familyId).toBe(packing.id);expect(booking.familyId).toBe(booking.id);
});

it('keeps a corrected external original in its explicit family when its number changes',()=>{
 const f=fixture(),packing=f.save('PK-1'),booking=f.save('BOOK-1'),correction=f.save('PK-CORRECTED',{baseDocumentId:packing.id});
 expect(correction.familyId).toBe(packing.id);expect(correction.version).toBe(2);expect(booking.version).toBe(1);
 const next=f.save('PK-THIRD',{baseDocumentId:correction.id});expect(next.familyId).toBe(packing.id);expect(next.version).toBe(3);
});

it.each([{shipmentId:'other-shipment'},{type:'PL'},{orderId:'order'}])('rejects a version source from a different shipment, type or order: %j',patch=>{
 const f=fixture(),base=f.save('PK-1'),before=structuredClone(f.state);
 expect(()=>f.save('WRONG',{baseDocumentId:base.id,...patch})).toThrow('版本来源');expect(f.state).toEqual(before);
});

it('does not let editing an existing draft move it into another family',()=>{
 const f=fixture(),packing=f.save('PK-1'),booking=f.save('BOOK-1'),before=structuredClone(f.state);
 expect(()=>f.save('PK-1',{id:packing.id,baseDocumentId:booking.id})).toThrow('版本来源');expect(f.state).toEqual(before);
});

it('retains the family and version when an unrelated draft is edited',()=>{
 const f=fixture(),packing=f.save('PK-1');f.save('BOOK-1');const edited=f.save('PK-UPDATED',{id:packing.id,content:'修正草稿'});
 expect(edited.familyId).toBe(packing.id);expect(edited.version).toBe(1);expect(f.state.fulfillment.documents).toHaveLength(2);
});

it('preserves the existing PL version sequence within one shipment',()=>{
 const f=fixture(),first=f.save('PL-1',{type:'PL'}),second=f.save('PL-2',{type:'PL',baseDocumentId:first.id});expect([first.version,second.version]).toEqual([1,2]);
});

it('reads legacy unrelated external originals independently without rewriting their stored versions',()=>{
 const f=fixture(),first=f.save('PK-1'),second=f.save('BOOK-1');delete first.familyId;delete second.familyId;second.version=2;const before=structuredClone(f.state);
 expect(fulfillmentDocumentFamily(first)).not.toBe(fulfillmentDocumentFamily(second));expect(f.state).toEqual(before);
});
it('rejects a missing explicit version source without creating a document',()=>{
 const f=fixture(),before=structuredClone(f.state);expect(()=>f.save('WRONG',{baseDocumentId:'missing'})).toThrow('版本来源');expect(f.state).toEqual(before);
});
