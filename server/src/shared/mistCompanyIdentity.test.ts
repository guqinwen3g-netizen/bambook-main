import {describe,expect,it} from 'vitest';
import {createMistCompanyBaseline,type MistCompanyRoster} from './mistCompanyBaseline';
import {mistCompanyDisplayName,mistCompanySeedFileSource,renameMistCompanyIdentity} from './mistCompanyIdentity';
import {assertCreditSourceVersions} from './mistCreditDocuments';
import {assertMistOrderApproved} from './mistWorkspace';

describe('company presentation rename',()=>{
 it('changes names, email identities and serialized snapshots without changing business IDs or amounts',()=>{
  const original={id:'claridge-peak-owner',amount:491.12,name:'周敏',lines:[{owner:'顾言',ownerId:'claridge-peak-garment-sales'}],snapshot:JSON.stringify({actor:'顾言',company:'澄岳纺织服装贸易（上海）有限公司',email:'zhou.min@claridgepeak-textile.com'})};
  const result=renameMistCompanyIdentity(original);
  expect(original.name).toBe('周敏');expect(result).toMatchObject({id:original.id,amount:original.amount,name:'沈霁',lines:[{owner:'林澈',ownerId:'claridge-peak-garment-sales'}]});
  expect(JSON.parse(result.snapshot)).toEqual({actor:'林澈',company:'雾织国际贸易（上海）有限公司',email:'shen.ji@mistweave-textile.com'});
  expect(renameMistCompanyIdentity(result)).toEqual(result);
  expect(mistCompanyDisplayName('gu.yan@claridgepeak-textile.com')).toBe('lin.che@mistweave-textile.com');
 });
 it('uses the new identity throughout fresh baseline records and resolves every existing PDF to its source',()=>{
  let sequence=0;const roster=Object.fromEntries(['owner','fabricManager','garmentManager','fabricSales','garmentSales','finance','fabricQc','garmentQc','logistics'].map((key,index)=>[key,{id:'account-'+key,name:['周敏','俞宁','陆衡','沈禾','顾言','林舒','唐岚','许言','陈晓'][index]}])) as MistCompanyRoster;
  const state=createMistCompanyBaseline({id:()=>`identity-${++sequence}`,now:'2026-10-19T04:00:00.000Z',actorName:'周敏',actorId:roster.owner.id},roster);
  expect(/周敏|顾言|澄岳|Claridge Peak|claridgepeak-textile\.com|zhou\.min@|gu\.yan@/.test(JSON.stringify(state))).toBe(false);
  expect(state.settings.workspaceName).toBe('雾织贸易 · 经营工作台');
  expect(state.files).toHaveLength(55);
  for(const file of state.files)expect(mistCompanySeedFileSource(state,file),file.name).not.toBeNull();
  for(const order of state.orders)expect(()=>assertMistOrderApproved(state,order.id)).not.toThrow();
  for(const credit of state.platform.credits)expect(()=>assertCreditSourceVersions(credit.sourceVersions!)).not.toThrow();
 });
});
