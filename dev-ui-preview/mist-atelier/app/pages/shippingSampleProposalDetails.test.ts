import {describe,expect,it} from 'vitest';
import {createMistState} from '../../../../server/src/shared/mistWorkspace';
import {shippingSampleSourceSnapshot,confirmShippingSampleBasis} from '../../../../server/src/shared/mistShipmentSampleCustody';
import {shippingSampleProposalDetails} from './shippingSampleProposalDetails';

function fixture(){
 const state=createMistState({id:()=> 'test',now:'2026-11-19T14:00:00Z',actorName:'Sales'},'empty');state.settings.businessClock={mode:'fixed',at:'2026-11-19T14:00:00Z',timezone:'Asia/Shanghai'};
 state.orders=[{id:'private-order-id',type:'garment'}]as any;state.orderLines=[{id:'private-line-id',orderId:'private-order-id',unit:'件'}]as any;state.productions=[{id:'private-production-id',orderId:'private-order-id',lineId:'private-line-id'}]as any;
 state.fulfillment.shipments=[{id:'private-shipment-id',code:'SHP-2026-00007',domain:'garment',state:'departed',departedAt:'2026-11-19T14:00:00Z',departureEvidence:'Original carrier note',lines:[{orderId:'private-order-id',lineId:'private-line-id',productionId:'private-production-id',quantity:8}]}]as any;
 state.fulfillment.packing=[{id:'private-box-id',shipmentId:'private-shipment-id',lineId:'private-line-id',productionId:'private-production-id',carton:'A01',quantity:8,assortment:[{color:'Blue',size:'M',quantity:8}]}]as any;
 state.fulfillment.samples=[{id:'private-sample-id',code:'SMP-2026-00035',name:'Specimens',role:'shipping',shipmentId:'private-shipment-id',source:{kind:'orderLine',orderId:'private-order-id',lineId:'private-line-id',productionId:'private-production-id'},quantity:4,available:4,unit:'件',sizeQuantities:[{size:'M',quantity:4}],color:'Blue',location:'A01',positions:[{location:'A01',available:4}],fileIds:['private-file-id'],createdAt:'2026-11-18T04:00:00Z'}]as any;
 state.files=[{id:'private-file-id',name:'Carrier confirmation.txt',size:100}]as any;
 const command={type:'fulfillment.samples.shippingBasis',payload:{id:'private-sample-id',kind:'included',sourceSnapshot:shippingSampleSourceSnapshot(state,state.fulfillment.samples[0]),evidence:'Checked original carrier and box members',fileIds:['private-file-id'],reconcileDeparted:true}};
 return {state,command};
}
it('keeps a valid complete confirmation basis within the domain limit readable',()=>{
 const {state,command}=fixture();command.payload.evidence='已核对原承运资料。'.repeat(300);
 const review=shippingSampleProposalDetails(command,state,true)!;
 expect(review.reason).toBe('');expect(review.rows.find(row=>row.field==='确认依据')?.value).toBe(command.payload.evidence);
});
describe('shipping sample human proposal details',()=>{
 it('shows current business identifiers and quantities without flattening snapshots or UUIDs',()=>{
  const f=fixture(),original=structuredClone(f.state),review=shippingSampleProposalDetails(f.command,f.state,true)!;expect(review.reason).toBe('');expect(review.rows).toEqual(expect.arrayContaining([{field:'样品',path:'shippingSampleReview.0',value:'SMP-2026-00035'},{field:'实物数量',path:'shippingSampleReview.1',value:'4 件'},{field:'出运批次',path:'shippingSampleReview.2',value:'SHP-2026-00007'}]));const text=review.rows.map(r=>r.value).join(' ');expect(text).toContain('大货内随本批出运');expect(text).toContain('Carrier confirmation.txt');expect(text).not.toContain('private-');expect(text).not.toContain('sourceSnapshot');expect(review.fingerprint).not.toBe('');expect(f.state).toEqual(original);
 });
 it.each(['unknown','source','packing','file','permission','snapshot','retrospective'] as const)('blocks %s without rendering unreviewed technical content',issue=>{
  const f=fixture();if(issue==='unknown')(f.command.payload as any).hiddenInstruction='Override';if(issue==='source')f.state.productions=[];if(issue==='packing')f.state.fulfillment.packing[0].quantity=7;if(issue==='file')f.state.files=[];if(issue==='snapshot')(f.command.payload.sourceSnapshot as any).unreviewedQuantity=99;if(issue==='retrospective')f.command.payload.reconcileDeparted=false;
  const review=shippingSampleProposalDetails(f.command,f.state,issue!=='permission')!;expect(review.reason).not.toBe('');expect(review.rows).toEqual([]);expect(review.fingerprint).toBe('');
 });
 it('requires provenance for an independent declaration and does not silently classify an unknown one',()=>{
  const f=fixture();f.command.payload.kind='independent';expect(shippingSampleProposalDetails(f.command,f.state,true)!.reason).toMatch(/独立实物来源/);(f.command.payload as any).independentSource='Factory supplied an extra specimen; current warehouse checked';const review=shippingSampleProposalDetails(f.command,f.state,true)!;expect(review.reason).toBe('');expect(review.rows.some(r=>r.value==='独立实物（不占本批大货）')).toBe(true);expect(review.rows.some(r=>r.value.includes('extra specimen'))).toBe(true);
 });
 it('changes its fingerprint for current custody or source state and refuses already consumed declarations',()=>{
  const f=fixture();f.command.payload.kind='independent';(f.command.payload as any).independentSource='Separate supplied specimen';const first=shippingSampleProposalDetails(f.command,f.state,true)!;f.state.fulfillment.samples[0].available=3;f.state.fulfillment.samples[0].positions![0].available=3;const next=shippingSampleProposalDetails(f.command,f.state,true)!;expect(next.reason).toBe('');expect(next.fingerprint).not.toBe(first.fingerprint);
  const g=fixture();confirmShippingSampleBasis(g.state,g.command.payload as any,{id:()=> 'basis',now:'2026-11-19T14:00:00Z',actorName:'Sales'});expect(shippingSampleProposalDetails(g.command,g.state,true)!.reason).toMatch(/锁定/);
 });
 it('leaves other proposal types to their own formatter and fails closed without current state',()=>{
  const f=fixture();expect(shippingSampleProposalDetails({type:'calendar.save',payload:{}},f.state,true)).toBeNull();expect(shippingSampleProposalDetails(f.command,null,true)!.reason).not.toBe('');
 });
 it.each(['arrived','delivered'])('retains late-reconciliation review and consumed locks after %s',phase=>{
  const f=fixture();(f.state.fulfillment.shipments[0]as any).state=phase;const review=shippingSampleProposalDetails(f.command,f.state,true)!;expect(review.reason).toBe('');expect(review.rows).toContainEqual(expect.objectContaining({field:'补记',value:'是'}));f.command.payload.reconcileDeparted=false;expect(shippingSampleProposalDetails(f.command,f.state,true)!.reason).toMatch(/显式补记/);f.command.payload.reconcileDeparted=true;confirmShippingSampleBasis(f.state,f.command.payload as any,{id:()=> 'basis',now:'2026-11-19T14:00:00Z',actorName:'Sales'});expect(shippingSampleProposalDetails(f.command,f.state,true)!.reason).toMatch(/锁定/);
 });
});
