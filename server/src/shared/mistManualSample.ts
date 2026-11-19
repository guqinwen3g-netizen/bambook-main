import {MistCommandError,type MistContext,type MistState} from './mistWorkspace';
import type {FulfillmentSample} from './mistFulfillment';

/** A free-text origin is retained on the physical record. These links are explicit selections. */
export type ManualSampleLinks={archiveId?:string;productId?:string;customerId?:string;supplierId?:string};
export type ManualSampleLinkEdit={productId?:string|null;customerId?:string|null;supplierId?:string|null};
type Context=Pick<FulfillmentSample,'category'|'source'> & {id?:string;manualLinks?:ManualSampleLinks};
const fail=(message:string):never=>{throw new MistCommandError('VALIDATION',message);};
export function normalizeManualSampleLinks(root:MistState, ctx:MistContext, record:Context, input:ManualSampleLinkEdit & {archiveId?:string}):ManualSampleLinks|undefined{
  if(record.source.kind!=='manual'||!input||typeof input!=='object'||Array.isArray(input))return fail('只能为手工登记的样品选择关联资料');
  const out:ManualSampleLinks={...record.manualLinks};
  for(const field of Object.keys(input)){
    if(field!=='archiveId'&&field!=='productId'&&field!=='customerId'&&field!=='supplierId')return fail('样品关联字段无效');
    const raw=input[field];
    if(raw!==null&&(typeof raw!=='string'||!raw.trim()||raw!==raw.trim()||raw.length>180))return fail('请选择准确的样品关联记录');
    const permission=field==='customerId'?'relations:read':field==='supplierId'?'suppliers:read':'products:read';
    if(!ctx.can?.(permission))throw new MistCommandError('FORBIDDEN','没有查看该关联资料的权限',403);
    if(field==='archiveId'){
      if(record.id||!raw||record.category!=='面料'||input.productId)return fail('请选择一个明确的面料档案');
      const selected=root.fulfillment.samples.find(row=>row.id===raw&&row.category==='面料'&&row.source.kind==='manual');
      if(!selected)return fail('所选手工面料档案不可用');
      out.archiveId=selected.manualLinks?.archiveId||selected.id;
    }else{
      if(field==='productId'&&(out.archiveId||input.archiveId))return fail('同档案形态沿用原档案的产品');
      if(raw===null){delete out[field];continue;}
      if(raw===out[field])continue;
      if(field==='productId'){
        const product=root.market.products.find(p=>p.id===raw&&p.status==='active');
        const expected=record.category==='面料'?'fabric':record.category==='成衣'?'garment':'trimming';
        if(!product||product.category!==expected)return fail('所选产品档案不可用或类别不符');
      }else if(field==='customerId'){
        if(!root.customers.some(c=>c.id===raw)||root.market.relations.some(r=>r.customerId===raw&&r.status==='archived'))return fail('所选客户不可用');
      }else if(!root.market.suppliers.some(s=>s.id===raw&&s.status==='active'))return fail('所选供应商不可用');
      out[field]=raw;
    }
  }
  return Object.keys(out).length?out:undefined;
}
export function manualSampleProductId(sample:Pick<FulfillmentSample,'manualLinks'>,samples:readonly FulfillmentSample[]):string|undefined{
  return sample.manualLinks?.archiveId?samples.find(s=>s.id===sample.manualLinks!.archiveId)?.manualLinks?.productId:sample.manualLinks?.productId;
}
/** A registrar or borrower can read a physical sample without access to every business reference. */
export function projectManualSampleLinks(projected:MistState):MistState{
  const samples=projected.fulfillment?.samples;
  if(!samples?.some(s=>s.manualLinks))return projected;
  const visible={
    archiveId:new Set(samples.map(s=>s.id)),productId:new Set((projected.market?.products??[]).map(p=>p.id)),
    customerId:new Set((projected.customers??[]).map(c=>c.id)),supplierId:new Set((projected.market?.suppliers??[]).map(s=>s.id)),
  };
  const rows=samples.map(sample=>{
    if(!sample.manualLinks)return sample;
    const hidden=(Object.keys(sample.manualLinks) as Array<keyof ManualSampleLinks>).filter(key=>!visible[key].has(sample.manualLinks![key]!));
    if(!hidden.length)return sample;
    const row={...sample},links={...sample.manualLinks};
    for(const key of hidden)delete links[key];
    if(Object.keys(links).length)row.manualLinks=links;else delete row.manualLinks;
    return row;
  });
  return {...projected,fulfillment:{...projected.fulfillment,samples:rows}};
}
