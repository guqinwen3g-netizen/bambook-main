import React from 'react';
import {Button,Dialog,Facts,TextLink} from '../../../../../components/mist';
import {uiText} from '../../../../../services/interfaceLanguage';
import type {FulfillmentSample} from '../../../../../server/src/shared/mistFulfillment';
import type {MistState} from '../../../../../server/src/shared/mistWorkspace';
import {manualSampleProductId,type ManualSampleLinkEdit,type ManualSampleLinks} from '../../../../../server/src/shared/mistManualSample';
import {activeCustomers} from '../../runtime/activeCustomers';
import {useNav} from '../../nav';
import {useMistSession} from '../../runtime/auth';
import type {ModuleField,ModuleValues} from './ModuleWorkbench';

const categories=[['面料','fabric'],['成衣','garment'],['其他','trimming']] as const;
const productKey=(category:string)=>(categories.find(([label])=>label===category)?.[1]??'trimming')+'ProductId';
const blank={value:'',label:'未关联'};
const normalized=(name:string)=>name.trim().normalize('NFKC').replace(/\s+/g,' ').toLocaleLowerCase();

export function manualLinkFields(state:MistState|null,canCustomer:boolean,canSupplier:boolean,sample?:FulfillmentSample):ModuleField[]{
  const links=sample?.manualLinks,when=sample?[]:[{key:'source',values:['manual']}],fields:ModuleField[]=[];
  if(!sample){
    const archives=state?.fulfillment.samples.filter(s=>s.category==='面料'&&s.source.kind==='manual'&&!s.manualLinks?.archiveId)??[];
    fields.push({key:'archiveId',label:'已有手工档案',type:'select',when:[...when,{key:'category',values:['面料']}],options:[
      {value:'',label:'独立登记'},...archives.map(s=>({value:s.id,label:`${s.code} · ${s.name} · ${s.source.kind==='manual'?s.source.description:''}`}))]});
  }
  for(const [label,category] of categories){
    if(sample&&(links?.archiveId||productKey(sample.category)!==category+'ProductId'))continue;
    const products=(state?.market?.products??[]).filter(p=>p.category===category&&(p.status==='active'||p.id===links?.productId));
    fields.push({key:category+'ProductId',label:'关联产品档案',type:'select',
      when:sample?undefined:[...when,{key:'category',values:[label]},...(category==='fabric'?[{key:'archiveId',values:['']}]:[])],
      options:[blank,...products.map(p=>({value:p.id,label:p.sku+' · '+p.name}))]});
  }
  if(canCustomer)fields.push({key:'customerId',label:'关联客户',type:'select',when,options:[blank,...activeCustomers(state,links?.customerId).map(c=>({value:c.id,label:c.name}))]});
  if(canSupplier)fields.push({key:'supplierId',label:'关联供应商',type:'select',when,options:[blank,...(state?.market?.suppliers??[]).filter(s=>s.status==='active'||s.id===links?.supplierId).map(s=>({value:s.id,label:s.name}))]});
  return fields;
}

export function newManualLinks(values:ModuleValues):ManualSampleLinks|undefined{
  if(values.source!=='manual')return;
  const archiveId=values.category==='面料'?String(values.archiveId||''):'';
  const productId=String(values[productKey(String(values.category))]||'');
  const links={...(archiveId?{archiveId}:productId?{productId}:{}),...(values.customerId?{customerId:String(values.customerId)}:{}),...(values.supplierId?{supplierId:String(values.supplierId)}:{})};
  return Object.keys(links).length?links:undefined;
}
export function changedManualLinks(sample:FulfillmentSample,values:ModuleValues):ManualSampleLinkEdit|undefined{
  if(sample.source.kind!=='manual')return;
  const patch:ManualSampleLinkEdit={};
  for(const key of ['productId','customerId','supplierId'] as const){
    const field=key==='productId'?productKey(sample.category):key;
    if(values[field]===undefined)continue;
    const id=String(values[field]||'');
    if(id!==(sample.manualLinks?.[key]||''))patch[key]=id||null;
  }
  return Object.keys(patch).length?patch:undefined;
}
export function manualLinkInitial(sample:FulfillmentSample){
  return {[productKey(sample.category)]:sample.manualLinks?.productId||'',customerId:sample.manualLinks?.customerId||'',supplierId:sample.manualLinks?.supplierId||''};
}
function linkedRecords(state:MistState,s:FulfillmentSample){
  const productId=manualSampleProductId(s,state.fulfillment.samples),links=s.manualLinks;
  return {product:productId?state.market?.products?.find(p=>p.id===productId):undefined,
    customer:links?.customerId?state.customers.find(c=>c.id===links.customerId):undefined,
    supplier:links?.supplierId?state.market?.suppliers?.find(p=>p.id===links.supplierId):undefined};
}
export function manualSearchTerms(state:MistState,s:FulfillmentSample){
  if(!s.manualLinks)return [];
  const {product,customer,supplier}=linkedRecords(state,s);
  return [product?.sku,product?.name,product?.supplierCode,customer?.name,supplier?.name];
}
export function ManualSampleLinksView({state,sample}:{state:MistState;sample:FulfillmentSample}){
  const {go}=useNav(),session=useMistSession();if(!sample.manualLinks)return null;
  const {product,customer,supplier}=linkedRecords(state,sample);
  const relation=customer&&state.market?.relations?.find(r=>r.customerId===customer.id);
  const openCustomer=customer&&(session.hasPermission('crm:read')?()=>go('crm',customer.id,{customerId:customer.id}):relation&&session.hasPermission('relations:read')?()=>go('relations',relation.id,{detail:'full'}):undefined);
  return <div className="mist-row mist-module-actions">
    {product&&<TextLink onClick={()=>go('products',product.id,{detail:'full'})}>{uiText('关联产品档案')} · {product.sku} · {product.name}</TextLink>}
    {customer&&(openCustomer?<TextLink onClick={openCustomer}>{uiText('关联客户')} · {customer.name}</TextLink>:<span>{uiText('关联客户')} · {customer.name}</span>)}
    {supplier&&<TextLink onClick={()=>go('suppliers',supplier.id,{detail:'full'})}>{uiText('关联供应商')} · {supplier.name}</TextLink>}
  </div>;
}
function CandidateList({samples,onReuse}:{samples:FulfillmentSample[];onReuse:(id:string)=>void}){
  const [selected,setSelected]=React.useState<string>();const sample=samples.find(s=>s.id===selected);
  return <div className="mist-col"><b>{uiText('可能重复的样品')}</b>{samples.map(s=><div key={s.id} className="mist-row">
    <span>{s.code} · {s.name} · {s.source.kind==='manual'?s.source.description:''} · {s.form} · {s.location}</span>
    <Button size="sm" onClick={()=>setSelected(s.id)}>{uiText('打开候选')}</Button></div>)}
    {sample&&<Dialog open title={sample.code+' · '+sample.name} onClose={()=>setSelected(undefined)} footer={sample.category==='面料'?<Button onClick={()=>onReuse(sample.manualLinks?.archiveId||sample.id)}>{uiText('沿用此档案')}</Button>:undefined}><Facts items={[
      {label:'来源',value:sample.source.kind==='manual'?sample.source.description:''},{label:'形态',value:sample.form},
      {label:'颜色',value:sample.color||'—'},{label:'尺码',value:sample.size||'—'},
      {label:'存放位置',value:sample.location||'—'},{label:'可用数量',value:`${sample.available} ${sample.unit}`},
    ]}/></Dialog>}</div>;
}
export function manualSampleReview(values:ModuleValues,state:MistState|null,change:(key:string,value:string)=>void){
  if(values.source!=='manual'||values.archiveId||newManualLinks(values)?.productId||!String(values.name||'').trim())return;
  const name=normalized(String(values.name)),category=values.category==='其他'?String(values.categoryCustom||'其他'):values.category;
  const samples=(state?.fulfillment.samples??[]).filter(s=>s.source.kind==='manual'&&s.category===category&&normalized(s.name)===name);
  if(samples.length)return {content:<CandidateList samples={samples} onReuse={id=>change('archiveId',id)}/>,submitLabel:'仍然新增'};
}
