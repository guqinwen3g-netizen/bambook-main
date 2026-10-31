import { expect,it } from 'vitest';
import {createMistState} from '../shared/mistWorkspace';
import {randomUUID} from 'node:crypto';
import {collectTaskSources,taskScopeHash,taskSourcesVisible} from './agentTaskVisibility';
const state=()=>createMistState({id:randomUUID,actorName:'Test',now:'2026-11-01T00:00:00Z'},'empty');
it('preserves current full-object access across ordinary values and new optional fields, but not after source removal',()=>{
 const s=state();s.orders.push({id:'order',code:'SO-1',amount:10} as any);const refs=collectTaskSources({object:{type:'order',id:'order',data:s.orders[0]}},s,[]);
 s.orders[0].amount=20;(s.orders[0]as any).newReview={state:'reviewed'};expect(taskSourcesVisible(refs,taskScopeHash(),s,s)).toBe(true);
 s.orders=[];expect(taskSourcesVisible(refs,taskScopeHash(),s,s)).toBe(false);
});
it('rejects changed team/department data boundaries even when module permissions are unchanged',()=>{
 const s=state(),old={userIds:['u'],teamIds:['a']};expect(taskSourcesVisible([],taskScopeHash(old,s),s,s,{userIds:['u'],teamIds:['b']})).toBe(false);
});
it('never restores an old complete ledger through a partial view, and partial source coverage may only stay or grow',()=>{
 const s=state();(s as any).orderCosts={expenses:[{id:'expense',amount:'100',shares:[{orderId:'a',amount:'50'},{orderId:'b',amount:'50'}]}]};
 const full=collectTaskSources({id:'expense'},s,[]),p=state();(p as any).partialExpenses=[{id:'expense',shares:[{orderId:'a',amount:'50'}],hiddenCount:1}];
 expect(taskSourcesVisible(full,taskScopeHash(),p,s)).toBe(false);
 const partial=collectTaskSources({id:'expense'},p,[]);(p as any).partialExpenses[0].shares[0].amount='60';expect(taskSourcesVisible(partial,taskScopeHash(),p,s)).toBe(true);
 (p as any).partialExpenses[0].shares.push({orderId:'c',amount:'10'});expect(taskSourcesVisible(partial,taskScopeHash(),p,s)).toBe(true);
 (p as any).partialExpenses[0].shares=[{orderId:'c',amount:'10'}];expect(taskSourcesVisible(partial,taskScopeHash(),p,s)).toBe(false);
});
it('does not confuse incidental old IDs in a visible private email with permission to the business record',()=>{
 const s=state();s.email.messages.push({id:'mail',links:[{kind:'order',id:'hidden-order'}]} as any);
 const refs=collectTaskSources({object:{type:'email',id:'mail',data:s.email.messages[0]}},s,[]);expect(refs.map(r=>r.id)).toEqual(['mail']);
 expect(()=>collectTaskSources({object:{type:'order',id:'hidden-order'}},s,[])).toThrow('来源已不可见');
});
