import {expect,it} from 'vitest';
import {developmentReferenceProposalDetails as review} from './developmentReferenceProposalDetails';
import {developmentReferenceFixture} from '../../../../server/src/shared/__tests__/utils/developmentReferences';
import {projectDevelopmentReferenceAccess} from '../../../../server/src/mist/developmentReferenceAccess';
import {projectState} from '../../../../server/src/mist/access';
import {createMistState} from '../../../../server/src/shared/mistWorkspace';
import {retainFixtureFactoryTasks} from '../../../../server/src/shared/__tests__/utils/devClose';
const actor:any={userId:'sales',displayName:'业务员',roles:[],permissions:['products:read','products:write','suppliers:read','relations:read'],departmentIds:[],authorizationLoaded:true},scope={userIds:['sales'],teamIds:[]};
const access=(f:ReturnType<typeof developmentReferenceFixture>)=>projectDevelopmentReferenceAccess(f.state,f.state,actor,scope);
const add=(f:ReturnType<typeof developmentReferenceFixture>)=>({type:'development.reference.add',payload:{devId:f.devId,sampleId:f.sampleId,purpose:'颜色、手感与结构对照',fileIds:['reference-original']}});
const dispatch=(f:ReturnType<typeof developmentReferenceFixture>,ref:string)=>({type:'development.reference.dispatch',payload:{devId:f.devId,taskVersionId:f.taskId,items:[{referenceId:ref,quantity:.25,sourceLocation:'样品架 C03'}],sentAt:'2026-11-18',expectedReturn:'2026-11-22',delivery:{kind:'handover',recipient:'工厂收件人',address:'工厂样品室',carrier:'',trackingNo:'',evidence:'供方自提原参考段'},postage:{amount:0,currency:'CNY',zeroReason:'供方自提，我方不垫付'},note:'完整归还'}});
it('reviews the actual case/sample/specification/current balance and selected original rather than showing technical identity or model notes',()=>{
 const f=developmentReferenceFixture(),r=review(add(f),f.state,access(f),f.ctx.now)!;expect(r.reason).toBe('');const text=JSON.stringify(r.rows);for(const value of['棉斜纹','1.25 米','颜色、手感与结构对照','对照样说明.txt'])expect(text).toContain(value);for(const value of[f.devId,f.sampleId,'sampleId','devId','fileIds'])expect(text).not.toContain(value);expect(review(add(f),f.state,undefined)!.reason).not.toBe('');
});
it('reviews exact active task, physical location/quantity, handoff, mandatory zero-cost basis and keeps changed sources in its fingerprint',()=>{
 const f=developmentReferenceFixture(),ref=f.link().referenceId,c=dispatch(f,ref),r=review(c,f.state,access(f),f.ctx.now)!;expect(r.reason).toBe('');const text=JSON.stringify(r.rows);for(const v of['R1-A-1','0.25 米','样品架 C03','供方自提原参考段','0 CNY','须归还'])expect(text).toContain(v);for(const v of[ref,f.taskId,'referenceId','taskVersionId'])expect(text).not.toContain(v);
 const supplier=f.state.market.suppliers.find(s=>s.id===f.state.versions.find(v=>v.id===f.taskId)!.factoryId)!;supplier.name='更新后的成衣厂';expect(review(c,f.state,access(f),f.ctx.now)!.fingerprint).not.toBe(r.fingerprint);
 for(const bad of [{...c,payload:{...c.payload,postage:{...c.payload.postage,zeroReason:''}}},{...c,payload:{...c.payload,items:[{...c.payload.items[0],quantity:9}]}},{...c,payload:{...c.payload,readKeys:['hidden']}}])expect(review(bad as any,f.state,access(f),f.ctx.now)!.reason).not.toBe('');
});
it('binds an original loan and its old unit after source recheck/closure without reviving the factory task or inventing a new return source',()=>{
 const f=developmentReferenceFixture(),ref=f.link().referenceId,out=f.dispatch(ref);f.sample().unit='码';f.link();f.run({type:'development.close',payload:{devId:f.devId,kind:'archived',reason:'阶段收口',...retainFixtureFactoryTasks(f.state,f.devId)}});
 const c={type:'development.reference.return',payload:{devId:f.devId,dispatchId:out.dispatchId,items:[{loanId:out.movementIds[0],quantity:.25,location:'C03'}],receivedAt:'2026-11-18',delivery:{kind:'handover',recipient:'业务员',address:'公司样品室',carrier:'',trackingNo:'',evidence:'同一参考段交回'},note:''}},r=review(c,f.state,access(f),f.ctx.now)!;expect(r.reason).toBe('');expect(JSON.stringify(r.rows)).toContain('0.25 米');expect(JSON.stringify(r.rows)).not.toContain(out.movementIds[0]);expect(review({...c,payload:{...c.payload,dispatchId:'wrong'}},f.state,access(f),f.ctx.now)!.reason).not.toBe('');
});
it('reviews only an opaque withdrawable reference and rejects stale/extra authority while leaving rejection to the caller',()=>{
 const f=developmentReferenceFixture(),ref=f.link().referenceId;f.sample().registeredById='outside';const state=projectState(f.state,actor,()=>createMistState(f.ctx,'empty'),'admin',scope).state,a=projectDevelopmentReferenceAccess(f.state,state,actor,scope),c={type:'development.reference.remove',payload:{devId:f.devId,referenceId:ref,reason:'不再使用此引用'}};
 const r=review(c,state,a,f.ctx.now)!;expect(r.reason).toBe('');expect(JSON.stringify(r.rows)).toContain('来源不可读的引用');for(const value of[f.sampleId,ref,'referenceId'])expect(JSON.stringify(r.rows)).not.toContain(value);expect(review({...c,payload:{...c.payload,borrowerId:'sales'}},state,a,f.ctx.now)!.reason).not.toBe('');a.writableDevIds=[];expect(review(c,state,a,f.ctx.now)!.reason).not.toBe('');
});
it('does not trust a readable-but-not-writable upstream scope, a newly ended task, stale source or forged borrower/fee authority',()=>{
 const f=developmentReferenceFixture(),ref=f.link().referenceId,c=dispatch(f,ref),a=access(f);a.writableSampleIds=[];expect(review(c,f.state,a,f.ctx.now)!.reason).not.toBe('');f.run({type:'development.task.end',payload:{devId:f.devId,versionId:f.taskId,kind:'terminated',reason:'该厂暂停'}});expect(review(c,f.state,access(f),f.ctx.now)!.reason).not.toBe('');
 expect(review({...c,payload:{...c.payload,delivery:{...c.payload.delivery,borrowerId:'same-name'}}},f.state,access(f),f.ctx.now)!.reason).not.toBe('');
});
