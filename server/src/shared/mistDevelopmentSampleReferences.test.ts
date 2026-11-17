import {expect,it} from 'vitest';
import {developmentReferenceFixture} from './__tests__/utils/developmentReferences';
import {retainFixtureFactoryTasks} from './__tests__/utils/devClose';
import {developmentTaskClosePlan} from './mistDevelopmentTaskLifecycle';
it('links the existing physical sample for comparison without duplicating its inventory, origin, files or factory sample/QC facts',()=>{
 const f=developmentReferenceFixture(),before=structuredClone(f.state),linked=f.link();expect(linked.referenceId).toBeTruthy();
 expect((f.dev() as any).sampleReferences).toHaveLength(1);expect((f.dev() as any).sampleReferences[0]).toMatchObject({id:linked.referenceId,sampleId:f.sampleId,purpose:'仅作颜色、手感与结构对照，不作主料',linkedById:'sales'});
 expect(f.state.fulfillment).toEqual(before.fulfillment);expect(f.state.files).toEqual(before.files);expect(f.state.versions).toEqual(before.versions);expect(f.sample().registeredById).toBe('sales');expect(f.sample().source).toEqual({kind:'manual',description:'公司留样'});
});
it('lends the original at an exact position to an external same-name contact and returns only the exact loan in two parts',()=>{
 const f=developmentReferenceFixture(),original=structuredClone(f.sample()),ref=f.link().referenceId,out=f.dispatch(ref);expect(out.movementIds).toHaveLength(1);
 const loan=f.state.fulfillment.sampleMovements.find(m=>m.id===out.movementIds[0])!;expect(loan).toMatchObject({sampleId:f.sampleId,kind:'lend',quantity:.5,borrowerId:'',sourceLocation:'样品架 C03',referenceTransfer:{devId:f.devId,taskVersionId:f.taskId,referenceId:ref,direction:'out'}});expect(f.sample().available).toBe(.75);
 f.back(out.dispatchId,loan.id,.2);expect(f.sample().available).toBe(.95);f.back(out.dispatchId,loan.id,.3);expect(f.sample().available).toBe(1.25);
 for(const key of ['source','registeredById','quantity','unit','fileIds','createdAt'] as const)expect(f.sample()[key]).toEqual(original[key]);expect(f.state.fulfillment.samples).toHaveLength(1);expect(f.dev().billing?.expenses||[]).toEqual([]);
});
it('counts the exact outstanding reference loan when closing the case and allows its real return after closure without starting new factory work',()=>{
 const f=developmentReferenceFixture(),ref=f.link().referenceId,out=f.dispatch(ref);expect(developmentTaskClosePlan(f.state,f.dev()).followups.originalLoanCount).toBe(1);
 f.run({type:'development.close',payload:{devId:f.devId,kind:'archived',reason:'本阶段收口，保留原段归还',...retainFixtureFactoryTasks(f.state,f.devId)}});
 expect(()=>f.dispatch(ref)).toThrow(/已结束|先恢复/);f.back(out.dispatchId,out.movementIds[0],.5);expect(f.sample().available).toBe(1.25);expect(f.dev().closure?.kind).toBe('archived');
});
it('refuses client identity and rechecks one existing relation while preserving its previous trusted snapshot',()=>{
 const f=developmentReferenceFixture();expect(()=>f.link({registeredById:'same-name'})).toThrow(/身份|服务端|字段/);const first=f.link();const again=f.link();expect(again.referenceId).toBe(first.referenceId);expect((f.dev() as any).sampleReferences).toHaveLength(1);const old=structuredClone((f.dev() as any).sampleReferences[0].snapshots);f.sample().color='深灰';const updated=f.link();expect(updated.referenceId).toBe(first.referenceId);const refs=(f.dev() as any).sampleReferences;expect(refs).toHaveLength(1);expect(refs[0].snapshots.slice(0,-1)).toEqual(old);expect(refs[0].snapshots.at(-1).facts.color).toBe('深灰');expect(f.state.fulfillment.samples).toHaveLength(1);
});
it('refuses dispatch after its trusted sample identity/specification source changed and never converts a reference into a factory return',()=>{
 const f=developmentReferenceFixture(),ref=f.link().referenceId;f.sample().unit='码';const before=structuredClone(f.state);expect(()=>f.dispatch(ref)).toThrow(/资料.*变化|来源.*变化|重新引用/);expect(f.state).toEqual(before);expect(f.state.versions.find(v=>v.id===f.taskId)?.returnedAt).toBeNull();expect(f.state.fulfillment.qcTasks).toHaveLength(0);
});
it('records one company postage expense for a parcel with two existing reference objects and cannot withdraw an outstanding loan',()=>{
 const f=developmentReferenceFixture(),ref1=f.link().referenceId,second=f.run({type:'fulfillment.samples.create',payload:{name:'棉平纹',category:'面料',form:'米样',quantity:1,unit:'米',location:'B02',size:'',color:'灰',note:'完整参考段',fileIds:[],source:{kind:'manual',description:'公司留样'}}}).id;
 const ref2=f.run({type:'development.reference.add',payload:{devId:f.devId,sampleId:second,purpose:'手感对照',fileIds:[]}}).referenceId;
 const out=f.dispatch(ref1,{items:[{referenceId:ref1,quantity:.25,sourceLocation:'样品架 C03'},{referenceId:ref2,quantity:.25,sourceLocation:'B02'}],delivery:{kind:'courier',recipient:'工厂收件人',address:'工厂样品室',carrier:'承运人',trackingNo:'LOCAL-REF-01',evidence:''},postage:{amount:5,currency:'CNY',zeroReason:''}});
 expect(out.movementIds).toHaveLength(2);expect(f.dev().billing?.expenses).toHaveLength(1);expect(f.dev().billing?.expenses?.[0]).toMatchObject({amount:5,currency:'CNY',sourceDispatchId:out.dispatchId,sourceMovementIds:out.movementIds});
 expect(f.state.fulfillment.sampleMovements.filter(m=>m.referenceTransfer?.dispatchId===out.dispatchId&&m.referenceTransfer.postage)).toHaveLength(1);
 expect(()=>f.run({type:'development.reference.remove',payload:{devId:f.devId,referenceId:ref1,reason:'停止参考'}})).toThrow(/尚未归还/);
});
it('does not borrow a commercial shipping specimen with an unknown quantity basis through a development reference',()=>{
 const f=developmentReferenceFixture();f.state.orders.push({id:'commercial-order',type:'garment',ownerId:'sales',customerId:'customer'} as any);f.state.orderLines.push({id:'commercial-line',orderId:'commercial-order',qty:8,price:42,unit:'件'} as any);f.state.productions.push({id:'commercial-production',orderId:'commercial-order',lineId:'commercial-line'} as any);
 f.state.fulfillment.shipments.push({id:'commercial-shipment',code:'SHP-REF',state:'ready',domain:'garment',lines:[{orderId:'commercial-order',lineId:'commercial-line',productionId:'commercial-production',quantity:8}]} as any);
 Object.assign(f.sample(),{category:'成衣',unit:'件',quantity:2,available:2,role:'shipping',shipmentId:'commercial-shipment',source:{kind:'orderLine',orderId:'commercial-order',lineId:'commercial-line',productionId:'commercial-production'},sizeQuantities:[{size:'M',quantity:1},{size:'L',quantity:1}]});
 const ref=f.link().referenceId,before=structuredClone(f.state);expect(()=>f.dispatch(ref,{items:[{referenceId:ref,quantity:2,sourceLocation:'样品架 C03'}]})).toThrow(/数量口径/);expect(f.state).toEqual(before);expect(f.sample().shippingQuantityBasis).toBeUndefined();
});
it('can withdraw a no-loan relation after its original object disappears while preserving the trusted comparison history',()=>{
 const f=developmentReferenceFixture(),ref=f.link().referenceId,snapshots=structuredClone((f.dev() as any).sampleReferences[0].snapshots);f.state.fulfillment.samples=[];
 f.run({type:'development.reference.remove',payload:{devId:f.devId,referenceId:ref,reason:'原实物已不再可用'}});expect((f.dev() as any).sampleReferences[0].withdrawn.reason).toBe('原实物已不再可用');expect((f.dev() as any).sampleReferences[0].snapshots).toEqual(snapshots);
});
it('rejects malformed reference payloads as domain validation failures before touching business state',()=>{
 const f=developmentReferenceFixture(),before=structuredClone(f.state);
 for(const payload of [null,[],{devId:f.devId,sampleId:f.sampleId,purpose:'颜色对照',fileIds:null}])expect(()=>f.run({type:'development.reference.add',payload})).toThrow(/格式无效|原件/);
 expect(f.state).toEqual(before);
});
it('requires a fresh reference recheck after source original ordering changes while an existing loan can still be returned',()=>{
 const f=developmentReferenceFixture();f.state.files.push({id:'other-original',name:'补充说明.txt',mimeType:'text/plain',size:1,storageKey:'fixture/other-original',createdAt:f.ctx.now});f.sample().fileIds.push('other-original');
 const ref=f.link().referenceId,out=f.dispatch(ref);f.sample().fileIds.reverse();expect(()=>f.dispatch(ref)).toThrow(/资料已变化/);f.back(out.dispatchId,out.movementIds[0],.5);expect(f.sample().available).toBe(1.25);
});
it('cannot attribute an earlier physical dispatch to a factory task that did not exist on that date',()=>{
 const f=developmentReferenceFixture(),ref=f.link().referenceId,before=structuredClone(f.state);expect(()=>f.dispatch(ref,{sentAt:'2026-11-17'})).toThrow(/工厂任务建立日/);expect(f.state).toEqual(before);
});
