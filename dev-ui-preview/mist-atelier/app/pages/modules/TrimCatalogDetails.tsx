import React from 'react';
import {Button,CardHeader,KeyValue} from '../../../../../components/mist';
import {uiText} from '../../../../../services/interfaceLanguage';
import {TRIMMING_CATEGORIES,trimmingParameterFields,type TrimmingCategory} from '../../../../../server/src/_shared/trimmingFields';
import type {MarketProduct} from '../../../../../server/src/shared/mistMarket';
import {useMistWorkspace} from '../../runtime/workspace';
import {useMistSession} from '../../runtime/auth';
import {ModuleEditorDialog,type ModuleEditorSpec} from './ModuleWorkbench';

export function TrimCatalogDetails({product}:{product:MarketProduct}){
  const workspace=useMistWorkspace(),session=useMistSession(),profile=product.trimProfile;
  const [editor,setEditor]=React.useState<ModuleEditorSpec|null>(null);
  const relations=workspace.state?.market?.relations||[],canSeeMaker=session.hasPermission('relations:read');
  const maker=profile?.manufacturerRelationId?relations.find(r=>r.id===profile.manufacturerRelationId):undefined;
  const edit=()=>{
    const revision=workspace.workspace?.revision;
    setEditor({title:'编辑辅料资料',submitLabel:'保存',
      initialValues:{category:profile?.category||'',manufacturer:maker?.id||'',
        ...Object.fromEntries(Object.entries(profile?.parameters||{}).map(([k,v])=>[profile!.category+'_'+k,v]))},
      fields:[
        {key:'category',label:'辅料分类',type:'select',required:true,options:[...TRIMMING_CATEGORIES]},
        ...(canSeeMaker?[{key:'manufacturer',label:'生产厂家',type:'select' as const,options:[{value:'',label:'未关联'},...relations.filter(r=>r.status==='active'||r.id===maker?.id).map(r=>({value:r.id,label:r.name}))]}]:[]),
        ...TRIMMING_CATEGORIES.flatMap(c=>trimmingParameterFields(c.value).map(f=>({key:c.value+'_'+f.key,label:f.label,when:{key:'category',values:[c.value]}}))),
      ],
      submit:values=>{
        const category=values.category as TrimmingCategory,parameters:Record<string,string>={};
        for(const f of trimmingParameterFields(category)){const v=String(values[category+'_'+f.key]||'').trim();if(v)parameters[f.key]=v;}
        const manufacturer=String(values.manufacturer||'');
        return workspace.run({type:'market.product.trimProfile.save',payload:{productId:product.id,category,parameters,
          ...(canSeeMaker&&manufacturer!==(maker?.id||'')?{manufacturerRelationId:manufacturer||null}:{})}},revision===undefined?undefined:{expectedRevision:revision});
      },
    });
  };
  const items=profile?[{label:'辅料分类',value:TRIMMING_CATEGORIES.find(c=>c.value===profile.category)?.label||profile.category},
    ...(maker?[{label:'生产厂家',value:maker.name}]:[]),
    ...trimmingParameterFields(profile.category).filter(f=>profile.parameters[f.key]).map(f=>({label:f.label,value:profile.parameters[f.key]}))]:[];
  return <section className="mist-product-section" aria-label={uiText('辅料资料')}><CardHeader title={uiText('辅料资料')} tools={session.hasPermission('products:write')&&product.status==='active'?<Button size="sm" onClick={edit}>{uiText('编辑辅料资料')}</Button>:undefined}/>
    {items.length>0&&<KeyValue items={items}/>}<ModuleEditorDialog spec={editor} onClose={()=>setEditor(null)}/>
  </section>;
}
