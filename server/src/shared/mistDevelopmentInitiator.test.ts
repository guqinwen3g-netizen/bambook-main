import {describe,it,expect} from 'vitest';
import { withTestFactories } from './__tests__/utils/devFactories';
import {applyMistCommand,createMistState,type DevelopmentValues,type MistContext,type MistCommand} from './mistWorkspace';
import {developmentCharged,developmentInitiatorLabel} from './mistDevelopmentDomain';

function fixture(){
  let n=0;const ctx:MistContext={id:()=>`in-${++n}`,now:'2026-10-16T09:00:00Z',actorName:'测试业务员',actorId:'test-sales'};let state=withTestFactories(createMistState(ctx,'empty'));
  state.customers.push({id:'c',name:'测试客户',code:'C',country:'',city:'',industry:'',owner:'',grade:'',currency:'EUR',terms:'',incoterm:'',categories:'',creditLimit:0,since:''});
  state.market.suppliers.push({id:'f',code:'F',name:'实际测试面料厂',type:'面料工厂',capabilities:'织造染整',status:'active',country:'',address:'',capacity:0,capacityUnit:'米',leadDays:0,blockReason:'',contacts:[],fileIds:[],note:'',createdAt:ctx.now,updatedAt:ctx.now});
  state.platform.employees.push({id:'emp-1',name:'林面料',department:'面料部',position:'面料开发',contact:'',startDate:'2026-01-01',note:'',active:true,history:[]});
  const fabric:DevelopmentValues={domain:'fabric',initiator:'internal',requester:'林面料',requesterId:'emp-1',name:'内部斜纹开发',customer:'',style:'',season:'AW',category:'斜纹',kind:'new',fabric:'',color:'蓝灰',target:'',sizeBase:'',goal:'储备面料',factories:['实际测试面料厂'],due:'2026-10-30',collaborators:[],sampleQuantity:2,sampleForm:'米样',sampleUnit:'米'};
  const garment:DevelopmentValues={initiator:'customer',requestType:'replicate',name:'客户来样复刻',customer:'c',style:'ST-1',season:'AW',category:'大衣',kind:'new',fabric:'羊毛',color:'灰',target:'',sizeBase:'M',goal:'按来样复刻',factories:['A厂'],due:'2026-10-30',collaborators:[],sampleQuantity:1};
  const run=(command:MistCommand)=>{const r=applyMistCommand(state,command,ctx);state=r.state;return r.result;};
  return{ctx,fabric,garment,run,get state(){return state;}};
}

describe('BB-DEV-1 development initiator, request type and charging',()=>{
  it('internal fabric case without a customer goes through sample, QC and requester confirmation',()=>{
    const f=fixture(),ids=f.run({type:'development.submit',payload:{values:f.fabric,fileIds:[]}});
    const dev=f.state.devs.find(d=>d.id===ids.devId)!;
    expect(dev).toMatchObject({customer:'',customerId:''});
    expect(dev.values).toMatchObject({initiator:'internal',requester:'林面料',requesterId:'emp-1',charged:false,customer:''});
    f.run({type:'development.recordSample',payload:{devId:dev.id,versionId:ids.versionId!,sample:'IN-1',quantity:2,form:'米样',unit:'米',location:'A架',color:'蓝灰',returnedAt:f.ctx.now}});
    f.run({type:'development.recordQc',payload:{devId:dev.id,versionId:ids.versionId!,domain:'fabric',qc:{result:'pass',reviewer:'面料QC',reviewedAt:f.ctx.now,report:'QC-1',opinion:'通过',fabricMeasurements:[]}}});
    f.run({type:'development.confirm',payload:{devId:dev.id,versionId:ids.versionId!,result:'approved',confirmer:'林面料',organization:'面料部',confirmedAt:f.ctx.now,basis:'内部评审会',originalText:'认可'}});
    expect(f.state.versions.find(v=>v.id===ids.versionId)!.confirmations.at(-1)).toMatchObject({result:'approved',confirmer:'林面料'});
  });
  it('customer case requires an existing customer and a request type; other requires an explanation',()=>{
    const f=fixture();
    expect(()=>f.run({type:'development.submit',payload:{values:{...f.garment,customer:''},fileIds:[]}})).toThrow(/customer|客户/);
    expect(()=>f.run({type:'development.submit',payload:{values:{...f.garment,customer:'不存在'},fileIds:[]}})).toThrow(/已有客户/);
    expect(()=>f.run({type:'development.submit',payload:{values:{...f.garment,requestType:undefined},fileIds:[]}})).toThrow(/要求类型/);
    expect(()=>f.run({type:'development.submit',payload:{values:{...f.garment,requestType:'other'},fileIds:[]}})).toThrow(/要求说明/);
    const ids=f.run({type:'development.submit',payload:{values:{...f.garment,requestType:'other',requestNote:'客户只给了参考照片'},fileIds:[]}});
    expect(f.state.devs.find(d=>d.id===ids.devId)!.values).toMatchObject({initiator:'customer',requestType:'other',requestNote:'客户只给了参考照片',charged:true,customer:'测试客户'});
  });
  it('internal case requires a requester and validates a chosen employee',()=>{
    const f=fixture();
    expect(()=>f.run({type:'development.submit',payload:{values:{...f.fabric,requester:'',requesterId:undefined},fileIds:[]}})).toThrow(/内部需求方/);
    expect(()=>f.run({type:'development.submit',payload:{values:{...f.fabric,requesterId:'emp-x'},fileIds:[]}})).toThrow(/员工档案/);
    const ids=f.run({type:'development.submit',payload:{values:{...f.fabric,customer:'c',requesterId:undefined,requester:'设计部 周'},fileIds:[]}});
    expect(f.state.devs.find(d=>d.id===ids.devId)).toMatchObject({customer:'',customerId:''});
  });
  it('charging defaults by initiator, stays editable, and initiator cannot change after submission',()=>{
    const f=fixture();
    const internal=f.run({type:'development.submit',payload:{values:{...f.fabric,charged:true},fileIds:[]}});
    expect(f.state.devs.find(d=>d.id===internal.devId)!.values.charged).toBe(true);
    const customer=f.run({type:'development.submit',payload:{values:{...f.garment,charged:false},fileIds:[]}});
    expect(f.state.devs.find(d=>d.id===customer.devId)!.values.charged).toBe(false);
    f.run({type:'development.update',payload:{devId:customer.devId!,patch:{charged:true}}});
    expect(f.state.devs.find(d=>d.id===customer.devId)!.values.charged).toBe(true);
    expect(()=>f.run({type:'development.update',payload:{devId:customer.devId!,patch:{initiator:'internal',requester:'某人'}}})).toThrow(/发起方/);
    expect(developmentCharged({})).toBe(true);expect(developmentCharged({initiator:'internal'})).toBe(false);
    expect(developmentInitiatorLabel({initiator:'customer',requestType:'design'})).toBe('客户要求 · 我方设计');
    expect(developmentInitiatorLabel({initiator:'internal',requester:'林面料'})).toBe('内部需求 · 林面料');
  });
  it('legacy values without initiator stay customer cases and remain submittable',()=>{
    const f=fixture(),{initiator,requestType,...legacy}=f.garment;
    const ids=f.run({type:'development.submit',payload:{values:legacy as DevelopmentValues,fileIds:[]}});
    const values=f.state.devs.find(d=>d.id===ids.devId)!.values;expect(values.initiator).toBeUndefined();expect(developmentCharged(values)).toBe(true);expect(developmentInitiatorLabel(values)).toBe('客户要求');
  });
});

describe('redevelopment from an exact catalog product',()=>{
  function productFixture(){
    const f=fixture();
    const p=f.run({type:'market.product.save',payload:{input:{
      sku:'JK-19',name:'短夹克',category:'garment',season:'AW27',supplierId:'',supplierCode:'',
      composition:'棉',specification:'五扣',color:'军绿',unit:'件',cost:'72.50',currency:'CNY',sourceDevId:'',sourceVersionId:'',
    }}});
    const state=f.state;
    const ctx:MistContext={actorId:'test-sales',actorName:'测试业务员',now:'2026-10-16T10:00:00Z',id:(()=>{let n=0;return ()=>'source-'+ ++n;})(),can:scope=>scope==='products:read'};
    return {state,ctx,productId:String(p.id),garment:f.garment,fabric:f.fabric};
  }
  it('preserves the original product through a draft submitted by a client that omitted the optional field',()=>{
    const {state,ctx,productId,garment}=productFixture();
    const draft=applyMistCommand(state,{type:'development.saveDraft',payload:{values:{...garment,sourceProductId:productId},fileIds:[]}},ctx);
    const started=applyMistCommand(draft.state,{type:'development.submit',payload:{draftId:String(draft.result.draftId),values:garment,fileIds:[]}},ctx);
    expect(started.state.devs.find(d=>d.id===started.result.devId)?.values.sourceProductId).toBe(productId);
    expect(started.state.market.products).toEqual(state.market.products);
    expect(started.state.fulfillment.stocks).toEqual(state.fulfillment.stocks);
  });
  it('refuses to substitute a different catalog source or start from an archived, missing, unreadable or wrong-domain product',()=>{
    const {state,ctx,productId,garment,fabric}=productFixture();
    const input={type:'development.saveDraft',payload:{values:{...garment,sourceProductId:productId},fileIds:[]}} as const;
    const save=(values:DevelopmentValues,context=ctx,draftId?:string)=>applyMistCommand(state,{type:'development.saveDraft',payload:{values,fileIds:[],draftId}},context);
    expect(()=>save({...fabric,sourceProductId:productId})).toThrow('来源产品与开发类别不符');
    expect(()=>save({...garment,sourceProductId:'missing'})).toThrow('来源产品档案不可用');
    expect(()=>save({...garment,sourceProductId:productId},{...ctx,can:()=>false})).toThrow('没有查看来源产品档案的权限');
    const frozen=save(input.payload.values),draftId=String(frozen.result.draftId);
    expect(()=>applyMistCommand(frozen.state,{type:'development.saveDraft',payload:{draftId,values:{...garment,sourceProductId:'other'},fileIds:[]}},ctx)).toThrow('草稿的来源产品档案不可替换');
    state.market.products.find(p=>p.id===productId)!.status='archived';
    expect(()=>save(input.payload.values)).toThrow('来源产品已归档');
    expect(()=>applyMistCommand(state,{type:'development.submit',payload:{values:input.payload.values,fileIds:[]}},ctx)).toThrow('来源产品已归档');
  });
});
