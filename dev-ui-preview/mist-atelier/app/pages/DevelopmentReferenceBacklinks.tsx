import React from 'react';
import {uiText} from '../../../../services/interfaceLanguage';
import {Mono,Pill,TextLink} from '../../../../components/mist';
import type {MistState} from '../../../../server/src/shared/mistWorkspace';
import {useNav} from '../nav';
import {DetailBlock} from './modules/pageKit';
/** Read only current visible relationships. This never changes the specimen's original source or grants an upstream read. */
export function DevelopmentReferenceBacklinks({state,sampleIds}:{state:MistState;sampleIds:string[]}){
 const {go}=useNav(),visible=new Set(state.fulfillment.samples.filter(s=>sampleIds.includes(s.id)).map(s=>s.id)),links=state.devs.flatMap(dev=>(dev.sampleReferences||[]).filter(ref=>visible.has(ref.sampleId)&&!!ref.snapshots?.length).map(ref=>({dev,ref,sample:state.fulfillment.samples.find(s=>s.id===ref.sampleId)!})));
 if(!links.length)return null;
 return <DetailBlock title={uiText('参考开发案')}><div className="mist-col">{links.map(({dev,ref,sample})=><div className="mist-row" key={dev.id+':'+ref.id}><TextLink aria-label={uiText('打开参考开发案 '+dev.code)} onClick={()=>go('development/detail',dev.id,{section:'reference:'+ref.id})}><Mono>{dev.code}</Mono> · {dev.name}</TextLink>{sampleIds.length>1&&<Mono>{sample.code}</Mono>}{ref.withdrawn&&<Pill>{uiText('已撤回')}</Pill>}</div>)}</div></DetailBlock>;
}
