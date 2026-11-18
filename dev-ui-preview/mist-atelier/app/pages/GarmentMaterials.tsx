import React from 'react';
import {Button,Card,CardHeader,Dialog,Facts,TextLink} from '../../../../components/mist';
import {TRIMMING_CATEGORIES,trimmingParameterFields} from '../../../../server/src/_shared/trimmingFields';
import {uiText} from '../../../../services/interfaceLanguage';
import {MATERIAL_COLORS,MATERIAL_NATURES,MATERIAL_PROVIDERS,materialChangeBlocker,type GarmentMaterialUse,type MaterialUseDetails} from '../../../../server/src/shared/mistGarmentMaterials';
import type {MistDev,MistVersion} from '../../../../server/src/shared/mistWorkspace';
import {useMistWorkspace} from '../runtime/workspace';
import {useMistSession} from '../runtime/auth';
import {useNav} from '../nav';
import {FileName} from '../runtime/files';
import {ModuleEditorDialog,type ModuleEditorSpec,type ModuleField,type ModuleValues} from './modules/ModuleWorkbench';

const options=(labels:Record<string,string>)=>Object.entries(labels).map(([value,label])=>({value,label}));
const usageFields:ModuleField[]=[
  {key:'position',label:'使用部位',required:true},{key:'specification',label:'选定规格'},{key:'color',label:'选定颜色'},
  {key:'perPiece',label:'每件用量',required:true},{key:'unit',label:'用量单位',required:true},
  {key:'provider',label:'提供方式',type:'select',required:true,options:options(MATERIAL_PROVIDERS)},
  {key:'colorMode',label:'配色要求',type:'select',required:true,options:options(MATERIAL_COLORS)},{key:'colorReference',label:'配色参照'},
];
function details(values:ModuleValues):MaterialUseDetails{
  return {position:String(values.position||''),specification:String(values.specification||''),color:String(values.color||''),perPiece:String(values.perPiece||''),
    unit:String(values.unit||''),provider:values.provider as MaterialUseDetails['provider'],colorMode:values.colorMode as MaterialUseDetails['colorMode'],colorReference:String(values.colorReference||'')};
}
export function MaterialFacts({use}:{use:GarmentMaterialUse}){
  const {state}=useMistWorkspace(),{go}=useNav();
  const q=use.offer,p=use.catalog,source=state?.market?.products?.find(s=>s.id===p.id);
  return <div className="mist-col"><Facts items={[
    {label:'辅料档案',value:source?<TextLink onClick={()=>go('products',p.id,{detail:'full'})}>{p.sku} · {p.name}</TextLink>:p.sku+' · '+p.name},
    {label:'使用部位',value:use.position},{label:'每件用量',value:use.perPiece+' '+use.unit},
    {label:'选定规格',value:use.specification||p.specification||'—'},{label:'选定颜色',value:use.color||'—'},
    {label:'配色要求',value:MATERIAL_COLORS[use.colorMode]},{label:'配色参照',value:use.colorReference||'—'},
    {label:'提供方式',value:MATERIAL_PROVIDERS[use.provider]},{label:'材料来源',value:MATERIAL_NATURES[use.nature]},
    ...(p.composition?[{label:'材质与成分',value:p.composition}]:[]),
    ...(p.profile?[{label:'辅料分类',value:TRIMMING_CATEGORIES.find(c=>c.value===p.profile?.category)?.label||p.profile.category},
      ...trimmingParameterFields(p.profile.category).filter(f=>p.profile!.parameters[f.key]).map(f=>({label:f.label,value:p.profile!.parameters[f.key]}))]:[]),
    ...(p.manufacturerName?[{label:'生产厂家',value:p.manufacturerName}]:[]),
    ...(q?[{label:'报价供应商',value:q.supplierName},{label:'供应商品号',value:q.supplierCode||'—'},
      {label:'供应报价',value:q.currency+' '+q.price+' / '+q.terms.unit},{label:'报价日期',value:q.terms.date},
      ...(q.moq?[{label:'起订量',value:q.moq+' '+(q.terms.moqUnit||'')}]:[]),...(q.terms.conditions?[{label:'适用条件',value:q.terms.conditions}]:[])]:[]),
  ]}/>{p.fileIds.map(id=>{const f=state?.files.find(x=>x.id===id);return f?<FileName key={id} file={f}/>:null;})}{q?.terms.fileIds.map(id=>{const f=state?.files.find(x=>x.id===id);return f?<FileName key={id} file={f}/>:null;})}</div>;
}
export function GarmentMaterialRows({rows,edit,remove}:{rows:GarmentMaterialUse[];edit?:(m:GarmentMaterialUse)=>void;remove?:(m:GarmentMaterialUse)=>void}){
  const [selected,setSelected]=React.useState<string|null>(null),detail=rows.find(m=>m.id===selected);
  return <div className="mist-col">{rows.map(m=><div key={m.id} className="mist-row" data-material-use={m.id}>
    <TextLink onClick={()=>setSelected(m.id)}>{m.position} · {m.catalog.sku} · {m.catalog.name}</TextLink>
    <span className="mist-num">{m.perPiece} {m.unit}</span><span>{uiText(MATERIAL_PROVIDERS[m.provider])}</span><span className="mist-spacer"/>
    {edit&&<Button size="sm" onClick={()=>edit(m)}>{uiText('修改用法')}</Button>}{remove&&<Button size="sm" onClick={()=>remove(m)}>{uiText('移除')}</Button>}
  </div>)}{detail&&<Dialog open title={detail.position+' · '+detail.catalog.name} onClose={()=>setSelected(null)}><MaterialFacts use={detail}/></Dialog>}</div>;
}
export function GarmentMaterials({dev,version}:{dev:MistDev;version:MistVersion}){
  const w=useMistWorkspace(),session=useMistSession(),[editor,setEditor]=React.useState<ModuleEditorSpec|null>(null);
  const products=(w.state?.market?.products||[]).filter(p=>p.status==='active'&&p.category==='trimming');
  const confirmedTasks=(dev.trimTasks ?? []).filter(task=>task.confirmed);
  const allowed=session.hasPermission('products:write'),stop=w.state?materialChangeBlocker(w.state,dev,version):'正在读取';
  const write=(use?:GarmentMaterialUse)=>{
    const revision=w.workspace?.revision,base={devId:dev.id,versionId:version.id};
    const fields:ModuleField[]=use?[]:[
      {key:'nature',label:'材料来源',type:'select',required:true,options:options({
        existing:MATERIAL_NATURES.existing,substitute:MATERIAL_NATURES.substitute,
        ...(confirmedTasks.length ? { developed: MATERIAL_NATURES.developed } : {}),
      })},
      {key:'productId',label:'选用辅料',type:'select',required:true,when:{key:'nature',values:['existing','substitute']},
        options:[{value:'',label:'请选择'},...products.map(p=>({value:p.id,label:p.sku+' · '+p.name}))]},
      {key:'trimTaskId',label:'已确认辅料',type:'select',required:true,when:{key:'nature',values:['developed']},
        options:confirmedTasks.map(task=>({value:task.id,label:task.code+' · '+task.confirmed!.name}))},
      ...products.flatMap(p=>{
        const sources=(p.sources||[]).filter(s=>s.quoteTerms&&w.state?.market.suppliers.some(supplier=>supplier.id===s.supplierId&&supplier.status==='active'));
        return sources.length?[{key:'quote_'+p.id,label:'供应报价',type:'select' as const,when:[{key:'productId',values:[p.id]},{key:'nature',values:['existing','substitute']}],options:[{value:'',label:'未选报价'},...sources.map(s=>{
          const name=w.state?.market.suppliers.find(r=>r.id===s.supplierId)?.name;
          return {value:s.supplierId,label:`${name} · ${s.price} ${s.currency}/${s.quoteTerms!.unit} · ${s.quoteTerms!.date}`};
        })]}]:[];
      }),
    ];
    setEditor({title:use?'修改用法':'选用辅料',submitLabel:'保存用料',initialValues:{productId:'',trimTaskId:'',nature:'existing',position:use?.position||'',perPiece:use?.perPiece||'',unit:use?.unit||'',
      provider:use?.provider||'',colorMode:use?.colorMode||'unspecified',colorReference:use?.colorReference||'',color:use?.color||'',specification:use?.specification||''},
      fields:[...fields,...usageFields],
      derive:(key,value)=>{
        if (key==='trimTaskId') {
          const task=confirmedTasks.find(row=>row.id===value);
          return {unit:task?.unit??'',specification:task?.confirmed?.specification??'',color:task?.confirmed?.color??''};
        }
        if (key==='nature') return {productId:'',trimTaskId:'',unit:'',specification:'',color:''};
        if (key!=='productId') return {};
        const product=products.find(row=>row.id===value);
        return {unit:product?.unit??'',specification:product?.specification??'',color:product?.color??''};
      },
      submit:values=>{
        const usage=details(values),id=String(values.productId||''),supplier=String(values['quote_'+id]||'');
        const options=revision===undefined?undefined:{expectedRevision:revision};
        if (use) return w.run({type:'development.material.edit',payload:{...base,useId:use.id,...usage}},options);
        if (values.nature==='developed') return w.run({type:'development.material.addDeveloped',
          payload:{...base,trimTaskId:String(values.trimTaskId||''),...usage}},options);
        return w.run({type:'development.material.add',payload:{...base,productId:id,nature:values.nature as 'existing'|'substitute',
          ...(supplier?{offerSupplierId:supplier}:{}),...usage}},options);
      }});
  };
  const remove=(use:GarmentMaterialUse)=>{const revision=w.workspace?.revision;setEditor({title:'移除用料',description:use.position+' · '+use.catalog.name,submitLabel:'移除',submitVariant:'danger',fields:[],initialValues:{},
    submit:()=>w.run({type:'development.material.remove',payload:{devId:dev.id,versionId:version.id,useId:use.id}},revision===undefined?undefined:{expectedRevision:revision})});};
  if(!version.materialUses?.length&&(!allowed||stop))return null;
  return <Card><CardHeader title={uiText('本版辅料')} tools={allowed?<Button size="sm" disabled={!!stop} title={stop?uiText(stop):undefined} onClick={()=>write()}>{uiText('选用辅料')}</Button>:undefined}/>
    <GarmentMaterialRows rows={version.materialUses||[]} edit={allowed&&!stop?write:undefined} remove={allowed&&!stop?remove:undefined}/>
    <ModuleEditorDialog spec={editor} onClose={()=>setEditor(null)}/>
  </Card>;
}
