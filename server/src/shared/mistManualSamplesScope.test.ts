import { describe, expect, it } from 'vitest';
import { applyMistCommand, createMistState, type MistCommand, type MistContext } from './mistWorkspace';
import { applyDataScope, scopedVisibility, scopedWriteViolation } from './mistDataScope';
import { projectState } from '../mist/access';

const NOW='2026-11-18T04:00:00.000Z';
const scope=(...userIds:string[])=>({userIds,teamIds:[]});
function fixture(){
 let serial=0;const names:Record<string,string>={registrar:'林同',borrower:'借用员','same-name':'林同',stranger:'其他经办'};
 const context=(actorId:string):MistContext=>({id:()=>`manual-${++serial}`,now:NOW,actorId,actorName:names[actorId]||actorId,members:Object.entries(names).map(([id,name])=>({id,name,active:true})),can:()=>true});
 let state=createMistState(context('registrar'),'empty');
 const run=(actorId:string,command:MistCommand)=>{const result=applyMistCommand(state,command,context(actorId));state=result.state;return result.result;};
 const input=(name='棉斜纹米样')=>({name,category:'面料',form:'米样',unit:'米',quantity:3,location:'A01',size:'150cm',color:'军绿',source:{kind:'manual' as const,description:'供应商目录留样，不关联商业订单'},fileIds:[],note:''});
 const create=(actorId='registrar',name?:string)=>run(actorId,{type:'fulfillment.samples.create',payload:input(name)}).id!;
 return{get state(){return state},context,run,input,create};
}
const visible=(f:ReturnType<typeof fixture>,...users:string[])=>applyDataScope(f.state,scope(...users),users[0]);

describe('manual samples use trusted handling IDs without promoting their business sources',()=>{
 it('records the authenticated registrar and allows that scoped creator to create, read and move the independent sample',()=>{
  const f=fixture(),before=structuredClone(f.state),id=f.create();
  expect(f.state.fulfillment.samples.find(s=>s.id===id)).toMatchObject({registeredById:'registrar',source:{kind:'manual'}});
  expect(scopedWriteViolation(before,f.state,scope('registrar'))).toBeNull();
  expect(visible(f,'registrar').fulfillment.samples.map(s=>s.id)).toEqual([id]);
  const first=structuredClone(f.state);f.run('registrar',{type:'fulfillment.samples.move',payload:{id,kind:'move',quantity:0,person:'',location:'B02',note:'内部调位'}});
  expect(scopedWriteViolation(first,f.state,scope('registrar'))).toBeNull();
  expect(f.state.fulfillment.samples.find(s=>s.id===id)).toMatchObject({registeredById:'registrar',quantity:3,available:3,location:'B02'});
  expect(first.fulfillment.stock).toEqual(f.state.fulfillment.stock);
 });
 it('keeps the exact explicitly lent sample visible through both partial returns and after full return',()=>{
  const f=fixture(),id=f.create(),sibling=f.create('registrar','另一份留样');
  expect(visible(f,'borrower').fulfillment.samples).toEqual([]);
  const loan=f.run('registrar',{type:'fulfillment.samples.move',payload:{id,kind:'lend',quantity:2,borrowerId:'borrower',person:'',location:'',note:'核对组织'}}).id!;
  expect(visible(f,'borrower').fulfillment.samples.map(s=>s.id)).toEqual([id]);expect(visible(f,'borrower').fulfillment.samples.map(s=>s.id)).not.toContain(sibling);
  for(let i=0;i<2;i++){const before=structuredClone(f.state);f.run('borrower',{type:'fulfillment.samples.move',payload:{id,kind:'return',loanId:loan,quantity:1,person:'借用员',location:'B02',note:'分次归还'}});expect(scopedWriteViolation(before,f.state,scope('borrower'))).toBeNull();}
  const view=visible(f,'borrower');expect(view.fulfillment.samples.map(s=>s.id)).toEqual([id]);expect(view.fulfillment.sampleMovements.filter(m=>m.sampleId===id&&m.kind==='return')).toHaveLength(2);
  expect(f.state.fulfillment.samples.find(s=>s.id===id)).toMatchObject({quantity:3,available:3,registeredById:'registrar'});
 });
 it('honours supervisor user-ID scopes without promoting unrelated or same-name colleagues',()=>{
  const f=fixture(),id=f.create();expect(visible(f,'supervisor','registrar').fulfillment.samples.map(s=>s.id)).toEqual([id]);
  expect(visible(f,'stranger').fulfillment.samples).toEqual([]);expect(visible(f,'same-name').fulfillment.samples).toEqual([]);
 });
 it.each(['person-only','actor-only','return-only']as const)('does not infer handling from a %s record',mode=>{
  const f=fixture(),id=f.create('stranger');
  f.state.fulfillment.sampleMovements.push({id:'untrusted-name-record',sampleId:id,kind:mode==='return-only'?'return':'lend',quantity:1,person:mode==='actor-only'?'其他':'借用员',actor:'借用员',location:'',note:'旧记录',at:NOW,...(mode==='return-only'?{borrowerId:'borrower'}:{})}as any);
  expect(visible(f,'borrower').fulfillment.samples).toEqual([]);
 });
 it('does not backfill an old missing registrar from display names',()=>{
  const f=fixture(),id=f.create();delete(f.state.fulfillment.samples.find(s=>s.id===id)as any).registeredById;
  const before=structuredClone(f.state);expect(visible(f,'registrar').fulfillment.samples).toEqual([]);expect(f.state).toEqual(before);
  f.state.fulfillment.sampleMovements.push({id:'identified-legacy-loan',sampleId:id,kind:'lend',quantity:1,borrowerId:'borrower',person:'借用员',actor:'林同',location:'',note:'已明确账号的旧借出',at:NOW});
  expect(visible(f,'borrower').fulfillment.samples.map(s=>s.id)).toEqual([id]);expect(visible(f,'registrar').fulfillment.samples).toEqual([]);
 });
 it('rejects client attempts to nominate or replace the server-owned registrar',()=>{
  const f=fixture(),before=structuredClone(f.state);
  expect(()=>f.run('registrar',{type:'fulfillment.samples.create',payload:{...f.input(),registeredById:'borrower'}}as any)).toThrow('登记人');expect(f.state).toEqual(before);
  const id=f.create(),saved=structuredClone(f.state);
  expect(()=>f.run('registrar',{type:'fulfillment.samples.edit',payload:{id,location:'A01',fileIds:[],note:'',registeredById:'borrower'}}as any)).toThrow('登记人');expect(f.state).toEqual(saved);
 });
 it('does not turn a handling identity into products read permission',()=>{
  const f=fixture(),id=f.create();f.state.files.push({id:'own-manual-file',name:'own.txt',mimeType:'text/plain',size:1,storageKey:'own',createdAt:NOW});f.state.fulfillment.samples.find(s=>s.id===id)!.fileIds=['own-manual-file'];
  const view=projectState(f.state,{userId:'registrar',roles:[],departmentIds:[],permissions:['orders:read']},()=>createMistState(f.context('registrar'),'empty'),'other-owner',scope('registrar')).state;
  expect(view.fulfillment.samples).toEqual([]);expect(view.fulfillment.sampleMovements).toEqual([]);expect(view.files).toEqual([]);
 });
 it('does not promote version/order samples or their private source files through manual identity hints',()=>{
  const f=fixture(),id=f.create('stranger'),sibling=f.create('stranger','同来源兄弟样');
  f.state.files.push(...['manual-file','sibling-file','version-file','order-file'].map(id=>({id,name:id+'.txt',mimeType:'text/plain',size:1,storageKey:id,createdAt:NOW})));
  f.state.fulfillment.samples.find(s=>s.id===id)!.fileIds=['manual-file'];f.state.fulfillment.samples.find(s=>s.id===sibling)!.fileIds=['sibling-file'];
  f.state.devs.push({id:'private-dev',ownerId:'stranger',customerId:'private-customer',name:'私有开发',values:{},fileIds:['version-file']}as any);
  f.state.versions.push({id:'private-version',devId:'private-dev',fileIds:['version-file']}as any);
  f.state.orders.push({id:'private-order',ownerId:'stranger',customerId:'private-customer',type:'garment',fileIds:['order-file']}as any);
  f.state.orderLines.push({id:'private-line',orderId:'private-order'}as any);
  const base=f.state.fulfillment.samples.find(s=>s.id===id)!;
  f.state.fulfillment.samples.push({...base,id:'version-sample',registeredById:'borrower',source:{kind:'version',devId:'private-dev',versionId:'private-version'},fileIds:['version-file']},{...base,id:'order-sample',registeredById:'borrower',source:{kind:'orderLine',orderId:'private-order',lineId:'private-line'},fileIds:['order-file']});
  const oldView=visible(f,'borrower');
  for(const sampleId of[id,'version-sample','order-sample'])f.state.fulfillment.sampleMovements.push({id:'loan-'+sampleId,sampleId,kind:'lend',quantity:1,borrowerId:'borrower',person:'借用员',actor:'其他经办',location:'',note:'实物交接',at:NOW});
  const view=visible(f,'borrower'),api=projectState(f.state,{userId:'borrower',roles:[],departmentIds:[],permissions:['products:read','orders:read']},()=>createMistState(f.context('borrower'),'empty'),'other-owner',scope('borrower')).state;expect(view.fulfillment.samples.map(s=>s.id)).toEqual([id]);expect(api.files.map(f=>f.id)).toEqual(['manual-file']);expect(view.devs).toEqual(oldView.devs);expect(view.orders).toEqual(oldView.orders);expect(view.customers).toEqual(oldView.customers);
  expect(scopedVisibility(f.state,scope('borrower'),false).get('fulfillment.samples')?.has('version-sample')).toBe(false);
  expect(scopedVisibility(f.state,scope('borrower'),false).get('fulfillment.samples')?.has('order-sample')).toBe(false);
 });
});
