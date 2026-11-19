import {type MarketProduct,type ProductSource} from './mistMarket';
import {developmentDomain} from './mistDevelopmentDomain';
import {developmentFactoryWorkBlocker} from './mistDevelopmentTaskLifecycle';
import {MistCommandError,type MistContext,type MistState,type MistVersion,type MistDev} from './mistWorkspace';
import type {TrimCatalogProfile,TrimQuoteTerms} from './mistTrimCatalog';

export type MaterialProvider='company'|'factory';
export type MaterialColorMode='dtm'|'specified'|'contrast'|'unspecified';
export type MaterialNature='existing'|'substitute'|'developed';
export const MATERIAL_PROVIDERS={company:'我方提供',factory:'工厂自配'} as const;
export const MATERIAL_COLORS={dtm:'配同色',specified:'指定色',contrast:'撞色',unspecified:'未指定'} as const;
export const MATERIAL_NATURES={existing:'现成料',substitute:'替代料',developed:'开发料'} as const;
export type MaterialUseDetails={position:string;specification:string;color:string;perPiece:string;unit:string;provider:MaterialProvider;colorMode:MaterialColorMode;colorReference:string};
export type FrozenTrimCatalog={id:string;sku:string;name:string;supplierCode:string;composition:string;specification:string;color:string;unit:string;specs:Record<string,string>;fileIds:string[];profile?:TrimCatalogProfile;manufacturerName?:string};
export type FrozenTrimOffer={supplierId:string;supplierName:string;supplierCode:string;price:string;currency:string;moq:string;leadDays:number;terms:TrimQuoteTerms};
export type GarmentMaterialUse=MaterialUseDetails & {id:string;nature:MaterialNature;catalog:FrozenTrimCatalog;offer?:FrozenTrimOffer;trimTaskId?:string;selectedAt:string;selectedBy:string};
export type GarmentMaterialCommand=
  | {type:'development.material.add';payload:MaterialUseDetails & {devId:string;versionId:string;nature:'existing'|'substitute';productId:string;offerSupplierId?:string}}
  | {type:'development.material.addDeveloped';payload:MaterialUseDetails & {devId:string;versionId:string;trimTaskId:string}}
  | {type:'development.material.edit';payload:MaterialUseDetails & {devId:string;versionId:string;useId:string}}
  | {type:'development.material.remove';payload:{devId:string;versionId:string;useId:string}};
function fail(message:string,code='VALIDATION'):never{throw new MistCommandError(code,message);}
function text(v:unknown,label:string,required=false,max=240):string{
  if(typeof v!=='string'||v.length>max||(required&&!v.trim()))return fail(label+'格式无效');
  return v.trim();
}
function details(p:MaterialUseDetails):MaterialUseDetails{
  const perPiece=text(p.perPiece,'每件用量',true,24);
  if(!/^\d{1,9}(?:\.\d{1,4})?$/.test(perPiece)||Number(perPiece)<=0)return fail('每件用量须为正数，最多四位小数');
  if(!Object.prototype.hasOwnProperty.call(MATERIAL_PROVIDERS,p.provider)||!Object.prototype.hasOwnProperty.call(MATERIAL_COLORS,p.colorMode))return fail('请选择提供方式与配色要求');
  const colorReference=text(p.colorReference,'配色参照'),color=text(p.color,'选定颜色');
  if((p.colorMode==='specified'||p.colorMode==='contrast')&&!color)return fail('指定色或撞色须填写具体颜色');
  if(p.colorMode==='dtm'&&!colorReference)return fail('配同色须填写对色参照');
  return {position:text(p.position,'使用部位',true),specification:text(p.specification,'选定规格'),color,perPiece,unit:text(p.unit,'用量单位',true,40),provider:p.provider,colorMode:p.colorMode,colorReference};
}
export function materialChangeBlocker(state:MistState,dev:MistDev,v:MistVersion):string|null{
  if(developmentDomain(dev.values)!=='garment')return '仅成衣开发可登记用料';
  const stop=developmentFactoryWorkBlocker(state,dev,v);if(stop)return stop;
  if(dev.closure||dev.billing?.request||v.returnedAt||v.archivedAt||v.qc||v.qcDecision||v.confirmations.length||v.minor)return '本版用料已冻结';
  return null;
}

/** Older minor versions may lack a copy. Their exact physical parent has already frozen its material use. */
export function garmentMaterialUses(state: Pick<MistState, 'versions'>, version: MistVersion): GarmentMaterialUse[] {
  if (version.materialUses) return version.materialUses;
  if (!version.minor) return [];
  const parentId = version.minor.parentVersionId;
  const parent = state.versions.find(row => row.id === parentId && row.devId === version.devId && !row.minor);
  return parent?.materialUses ?? [];
}
function freezeCatalog(state:MistState,p:MarketProduct):FrozenTrimCatalog{
  const profile=p.trimProfile,manufacturer=profile?.manufacturerRelationId?state.market.relations.find(r=>r.id===profile.manufacturerRelationId):undefined;
  return {id:p.id,sku:p.sku,name:p.name,supplierCode:p.supplierCode,composition:p.composition,specification:p.specification,color:p.color,unit:p.unit,specs:{...p.specs},fileIds:[...p.fileIds],
    ...(profile?{profile:structuredClone(profile)}:{}),...(manufacturer?{manufacturerName:manufacturer.name}:{})};
}
function freezeOffer(state:MistState,p:MarketProduct,sourceId:string,ctx:MistContext):FrozenTrimOffer{
  if(!ctx.can?.('suppliers:read'))throw new MistCommandError('FORBIDDEN','没有供应商报价读取权限',403);
  const offer:ProductSource|undefined=p.sources?.find(s=>s.supplierId===sourceId),supplier=state.market.suppliers.find(s=>s.id===sourceId);
  if(!supplier||supplier.status!=='active'||!offer?.quoteTerms)return fail('所选供应报价缺少有效来源、报价日期或计价单位','PRECONDITION');
  return {supplierId:supplier.id,supplierName:supplier.name,supplierCode:offer.supplierCode,price:offer.price,currency:offer.currency,moq:offer.moq,leadDays:offer.leadDays,terms:structuredClone(offer.quoteTerms)};
}
export function applyGarmentMaterial(state:MistState,command:GarmentMaterialCommand,ctx:MistContext){
  const p=command.payload,dev=state.devs.find(d=>d.id===p.devId),version=state.versions.find(v=>v.id===p.versionId);
  if(!dev||!version||version.devId!==dev.id||!dev.versionIds.includes(version.id))return fail('所选工厂版本不属于本开发案','NOT_FOUND');
  const stop=materialChangeBlocker(state,dev,version);if(stop)return fail(stop,'PRECONDITION');
  if(!ctx.can?.('products:read'))throw new MistCommandError('FORBIDDEN','没有读取辅料档案的权限',403);
  const materials=version.materialUses||[];
  let use:GarmentMaterialUse,action:string;
  if (command.type === 'development.material.addDeveloped') {
    const task = dev.trimTasks?.find(row => row.id === command.payload.trimTaskId);
    if (!task?.confirmed) return fail('请选择本案已确认的开发料', 'PRECONDITION');
    const final = task.confirmed;
    const catalog: FrozenTrimCatalog = {
      id: task.catalogProductId ?? task.id, sku: task.code, name: final.name, supplierCode: '',
      composition: '', specification: final.specification, color: final.color, unit: task.unit,
      specs: {}, fileIds: [...final.fileIds],
    };
    use = {
      ...details(command.payload), id: ctx.id(), nature: 'developed', catalog, trimTaskId: task.id,
      selectedAt: ctx.now, selectedBy: ctx.actorName,
    };
    version.materialUses = [...materials, use];
    action = '选用开发料';
  } else if(command.type==='development.material.add'){
    const input=command.payload;
    const product=state.market.products.find(row=>row.id===input.productId);
    if(!product||product.category!=='trimming'||product.status!=='active')return fail('请选择在用的独立辅料档案','PRECONDITION');
    if(input.nature!=='existing'&&input.nature!=='substitute')return fail('请选择现成料或替代料');
    const offer=input.offerSupplierId?freezeOffer(state,product,input.offerSupplierId,ctx):undefined;
    use={...details(input),id:ctx.id(),nature:input.nature,catalog:freezeCatalog(state,product),...(offer?{offer}:{}),selectedAt:ctx.now,selectedBy:ctx.actorName};
    version.materialUses=[...materials,use];action='选用辅料';
  }else{
    const prior=materials.find(m=>m.id===command.payload.useId);if(!prior)return fail('本版用料不存在','NOT_FOUND');
    if(command.type==='development.material.remove'){use=prior;version.materialUses=materials.filter(m=>m.id!==prior.id);action='移除用料';}
    else{use={...prior,...details(command.payload)};version.materialUses=materials.map(m=>m.id===prior.id?use:m);action='修改用法';}
  }
  dev.updatedAt=ctx.now;
  state.events.unshift({id:ctx.id(),entityType:'development',entityId:dev.id,at:ctx.now,actor:ctx.actorName,text:`${version.label} ${action} ${use.catalog.sku} · ${use.position}`,fileIds:[]});
  return {id:use.id,devId:dev.id,versionId:version.id};
}
/** Only commercial details visible on the current source directory can appear in a projected frozen copy. */
export function projectGarmentMaterials(state:MistState):void{
  const visibleMakers=new Set(state.market?.relations?.map(r=>r.id)||[]),visibleSuppliers=new Set(state.market?.suppliers?.map(s=>s.id)||[]);
  const project=(use:GarmentMaterialUse)=>{
    const maker=use.catalog.profile?.manufacturerRelationId;
    const hideMaker=!!maker&&!visibleMakers.has(maker),hideOffer=!!use.offer&&!visibleSuppliers.has(use.offer.supplierId);
    if(!hideMaker&&!hideOffer)return use;
    const out={...use};
    if(hideMaker){out.catalog={...use.catalog,profile:{...use.catalog.profile!}};delete out.catalog.profile!.manufacturerRelationId;delete out.catalog.manufacturerName;}
    if(hideOffer)delete out.offer;
    return out;
  };
  if (state.versions?.some(v => v.materialUses?.length)) state.versions = state.versions.map(v => {
    const uses = garmentMaterialUses(state, v);
    return uses.length ? { ...v, materialUses: uses.map(project) } : v;
  });
  if(state.market?.products?.some(p=>p.materialUses?.length))state.market={...state.market,products:state.market.products.map(p=>p.materialUses?{...p,materialUses:p.materialUses.map(project)}:p)};
}

/** Source records read while freezing a selection must still match the editor's workspace revision. */
export function materialReadKeys(state:MistState,command:{type:string;payload:unknown}):string[][]{
  if(!command.type.startsWith('development.material.'))return [];
  const c=command as GarmentMaterialCommand,p=c.payload;
  const keys=[['k:devs','i:'+p.devId,'k:closure'],['k:devs','i:'+p.devId,'k:billing'],['k:versions','i:'+p.versionId]];
  if(c.type==='development.material.add'){
    keys.push(['k:market','k:products','i:'+c.payload.productId]);
    if(c.payload.offerSupplierId)keys.push(['k:market','k:suppliers','i:'+c.payload.offerSupplierId]);
    const product=state.market?.products?.find(row=>row.id===c.payload.productId);
    if(product?.trimProfile?.manufacturerRelationId)keys.push(['k:market','k:relations','i:'+product.trimProfile.manufacturerRelationId]);
  }
  if (c.type === 'development.material.addDeveloped') keys.push(['k:devs', 'i:' + p.devId, 'k:trimTasks']);
  return keys;
}
