import {describe,expect,it} from 'vitest';
import {applyMistCommand,createMistState,type MistContext,type MistCommand} from './mistWorkspace';

function fixture(){
  let seq=0;const ctx:MistContext={id:()=>`s-${++seq}`,now:'2026-11-18T04:00:00Z',actorId:'registrar',actorName:'业务员',can:()=>true};
  let state=createMistState(ctx,'empty');
  const run=(command:MistCommand,actor=ctx)=>{const r=applyMistCommand(state,command,actor);state=r.state;return String(r.result.id)};
  const product=run({type:'market.product.save',payload:{input:{sku:'F-T',name:'缎纹',category:'fabric',supplierId:'',supplierCode:'',season:'',color:'白',specification:'',composition:'',unit:'米',cost:'0',currency:'CNY',sourceDevId:'',sourceVersionId:''}}});
  state.customers.push({id:'customer',name:'已有客户',code:'C1',country:'',city:'',industry:'',owner:'',ownerId:'registrar',grade:'',currency:'CNY',terms:'',incoterm:'',categories:'',creditLimit:0,since:''});
  const sample={source:{kind:'manual',description:'来样'},name:'棉布',category:'面料',form:'米样',quantity:1.25,unit:'米',location:'B2',size:'',color:'',note:'',fileIds:[]} as const;
  return {ctx,product,run,get state(){return state;},add:(links:Record<string,string>={},actor=ctx)=>run({type:'fulfillment.samples.create',payload:{...sample,fileIds:[],manualLinks:links}},actor)};
}
describe('explicit manual sample identity',()=>{
  it('retains links by identifier and reuses only the chosen archive without changing either physical record',()=>{
    const f=fixture(),first=f.add({productId:f.product,customerId:'customer'}),other=f.add(),child=f.add({archiveId:first});
    const samples=f.state.fulfillment.samples;
    expect(samples.find(s=>s.id===first)?.manualLinks).toEqual({productId:f.product,customerId:'customer'});
    expect(samples.find(s=>s.id===other)?.manualLinks).toBeUndefined();
    expect(samples.find(s=>s.id===child)?.manualLinks).toMatchObject({archiveId:first});
    expect(samples.map(s=>s.available)).toEqual([1.25,1.25,1.25]);
    const edit=(id:string,manualLinks:Record<string,string|null>)=>f.run({type:'fulfillment.samples.edit',payload:{id,note:'',location:'B2',fileIds:[],manualLinks}});
    edit(first,{customerId:null});expect(f.state.fulfillment.samples[0].manualLinks).toEqual({productId:f.product});
    expect(f.state.fulfillment.sampleMovements).toHaveLength(3);expect(f.state.fulfillment.stock).toEqual([]);
    expect(()=>edit(child,{productId:f.product})).toThrow();
  });
  it('validates the category, permission, visible reference type and exact archive target',()=>{
    const f=fixture();
    expect(()=>f.add({productId:'unknown'})).toThrow();expect(()=>f.add({customerId:'foreign'})).toThrow();
    expect(()=>f.add({customerId:'customer'},{...f.ctx,can:p=>p!=='relations:read'})).toThrow();
    expect(()=>f.add({archiveId:'missing'})).toThrow();expect(()=>f.add({supplierId:'missing'})).toThrow();
    f.state.market.products[0].category='garment';expect(()=>f.add({productId:f.product})).toThrow();
    f.state.market.products[0].category='fabric';f.state.market.products[0].status='archived';expect(()=>f.add({productId:f.product})).toThrow();
    expect(f.state.fulfillment.samples).toEqual([]);
  });
});
