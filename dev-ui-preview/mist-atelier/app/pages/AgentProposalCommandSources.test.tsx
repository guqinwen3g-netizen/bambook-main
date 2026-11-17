// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {MistRoot} from '../../../../components/mist';
import {createMistState} from '../../../../server/src/shared/mistWorkspace';
import {shippingSampleSourceSnapshot} from '../../../../server/src/shared/mistShipmentSampleCustody';
import {AgentProposalDialog} from './AgentProposalDialog';

function taskFixture(){
 const state=createMistState({id:()=>crypto.randomUUID(),now:'2026-11-18T04:00:00Z',actorName:'业务员'},'empty');
 state.devs=[{id:'private-dev-token',code:'DEV-2026-0003',name:'羊毛短外套',versionIds:['private-version-token'],currentVersionId:'private-version-token'}]as any;
 state.versions=[{id:'private-version-token',devId:'private-dev-token',label:'R1-A-1',factory:'江南成衣',factoryId:'private-factory-token',returnedAt:null,confirmations:[]}]as any;
 const taskClosePlans:any={'private-dev-token':{tasks:[{versionId:'private-version-token',label:'R1-A-1',factory:'江南成衣',canComplete:false,qcCount:0,originalLoanCount:0}],followups:{qcCount:0,originalLoanCount:0,financialPending:false}}};
 const proposal:any={id:'task-proposal',ownerId:'u',owner:'业务员',createdAt:'2026-11-18T04:00:00Z',state:'pending',summary:['private-version-token'],command:{type:'development.task.end',payload:{devId:'private-dev-token',versionId:'private-version-token',kind:'terminated',reason:'本轮排期调整'}}};
 return{state,proposal,taskClosePlans};
}
function shippingFixture(){
 const state=createMistState({id:()=>crypto.randomUUID(),now:'2026-11-19T14:00:00Z',actorName:'业务员'},'empty');
 state.orders=[{id:'private-order-token',type:'garment'}]as any;state.orderLines=[{id:'private-line-token',orderId:'private-order-token',unit:'件'}]as any;state.productions=[{id:'private-production-token',orderId:'private-order-token',lineId:'private-line-token'}]as any;
 state.fulfillment.shipments=[{id:'private-shipment-token',code:'SHP-2026-00007',domain:'garment',state:'departed',departedAt:'2026-11-19T14:00:00Z',departureEvidence:'原承运通知',lines:[{orderId:'private-order-token',lineId:'private-line-token',productionId:'private-production-token',quantity:8}]}]as any;
 state.fulfillment.packing=[{id:'private-box-token',shipmentId:'private-shipment-token',lineId:'private-line-token',productionId:'private-production-token',carton:'A01',quantity:8,assortment:[{color:'Blue',size:'M',quantity:8}]}]as any;
 const sample:any={id:'private-sample-token',code:'SMP-2026-00035',name:'衬衫船样',role:'shipping',shipmentId:'private-shipment-token',source:{kind:'orderLine',orderId:'private-order-token',lineId:'private-line-token',productionId:'private-production-token'},quantity:4,available:4,unit:'件',sizeQuantities:[{size:'M',quantity:4}],color:'Blue',location:'A01',positions:[{location:'A01',available:4}],fileIds:[],createdAt:'2026-11-18T04:00:00Z'};
 state.fulfillment.samples=[sample];
 const proposal:any={id:'shipping-proposal',ownerId:'u',owner:'业务员',createdAt:'2026-11-19T14:00:00Z',state:'pending',summary:['private-sample-token sourceSnapshot'],command:{type:'fulfillment.samples.shippingBasis',payload:{id:sample.id,kind:'included',sourceSnapshot:shippingSampleSourceSnapshot(state,sample),evidence:'核对原承运通知及箱内实物',fileIds:[],reconcileDeparted:true}}};
 return{state,proposal};
}
function mounted(props:any){
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;const host=document.createElement('div'),root=createRoot(host),run=vi.fn().mockResolvedValue({});document.body.append(host);
 const render=(next=props)=>act(()=>root.render(<MistRoot><AgentProposalDialog {...next} scopeKey="company:u" run={run} onClose={()=>{}} onDone={()=>{}}/></MistRoot>));render();
 return{host,run,render,button:(text:string)=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent===text)!,close:()=>{act(()=>root.unmount());host.remove();}};
}
it('reviews a factory action with current task labels and hides internal source identities',()=>{
 const f=taskFixture(),m=mounted(f);try{expect(m.host.textContent).toContain('结束工厂任务');expect(m.host.textContent).toContain('R1-A-1 · 江南成衣');expect(m.host.textContent).toContain('本轮排期调整');expect(m.host.textContent).not.toContain('private-');expect(m.button('确认执行').disabled).toBe(false);}finally{m.close();}
});
it('blocks factory action confirmation without a current server write plan, while rejection remains available',()=>{
 const f=taskFixture(),m=mounted({...f,taskClosePlans:{}});try{expect(m.button('确认执行').disabled).toBe(true);expect(m.button('拒绝').disabled).toBe(false);expect(m.host.textContent).not.toContain('private-');}finally{m.close();}
});
it('pins the reviewed factory followups and does not silently confirm newly arrived work',()=>{
 const f=taskFixture(),m=mounted(f);try{expect(m.button('确认执行').disabled).toBe(false);f.taskClosePlans['private-dev-token'].followups.qcCount=1;f.state.fulfillment.qcTasks=[{id:'private-qc-token',source:{kind:'version',devId:'private-dev-token',versionId:'private-version-token'},state:'pending'}]as any;m.render(f);expect(m.button('确认执行').disabled).toBe(true);expect(m.button('拒绝').disabled).toBe(false);}finally{m.close();}
});
it('reviews shipping quantity membership with readable sample and shipment instead of technical snapshots',()=>{
 const f=shippingFixture(),m=mounted({...f,canConfirmShippingBasis:true});try{expect(m.host.textContent).toContain('确认样品数量口径');expect(m.host.textContent).toContain('SMP-2026-00035');expect(m.host.textContent).toContain('SHP-2026-00007');expect(m.host.textContent).toContain('4 件');expect(m.host.textContent).not.toContain('sourceSnapshot');expect(m.host.textContent).not.toContain('private-');expect(m.button('确认执行').disabled).toBe(false);}finally{m.close();}
});
it('uses actual shipping write authority rather than the proposal claim',()=>{
 const f=shippingFixture(),m=mounted({...f,canConfirmShippingBasis:false});try{expect(m.button('确认执行').disabled).toBe(true);expect(m.button('拒绝').disabled).toBe(false);expect(m.host.textContent).not.toContain('sourceSnapshot');}finally{m.close();}
});
it('does not silently rebind a reviewed shipping proposal when physical custody changes',()=>{
 const f=shippingFixture(),props={...f,canConfirmShippingBasis:true},m=mounted(props);try{expect(m.button('确认执行').disabled).toBe(false);f.state.fulfillment.samples[0].positions=[{location:'A02',available:4}];m.render(props);expect(m.button('确认执行').disabled).toBe(true);expect(m.button('拒绝').disabled).toBe(false);}finally{m.close();}
});
