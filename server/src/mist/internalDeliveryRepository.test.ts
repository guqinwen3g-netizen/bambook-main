import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import * as contract from '../shared/mistWorkspace';
import {internalDeliveryFixture} from './__tests__/internalDelivery';
import {MemoryMistDatabase,testActor,testAuthority} from './__tests__/support';
import {MistPrivateFiles} from './files';
import {MistRepository} from './repository';
import {scopedWriteViolation} from '../shared/mistDataScope';
vi.mock('./context',()=>({mistApprovalAuthority:async()=>({supplier:{}})}));
let dir:string;beforeEach(async()=>{dir=await mkdtemp(path.join(tmpdir(),'internal-delivery-'));});afterEach(async()=>{await rm(dir,{recursive:true,force:true});});

it('allows the exact recipient to count a minimal handover without gaining source order or financial access',async()=>{
 const company='11111111-1111-4111-8111-111111111111',wid=randomUUID(),db=new MemoryMistDatabase(),auth=testAuthority(),f=internalDeliveryFixture();
 auth.users.set('garment',{active:true,permissions:['orders:read','orders:write','production:read','procurement:read']});
 auth.users.set('warehouse',{active:true,permissions:['orders:read']});auth.users.set('reviewer',{active:true,permissions:['orders:read','orders:write']});
 for(const id of ['garment','warehouse','reviewer']){db.companyMembers.push({companyId:company,userId:id,status:'active'});db.accounts.set(id,{status:'active',displayName:id});}
 db.workspaces.set(wid,{id:wid,ownerId:'boss',companyId:company,slug:`company@${company}`,name:'公司',revision:0,state:structuredClone(f.state),createdAt:new Date(),updatedAt:new Date()});
 const repo=new MistRepository(db,contract,new MistPrivateFiles(dir),auth.authorize,()=>new Date(f.context.now));
 const actor=(id:string)=>({...testActor(id),companyId:company,roles:[]});
 const send={requestId:'handover',expectedRevision:0,command:{type:'order.internal.send' as const,payload:{orderId:f.target.orderId,productionId:f.productionId,source:{kind:'receipt' as const,id:'finished-receipt'},quantity:10,receiverId:'warehouse',location:'Sample room',date:'2026-10-30',evidence:'Internal handover',expectedRevision:0}}};
 const saved=await repo.execute(actor('garment'),wid,send),id=saved.receipt.result.id;
 expect((await repo.execute(actor('garment'),wid,send)).receipt.result.id).toBe(id);
 const view=await repo.get(actor('warehouse'),wid);
 expect(view.state.orders).toEqual([]);expect(view.state.fulfillment.purchases).toEqual([]);
 expect(view.state.internalDeliveries).toMatchObject([{id,receiverId:'warehouse',quantity:10}]);
 expect(JSON.stringify(view.state.internalDeliveries)).not.toMatch(/price|amount|currency/);
 expect(view.state.tasks.some(t=>t.id==='internal-delivery:'+id)).toBe(true);
 const receive={requestId:'count',expectedRevision:1,command:{type:'order.internal.receive' as const,payload:{id,accepted:10,rejected:0,expectedRevision:0,evidence:'Counted by receiver'}}};
 await expect(repo.execute(actor('reviewer'),wid,receive)).rejects.toMatchObject({status:404});
 await repo.execute(actor('warehouse'),wid,receive);
 expect(db.workspaces.get(wid).state.orders.find((o:any)=>o.id===f.target.orderId).state).toBe('内部交付完成');
 const read=await repo.get(actor('warehouse'),wid);expect(read.state.orders).toEqual([]);expect(read.state.internalDeliveries?.[0].checks[0]).toMatchObject({accepted:10,actorId:'warehouse'});
 auth.users.set('warehouse',{active:true,permissions:['products:read']});expect((await repo.get(actor('warehouse'),wid)).state.internalDeliveries).toEqual([]);
 auth.users.set('garment',{active:true,permissions:['orders:read','orders:write']});
 await expect(repo.execute(actor('garment'),wid,{...send,requestId:'without-source-read',expectedRevision:2})).rejects.toMatchObject({status:403});
});

it('limits the receiving exception to checks on the assigned handover and the exact source status',()=>{
 const f=internalDeliveryFixture(),id=f.send(),before=structuredClone(f.state),after=structuredClone(before);
 const incoming={deliveryId:id,sourceOrderId:f.target.orderId},scope={userIds:['warehouse'],teamIds:[]};
 const row=after.internalDeliveries!.find(d=>d.id===id)!;
 row.checks.push({id:'own-check',accepted:1,rejected:0,at:f.context.now,actorId:'warehouse',actor:'Receiver',evidence:'Counted'});
 after.orders.find(o=>o.id===f.target.orderId)!.state='部分内部交付';
 expect(scopedWriteViolation(before,after,scope,undefined,incoming)).toBeNull();
 const changedQuantity=structuredClone(after);changedQuantity.internalDeliveries![0].quantity=11;
 expect(scopedWriteViolation(before,changedQuantity,scope,undefined,incoming)?.path).toBe('internalDeliveries');
 const changedPrice=structuredClone(after);changedPrice.orderLines.find(l=>l.id===f.target.lineId)!.price=999;
 expect(scopedWriteViolation(before,changedPrice,scope,undefined,incoming)?.path).toBe('orderLines');
 const changedIdentity=structuredClone(after);changedIdentity.orders.find(o=>o.id===f.target.orderId)!.customer='Changed';
 expect(scopedWriteViolation(before,changedIdentity,scope,undefined,incoming)?.path).toBe('orders');
});
