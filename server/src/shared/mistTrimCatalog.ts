import {TRIMMING_CATEGORIES,validateTrimmingCategoryParameters,type TrimmingCategory,type TrimmingCategoryParameters} from '../_shared/trimmingFields';
import {isCalendarDay} from './mistBusinessClock';
import {MistCommandError,type MistContext,type MistState} from './mistWorkspace';
import type {MarketProduct,ProductSource} from './mistMarket';

export type TrimCatalogProfile={category:TrimmingCategory;manufacturerRelationId?:string;parameters:TrimmingCategoryParameters};
export type TrimQuoteTerms={date:string;unit:string;moqUnit?:string;conditions?:string;fileIds:string[]};
export type TrimProfileInput={productId:string;category:TrimmingCategory;manufacturerRelationId?:string|null;parameters:TrimmingCategoryParameters};

export function saveTrimProfile(root:MistState,ctx:MistContext,product:MarketProduct,input:TrimProfileInput):void{
  if(product.category!=='trimming'||product.status!=='active')throw new MistCommandError('PRECONDITION','请选择在用的辅料档案');
  if(!TRIMMING_CATEGORIES.some(c=>c.value===input.category))throw new MistCommandError('VALIDATION','请选择辅料分类');
  const result=validateTrimmingCategoryParameters(input.category,input.parameters);
  if(!result.ok)throw new MistCommandError('VALIDATION',result.message);
  let manufacturerRelationId=product.trimProfile?.manufacturerRelationId;
  if(input.manufacturerRelationId!==undefined){
    if(!ctx.can?.('relations:read'))throw new MistCommandError('FORBIDDEN','没有生产厂家资料读取权限',403);
    if(input.manufacturerRelationId===null)manufacturerRelationId=undefined;
    else{
      const relation=root.market.relations.find(r=>r.id===input.manufacturerRelationId);
      if(!relation||relation.status!=='active')throw new MistCommandError('PRECONDITION','所选生产厂家资料不可用');
      manufacturerRelationId=relation.id;
    }
  }
  product.trimProfile={category:input.category,parameters:result.value,...(manufacturerRelationId?{manufacturerRelationId}:{})};
  product.updatedAt=ctx.now;
}

function textField(value:unknown,max:number,label:string):string{
  if(typeof value!=='string'||value.length>max)throw new MistCommandError('VALIDATION',label+'格式无效');
  return value.trim();
}
export function trimQuoteTerms(root:MistState,input:TrimQuoteTerms,hasMinimum:boolean):TrimQuoteTerms{
  if(!input||typeof input!=='object'||!isCalendarDay(input.date))throw new MistCommandError('VALIDATION','请选择有效的报价日期');
  const unit=textField(input.unit,40,'计价单位'),moqUnit=textField(input.moqUnit??'',40,'起订量单位');
  if(!unit)throw new MistCommandError('VALIDATION','请填写计价单位');
  if(hasMinimum&&!moqUnit)throw new MistCommandError('VALIDATION','请填写起订量单位');
  const conditions=textField(input.conditions??'',2000,'适用条件');
  if(!Array.isArray(input.fileIds)||input.fileIds.length>100)throw new MistCommandError('VALIDATION','报价依据附件格式无效');
  const fileIds=[...new Set(input.fileIds)];
  if(fileIds.some(id=>!root.files.some(f=>f.id===id)))throw new MistCommandError('NOT_FOUND','报价依据附件不可用',404);
  return {date:input.date,unit,...(moqUnit?{moqUnit}:{}),...(conditions?{conditions}:{}),fileIds};
}
export const sourcePriceLabel=(source:ProductSource)=>source.price+' '+source.currency+(source.quoteTerms?' / '+source.quoteTerms.unit:'');

/** Keep referenced company-directory and supplier documents within the viewer's projection. */
export function projectTrimCatalog(state:MistState):void{
  if(!state.market?.products?.some(p=>p.trimProfile||p.sources?.some(s=>s.quoteTerms)||p.priceHistory?.some(h=>h.previousTerms||h.newTerms)))return;
  const relations=new Set((state.market.relations||[]).map(r=>r.id)),suppliers=new Set((state.market.suppliers||[]).map(s=>s.id));
  const products=state.market.products.map(product=>{
    const profile=product.trimProfile;
    const hideMaker=profile?.manufacturerRelationId&&!relations.has(profile.manufacturerRelationId);
    const hideTerms=product.sources?.some(s=>s.quoteTerms&&!suppliers.has(s.supplierId));
    const hideHistory=product.priceHistory?.some(v=>(v.previousTerms||v.newTerms)&&!suppliers.has(v.supplierId));
    if(!hideMaker&&!hideTerms&&!hideHistory)return product;
    const p={...product};
    if(hideMaker&&profile){p.trimProfile={...profile};delete p.trimProfile.manufacturerRelationId;}
    if(hideTerms)p.sources=product.sources?.map(source=>{if(suppliers.has(source.supplierId))return source;const row={...source};delete row.quoteTerms;return row;});
    if(hideHistory)p.priceHistory=product.priceHistory?.map(h=>{if(suppliers.has(h.supplierId))return h;const row={...h};delete row.previousTerms;delete row.newTerms;return row;});
    return p;
  });
  state.market={...state.market,products};
}
