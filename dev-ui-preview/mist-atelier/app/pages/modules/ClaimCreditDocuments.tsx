import React from 'react';
import {Button,DataTable,Facts,Mono,Pill} from '../../../../../components/mist';
import {interfaceLocale,uiText} from '../../../../../services/interfaceLanguage';
import type {PlatformCredit} from '../../../../../server/src/shared/mistPlatform';
import {nextCreditPrintRevision,type CreditPrintCorrection,type MistCreditPrintVersion,type MistCreditSourceVersion} from '../../../../../server/src/shared/mistCreditDocuments';
import type {ModuleEditorSpec} from './ModuleWorkbench';
import {businessWhen,RecordDisclosure} from './pageKit';
type Props={credit:PlatformCredit;cancelled:boolean;read:boolean;write:boolean;busy:boolean;perform:(action:()=>Promise<unknown>)=>unknown;prepare:(creditId:string,sourceId:string)=>Promise<unknown>;issue:(creditId:string,sourceId:string,correction?:CreditPrintCorrection)=>Promise<unknown>;download:(creditId:string,printId:string)=>Promise<unknown>;openEditor:(spec:ModuleEditorSpec)=>void};
type Row={id:string;source:MistCreditSourceVersion;print?:MistCreditPrintVersion};
const money=(n:number,c:string)=>n.toLocaleString(interfaceLocale(),{minimumFractionDigits:2,maximumFractionDigits:2})+' '+c;
/** Business approval versions remain immutable. Each signed or corrected PDF has its own print revision. */
export function ClaimCreditDocuments({credit,cancelled,read,write,busy,perform,prepare,issue,download,openEditor}:Props){
 const prints=credit.printVersions??[],next=nextCreditPrintRevision(prints),latest=prints.reduce<MistCreditPrintVersion|undefined>((a,b)=>!a||b.version>a.version?b:a,undefined);
 const rows:Row[]=(credit.sourceVersions??[]).flatMap(source=>{const issued=prints.filter(p=>p.sourceVersionId===source.id);return issued.length?issued.map(print=>({id:print.id,source,print})):[{id:'draft:'+source.id,source}];});
 const correct=(row:Row)=>{const print=row.print!;openEditor({title:'更正文书',description:`${credit.code} · V${print.version} · ${money(print.snapshot.amount,print.snapshot.currency)}`,fields:[{key:'reason',label:'更正原因',type:'textarea',required:true}],initialValues:{reason:''},submitLabel:'签发更正件',submit:values=>issue(credit.id,row.source.id,{correctsPrintId:print.id,reason:String(values.reason??'').trim()})});};
 return <>
  <DataTable ariaLabel={uiText('贷项文书版本')} rows={rows} rowKey={row=>row.id} columns={[
   {key:'version',header:'版本',render:row=><Mono>{row.print?'V'+row.print.version:row.source.id===credit.currentVersionId?'V'+next:'—'}</Mono>},
   {key:'amount',header:'金额',align:'right',render:row=>money(row.print?.snapshot.amount??row.source.amount,row.print?.snapshot.currency??row.source.currency)},
   {key:'state',header:'状态',render:row=>row.print?(row.print.id===latest?.id&&row.source.id===credit.currentVersionId?<Pill tone="ok">{uiText('已签发')}</Pill>:<Pill>{uiText('历史版本')}</Pill>):<Pill>{uiText(row.source.id===credit.currentVersionId?'待签发':'未签发')}</Pill>},
   {key:'actions',header:'文档',render:row=>{const current=row.source.id===credit.currentVersionId,canCorrect=write&&!cancelled&&current&&!!row.print&&row.print.id===latest?.id;return <div className="mist-row">
    {read&&row.print&&<Button variant="quiet" disabled={busy} onClick={()=>void perform(()=>download(credit.id,row.print!.id))}>{uiText('下载正式 V')}{row.print.version}</Button>}
    {read&&!row.print&&current&&<Button variant="quiet" disabled={busy} onClick={()=>void perform(()=>prepare(credit.id,row.source.id))}>{uiText('预览草稿 V')}{next}</Button>}
    {write&&!cancelled&&!row.print&&current&&<Button variant="quiet" disabled={busy} onClick={()=>void perform(()=>issue(credit.id,row.source.id))}>{uiText('签发正式 V')}{next}</Button>}
    {canCorrect&&<><Button variant="quiet" disabled={busy} onClick={()=>void perform(()=>prepare(credit.id,row.source.id))}>{uiText('预览更正')}</Button><Button variant="quiet" disabled={busy} onClick={()=>correct(row)}>{uiText('更正文书')}</Button></>}
   </div>;}}
  ]}/>
  {prints.length>0&&<RecordDisclosure title={uiText('文书记录')}><div className="mist-col">{prints.map(print=><Facts key={print.id} items={[{label:'版本',value:'V'+print.version},{label:'签发人',value:print.issuedBy},{label:'签发时间',value:businessWhen(print.issuedAt)},...(print.snapshot.correction?[{label:'更正原因',value:print.snapshot.correction.reason}]:[])]}/>)}</div></RecordDisclosure>}
 </>;
}
