import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createMistState} from '../shared/mistWorkspace';
import type {TokenPayload} from '../auth/service';
import {agentGet,agentQuery} from './agentRead';
import {collectTaskSources} from './agentTaskVisibility';
import {prepareTaskCondition,taskConditionChanged,taskConditionInput} from './agentTaskConditions';

const actor={userId:'owner',permissions:['emails:read','orders:read'],roles:[],departmentIds:[],authorizationLoaded:true} as TokenPayload;
function fixture(){const state=createMistState({id:randomUUID,actorName:'Test',now:'2026-11-01T00:00:00Z'},'empty');state.orders.push({id:'order',code:'SO-1',status:'pending'} as any);return state;}
const target={type:'order',id:'order'};
it('accepts only a typed object identity, without a user hash, expression or hidden path',()=>{
 expect(taskConditionInput(target)).toEqual(target);expect(taskConditionInput(undefined)).toBeUndefined();
 for(const value of [null,[],{...target,hash:'forged'},{type:'user',id:'owner'},{type:'orders.status',id:'order'},{type:'order',id:''},{type:'order',id:'x'.repeat(201)}])expect(()=>taskConditionInput(value)).toThrow();
});
it('requires a genuine explicit full read and does not turn query summaries into a full-read baseline',()=>{
 const s=fixture(),listed=collectTaskSources({revision:1,...agentQuery(s,actor,{type:'order'})},s,[]);
 expect(()=>prepareTaskCondition(target,listed,s,actor)).toThrow('请先完整读取');
 const read=collectTaskSources({revision:1,object:agentGet(s,actor,'order','order')},s,listed),condition=prepareTaskCondition(target,read,s,actor);
 expect(condition).toMatchObject({type:'order',id:'order',label:'SO-1'});expect(condition.hash).toMatch(/^[a-f0-9]{64}$/);
 expect(()=>prepareTaskCondition({type:'order',id:'SO-1'},read,s,actor)).toThrow('请使用原资料的对象编号');
});
it('detects the exact object change, ignores unrelated rows, and requires another full read before rearming',()=>{
 const s=fixture(),read=collectTaskSources({revision:1,object:agentGet(s,actor,'order','order')},s,[]),condition={...prepareTaskCondition(target,read,s,actor),nextCheckAt:30_000};
 s.orders.push({id:'other',code:'SO-2',status:'approved'} as any);expect(taskConditionChanged(condition,s,actor)).toBe(false);
 s.orders[0].status='approved';expect(taskConditionChanged(condition,s,actor)).toBe(true);
 const listedAgain=collectTaskSources({revision:2,...agentQuery(s,actor,{type:'order'})},s,read);expect(()=>prepareTaskCondition(target,listedAgain,s,actor)).toThrow('已变化');
 const reread=collectTaskSources({revision:2,object:agentGet(s,actor,'order','order')},s,listedAgain);expect(prepareTaskCondition(target,reread,s,actor).hash).not.toBe(condition.hash);
});
it('refuses truncated and unknown-completeness data as a waiting baseline',()=>{
 const s=fixture(),object=agentGet(s,actor,'order','order');
 for(const data of [{revision:1,object:{...object,truncated:true}},{revision:1,object:{...object,truncated:undefined}}])expect(()=>prepareTaskCondition(target,collectTaskSources(data,s,[]),s,actor)).toThrow('请先完整读取');
 (s.orders[0] as any).largeText='x'.repeat(30_000);expect(agentGet(s,actor,'order','order').truncated).toBe(true);
});
it('fingerprints visible send facts rather than transport/private metadata and rechecks type permission',()=>{
 const s=fixture();s.email.sends.push({id:'send',accountId:'a',from:'staff@example.test',to:'buyer@example.test',cc:'',bcc:'',subject:'Order update',body:'Original message',status:'sent',requestId:'private-request',response:'private-transport'} as any);
 const t={type:'email_send',id:'send'},read=collectTaskSources({revision:1,object:agentGet(s,actor,t.type,t.id)},s,[]),condition={...prepareTaskCondition(t,read,s,actor),nextCheckAt:30_000};
 (s.email.sends[0] as any).response='changed-transport';(s.email.sends[0] as any).requestId='new-private-request';expect(taskConditionChanged(condition,s,actor)).toBe(false);
 s.email.sends[0].subject='Updated order';expect(taskConditionChanged(condition,s,actor)).toBe(true);
 expect(()=>taskConditionChanged(condition,s,{...actor,permissionCeiling:[]})).toThrow();
});
