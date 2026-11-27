import {expect,it} from 'vitest';
import {createMistState} from '../shared/mistWorkspace';
import {normalizeAgentTaskIntentRefs} from '../shared/mistAgentTasks';
import {taskHistoryReadRefs,taskIntentReadTargets,validateTaskIntentRefs,taskIntentRefsVisible,taskIntentCeilingAllows,nextTaskIntentRead} from './agentTaskIntentRefs';
import {AGENT_OBJECT_TYPES} from './agentRead';
const actor:any={userId:'owner',roles:[],departmentIds:[],authorizationLoaded:true,permissions:['orders:read','invoices:read']};
const state=()=>{const s=createMistState({id:()=>'',now:'2026-11-01T00:00:00Z',actorId:'owner',actorName:'owner'},'empty');s.orders.push({id:'order-A',code:'同名',ownerId:'owner'}as any);s.invoices.push({id:'invoice-A',code:'同名'}as any);return s;};
it('validates exact readable records and does not trust an unknown, hidden or foreign identity under a visible label',()=>{
 const visible=state();expect(validateTaskIntentRefs([{kind:'orders',id:'order-A'},{kind:'invoices',id:'invoice-A'}],actor,visible)).toEqual([{kind:'orders',id:'order-A'},{kind:'invoices',id:'invoice-A'}]);
 for(const id of['unknown','hidden-order','foreign-company-order'])expect(()=>validateTaskIntentRefs([{kind:'orders',id}],actor,visible)).toThrow('引用记录不存在');
 expect(taskIntentRefsVisible([{kind:'orders',id:'order-A'}],{...actor,permissions:['ai:chat']},visible)).toBe(false);expect(()=>validateTaskIntentRefs([{kind:'orders',id:'order-A'}],{...actor,permissions:[]},visible)).toThrow('引用记录不存在');
});
it('bounds and normalizes typed IDs without accepting labels, paths, empty IDs or other fields',()=>{
 expect(normalizeAgentTaskIntentRefs(undefined)).toEqual([]);expect(normalizeAgentTaskIntentRefs([{kind:'orders',id:'same'},{kind:'orders',id:'same'},{kind:'invoices',id:'same'}])).toEqual([{kind:'orders',id:'same'},{kind:'invoices',id:'same'}]);
 for(const value of[null,{},[{kind:'files',id:'f'}],[{kind:'orders',id:''}],[{kind:'orders',id:' x'}],[{kind:'orders',id:'x',label:'伪造显示名'}],Array.from({length:13},(_,i)=>({kind:'orders',id:String(i)}))])expect(()=>normalizeAgentTaskIntentRefs(value)).toThrow();
});
it('maps every allowed intent kind to a real existing get object type and checks the delegated read ceiling',()=>{
 const pairs=[['orders','order'],['invoices','invoice'],['customers','customer'],['purchases','purchase'],['shipments','shipment'],['developments','development'],['risks','risk']]as const;
 expect(taskIntentReadTargets(pairs.map(([kind])=>({kind,id:kind})))).toEqual(pairs.map(([kind,type])=>({type,id:kind})));expect(taskIntentCeilingAllows([{kind:'orders',id:'order-A'}],['orders:read'])).toBe(true);expect(taskIntentCeilingAllows([{kind:'orders',id:'order-A'}],['ai:chat'])).toBe(false);
 for(const [,type]of pairs)expect(AGENT_OBJECT_TYPES.some(t=>t.type===type)).toBe(true);
});
it('requires completed exact MCP gets and preserves failed and compacted read boundaries',()=>{
 const refs=[{kind:'orders',id:'A'},{kind:'invoices',id:'B'}]as const,step=(type:string,id:string,result?:unknown,compacted?:boolean)=>({id:'step',at:'2026-11-01T00:00:00Z',plan:{name:'bambook_get',arguments:{type,id}},result,compacted});
 expect(nextTaskIntentRead([...refs],[]).plan).toEqual({name:'bambook_get',arguments:{type:'order',id:'A'}});
 expect(nextTaskIntentRead([...refs],[step('order','A')]).plan?.arguments.id).toBe('A');expect(nextTaskIntentRead([...refs],[step('invoice','A',{object:{id:'A'}})]).plan?.arguments.type).toBe('order');
 expect(nextTaskIntentRead([...refs],[step('order','A',{object:{id:'other'}})])).toEqual({failed:true});expect(nextTaskIntentRead([...refs],[step('order','A',{error:true})])).toEqual({failed:true});
 expect(nextTaskIntentRead([...refs],[step('order','A',{object:{id:'A'},truncated:true})]).plan?.arguments).toEqual({type:'invoice',id:'B'});
 expect(nextTaskIntentRead([...refs],[step('order','A',{truncated:true},true)]).plan?.arguments.id).toBe('B');expect(nextTaskIntentRead([...refs],[step('order','A',{error:true},true)])).toEqual({failed:true});
});

it('keeps exact completed reads alongside selected refs without inheriting partial or unrelated IDs', () => {
 const makeRead = (name:string, args:Record<string,unknown>, result:unknown, compacted=false) => ({
  id:'step',at:'2026-11-01T00:00:00Z',plan:{name,arguments:args},result,compacted,
 });
 const order = (id:string, truncated=false) => ({type:'order',id,truncated,data:{due:'2027-05-21'}});
 const selected = [{kind:'orders' as const,id:'A'}];
 expect(taskHistoryReadRefs(selected,[
  makeRead('bambook_get',{type:'order',id:'A'},{object:order('A')}),
  makeRead('bambook_get',{type:'order',id:'B'},{object:order('B')}),
  makeRead('bambook_get',{type:'order',id:'C'},{object:order('C',true)}),
  makeRead('bambook_get',{type:'order',id:'D'},{object:order('other')}),
  makeRead('bambook_get',{type:'order',id:'E'},{error:true,object:order('E')}),
  makeRead('bambook_get',{type:'order',id:'F'},{object:order('F')},true),
  makeRead('bambook_get_orders',{ids:['G']},{orders:[order('G'),order('unrequested')]}),
 ])).toEqual(['A','B','G'].map(id => ({kind:'orders',id})));
 expect(taskHistoryReadRefs(selected,Array.from({length:12},(_,i)=>{
  const id='read-'+i;
  return makeRead('bambook_get',{type:'order',id},{object:order(id)});
 }))).toBeUndefined();
});
