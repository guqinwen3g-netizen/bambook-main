import {describe,expect,it} from 'vitest';
import {applyMistCommand,createMistState,type DevelopmentValues,type MistCommand,type MistContext} from './mistWorkspace';
import {emptyFabricRequirements} from './mistDevelopmentDomain';
import {devStagePlanError,devStagePendingHandovers} from './mistDevelopmentStages';
import {developmentNoticeContent} from './mistDevelopmentNotice';

/** A fabric development where the weaving mill makes greige and the dyeing mill returns the finished sample. */
function fixture(){
 let n=0;const ctx:MistContext={id:()=>`ds-${++n}`,now:'2026-10-13T14:00:00Z',actorName:'面料业务',actorId:'sales'};let state=createMistState(ctx,'empty');
 state.customers.push({id:'c',name:'Harbour',code:'C',country:'GB',city:'',industry:'',owner:'',grade:'',currency:'USD',terms:'',incoterm:'',categories:'',creditLimit:0,since:''});
 for(const [id,name,type] of [['weaver','吴江织造','织造'],['dyer','盛泽染整','染整'],['mill','博远面料','面料贸易']])state.market.suppliers.push({id,code:id,name,type,capabilities:type,status:'active',country:'中国',address:'',capacity:0,capacityUnit:'米',leadDays:0,blockReason:'',contacts:[],fileIds:[],note:'',createdAt:ctx.now,updatedAt:ctx.now});
 state.settings.companyProfile={legalName:'雾织国际贸易（上海）有限公司'} as any;
 const values:DevelopmentValues={domain:'fabric',name:'SS27 棉弹斜纹拉毛',customer:'c',style:'',season:'SS27',category:'梭织',kind:'new',fabric:'',color:'燕麦',target:'',sizeBase:'',goal:'拉毛手感',factories:[],due:'2026-11-01',collaborators:[],sampleQuantity:3,sampleForm:'米样',sampleUnit:'米',fabricRequirements:emptyFabricRequirements(),stages:[{factoryId:'weaver',process:'织造'},{factoryId:'dyer',process:'染整'}]};
 const run=(command:MistCommand)=>{const r=applyMistCommand(state,command,ctx);state=r.state;return r.result;};
 const submit=(v:DevelopmentValues=values)=>run({type:'development.submit',payload:{values:v,fileIds:[]}});
 const handover=(devId:string,versionId:string,stageIndex=0)=>run({type:'development.stage.handover',payload:{devId,versionId,stageIndex,quantity:3.5,unit:'米',date:'2026-10-13',note:'吴江织造坯样 3.5 米寄盛泽，快递 SF1013'}});
 const recordSample=(devId:string,versionId:string)=>run({type:'development.recordSample',payload:{devId,versionId,sample:'S-1',quantity:3,form:'米样',unit:'米',location:'样品柜',color:'燕麦',returnedAt:ctx.now}});
 return{ctx,values,run,submit,handover,recordSample,get state(){return state;}};
}

describe('staged fabric development chain',()=>{
 it('creates one version for the chain, owned by the last mill, instead of one candidate per factory',()=>{
  const f=fixture(),r=f.submit();
  const versions=f.state.versions.filter(v=>v.devId===r.devId);
  expect(versions).toHaveLength(1);
  expect(versions[0]).toMatchObject({factoryId:'dyer',factory:'盛泽染整',label:'R1-A-1',stages:[{factoryId:'weaver',process:'织造',factory:'吴江织造'},{factoryId:'dyer',process:'染整',factory:'盛泽染整'}]});
  expect(f.state.devs[0].values.factories).toEqual(['weaver','dyer']);
  expect(f.state.rounds![0].stages).toEqual([{factoryId:'weaver',process:'织造'},{factoryId:'dyer',process:'染整'}]);
  expect(f.state.devs[0].state).toBe('前道打样中');
 });
 it('keeps parallel comparison unchanged when no chain is given',()=>{
  const f=fixture(),{stages:_s,...plain}=f.values;f.submit({...plain,factories:['weaver','mill']});
  expect(f.state.versions.map(v=>v.factory)).toEqual(['吴江织造','博远面料']);
  expect(f.state.versions.every(v=>!v.stages)).toBe(true);
 });
 it('requires the upstream handover before the last mill returns a sample',()=>{
  const f=fixture(),r=f.submit();
  expect(()=>f.recordSample(r.devId!,r.versionId!)).toThrow('请先登记前道交接：吴江织造 → 盛泽染整');
  f.handover(r.devId!,r.versionId!);
  expect(devStagePendingHandovers(f.state.versions[0])).toEqual([]);
  expect(f.state.devs[0].state).toBe('待工厂试样');
  f.recordSample(r.devId!,r.versionId!);
  expect(f.state.versions[0].returnedAt).toBeTruthy();
  expect(()=>f.handover(r.devId!,r.versionId!)).toThrow();
 });
 it('rejects a second handover for the same stage, a last-stage handover and a future date',()=>{
  const f=fixture(),r=f.submit();
  expect(()=>f.handover(r.devId!,r.versionId!,1)).toThrow('前道工序');
  expect(()=>f.run({type:'development.stage.handover',payload:{devId:r.devId!,versionId:r.versionId!,stageIndex:0,quantity:1,unit:'米',date:'2026-10-20',note:'x'}})).toThrow('未来');
  f.handover(r.devId!,r.versionId!);
  expect(()=>f.handover(r.devId!,r.versionId!)).toThrow('已登记');
 });
 it('compares the handover date with the Beijing business day, not the UTC date',()=>{
  const f=fixture(),r=f.submit();
  const late:MistContext={...f.ctx,now:'2026-10-13T17:30:00Z'};
  const next=applyMistCommand(f.state,{type:'development.stage.handover',payload:{devId:r.devId!,versionId:r.versionId!,stageIndex:0,quantity:3,unit:'米',date:'2026-10-14',note:'北京时间次日凌晨登记'}},late);
  expect(next.state.versions[0].stageHandovers?.[0].date).toBe('2026-10-14');
 });
 it('validates the chain shape',()=>{
  expect(devStagePlanError([{factoryId:'a',process:'织造'}])).toContain('两道');
  expect(devStagePlanError([{factoryId:'a',process:'织造'},{factoryId:'a',process:'染整'}])).toContain('只能出现一次');
  expect(devStagePlanError([{factoryId:'a',process:'染整'},{factoryId:'b',process:'织造'}])).toContain('不能是织造');
  expect(devStagePlanError([{factoryId:'a',process:'织造'},{factoryId:'b',process:'缝制'}])).toContain('工序类型');
  const f=fixture(),before=JSON.stringify(f.state);
  expect(()=>f.submit({...f.values,stages:[{factoryId:'weaver',process:'织造'}]})).toThrow('两道');
  expect(()=>f.submit({...f.values,domain:'garment',style:'X',fabric:'Y',sizeBase:'M',sampleForm:undefined,sampleUnit:undefined,sampleQuantity:1})).toThrow('只有面料开发');
  expect(JSON.stringify(f.state)).toBe(before);
 });
 it('keeps an unfinished chain in a draft and requires it complete on submission',()=>{
  const f=fixture(),d=f.run({type:'development.saveDraft',payload:{values:{...f.values,stages:[{factoryId:'weaver',process:'织造'},{factoryId:'',process:'染整'}]},fileIds:[]}});
  expect(f.state.drafts[0].values.stages).toHaveLength(2);
  expect(()=>f.run({type:'development.submit',payload:{draftId:d.id,values:f.state.drafts[0].values,fileIds:[]}})).toThrow('选择工厂');
 });
 it('carries the same chain into a revision and a new staged round',()=>{
  const f=fixture(),r=f.submit();f.handover(r.devId!,r.versionId!);f.recordSample(r.devId!,r.versionId!);
  const next=f.run({type:'development.revise',payload:{devId:r.devId!,versionId:r.versionId!,note:'拉毛加重一档'}});
  const revised=f.state.versions.find(v=>v.id===next.versionId)!;
  expect(revised).toMatchObject({factoryId:'dyer',label:'R2-A-2',stages:[{factoryId:'weaver'},{factoryId:'dyer'}]});
  expect(revised.stageHandovers).toBeUndefined();
  expect(()=>f.run({type:'development.round.create',payload:{devId:r.devId!,factories:['weaver','mill'],stages:[{factoryId:'weaver',process:'织造'},{factoryId:'dyer',process:'染整'}],requirements:'换厂',targetDate:'2026-11-01'}})).toThrow('工序链一致');
 });
 it('names the whole chain on the dyeing mill notice',()=>{
  const f=fixture(),r=f.submit(),dev=f.state.devs[0],version=f.state.versions.find(v=>v.id===r.versionId)!;
  expect(developmentNoticeContent(f.state,dev,version)).toMatchObject({factory:'盛泽染整',stageChain:'吴江织造（织造） → 盛泽染整（染整 · 出样）'});
 });
 it('follows a supplier rename in the stored chain',()=>{
  const f=fixture(),r=f.submit();
  f.run({type:'market.supplier.save',payload:{id:'weaver',input:{name:'吴江恒丰织造',type:'织造'}}});
  expect(f.state.versions.find(v=>v.id===r.versionId)!.stages![0].factory).toBe('吴江恒丰织造');
 });
});
