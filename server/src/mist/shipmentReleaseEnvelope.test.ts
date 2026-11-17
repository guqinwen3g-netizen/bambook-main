import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createMistState} from '../shared/mistWorkspace';
import {MistPrivateFiles} from './files';
import {MistRepository} from './repository';
import {MemoryMistDatabase,testActor,testAuthority,testContract} from './__tests__/support';
let directory:string|undefined;afterEach(async()=>{if(directory)await rm(directory,{recursive:true,force:true})});
it('returns operational booleans through the normal company envelope without persisting or unmasking risks',async()=>{
 directory=await mkdtemp(path.join(tmpdir(),'shipment-gate-'));const db=new MemoryMistDatabase(),auth=testAuthority(),company='11111111-1111-4111-8111-111111111111';auth.users.set('owner',{active:true,permissions:['*']});auth.users.set('warehouse',{active:true,permissions:['shipments:read','orders:read','relations:read']});auth.users.set('foreign',{active:true,permissions:['shipments:read','orders:read','relations:read']});for(const userId of ['owner','warehouse'])db.companyMembers.push({companyId:company,userId,status:'active'});
 const actor=(id:string,companyId=company)=>({...testActor(id),roles:[],companyId,globalBusinessScope:id==='warehouse'});const create=()=>{const s=createMistState({id:()=>'',now:'2026-11-19T14:00:00Z',actorName:'测试'},'empty');s.orders=[{id:'o',customerId:'c',owner:'owner',ownerId:'owner',type:'garment'}]as any;s.orderLines=[{id:'l',orderId:'o',qty:8,unit:'件'}]as any;s.fulfillment.shipments=[{id:'shipment',customerId:'c',state:'ready',lines:[{orderId:'o',lineId:'l',quantity:8}]}]as any;s.market.relations=[{id:'relation',customerId:'c',supplierId:'',name:'客户',hold:{at:'2026-11-19T08:00:00Z',actor:'财务',reason:'PRIVATE_REASON'}}]as any;s.platform.risks=[{id:'risk',state:'InProgress',signalKey:'relation-hold:relation',release:{at:'2026-11-19T09:00:00Z',approvedBy:'PRIVATE_MANAGER'}}]as any;return s};
 const repo=new MistRepository(db,{...testContract,createMistState:context=>createMistState(context,'empty')},new MistPrivateFiles(directory),auth.authorize);const own=await repo.create(actor('owner'),{name:'公司'},true);const stored=db.workspaces.get(own.id)!,fixture=create();stored.state.orders=fixture.orders;stored.state.orderLines=fixture.orderLines;stored.state.fulfillment.shipments=fixture.fulfillment.shipments;stored.state.market.relations=fixture.market.relations;stored.state.platform.risks=fixture.platform.risks;const before=structuredClone(stored.state);
 const read=await repo.get(actor('warehouse'),own.id);expect(read.shipmentReleaseGates).toEqual({shipment:{held:true,unusedAuthorized:true}});expect(read.state.platform.risks).toEqual([]);expect((read.state as any).shipmentReleaseGates).toBeUndefined();expect(JSON.stringify(read.shipmentReleaseGates)).not.toContain('PRIVATE');expect(db.workspaces.get(own.id)!.state).toEqual(before);
 const listed=(await repo.list(actor('warehouse'))).find(x=>x.id===own.id)!;expect(listed.shipmentReleaseGates).toEqual(read.shipmentReleaseGates);await expect(repo.get(actor('foreign','22222222-2222-4222-8222-222222222222'),own.id)).rejects.toBeTruthy();
});
