import React from 'react';
import { RefreshCw } from 'lucide-react';
import { Banner, Button, DataTable, Dialog, EmptyState, Facts, Field, Mono, Pill, Select, Skeleton } from '../../../../components/mist';
import { DetailBlock } from './modules/pageKit';
import { uiText, interfaceLocale } from '../../../../services/interfaceLanguage';
import { useMistSession } from '../runtime/auth';
import { mistApiRequest, useMistWorkspace } from '../runtime/workspace';
import {useNav} from '../nav';
import {workspaceMembers} from '../runtime/members';
import { AGENT_AUDIT_FIELD_LABELS, agentAuditActionLabel, type AgentAuditDetail, type AgentAuditEntry, type AgentAuditPage } from '../../../../server/src/shared/mistAgentAudit';

const when=(at:string)=>new Date(at).toLocaleString(interfaceLocale(),{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const source=(r:AgentAuditEntry)=>r.source==='human_confirmation'?'人工确认':r.source==='human_rejection'?'人工拒绝':r.phase==='proposed'?'Agent 提议':'Agent 办理';
const action=(r:AgentAuditEntry)=>agentAuditActionLabel(r.requestedCommandType,interfaceLocale());
const states:Record<string,string>={pending:'待处理',confirmed:'已确认',returned:'已退回',reversed:'已冲回',cancelled:'已撤销',approved:'已批准',rejected:'已拒绝',draft:'草稿',active:'在用',closed:'已关闭',garment:'成衣',fabric:'面料'};
const settlementStates:Record<string,string>={pending:'待财务复核',confirmed:'已确认',returned:'已退回',reversed:'已冲回',cancelled:'已撤销'};
const kinds:Record<string,string>={garment:'成衣',fabric:'面料',finished:'成品采购',material:'材料采购',process:'加工服务'};
const pairedNames:Record<string,string>={actorId:'actor',ownerId:'owner',supplierId:'supplier',customerId:'customer',submitterId:'submittedBy',createdById:'createdBy'};
const domainOf=(path:string[])=>{const index=path.findIndex(p=>p.startsWith('i:'));return(index<0?path:path.slice(0,index)).map(p=>p.slice(2)).join('.');};
const uuid=(v:string)=>/^(?:usr_)?[0-9a-f-]{32,}$/i.test(v);
const referenceFields=new Set(['id','ownerId','supplierId','customerId','orderId','orderLineId','lineId','purchaseId','receiptIds','receiptId','settlementId','billId','invoiceId','accountId','actorId','reviewerId','createdById','productionId','taskId','targetId','fileIds','fileId','contactId','submitterId']);
const monetaryFields=new Set(['amount','taxAmount','localAmount','foreignAmount','unitPrice','price','balance','fee','deduction','prepaymentApplied','suggestedPrepayment']);
function AuditValue({value,references,field='',domain='',restricted=false}:{value:unknown;references:Record<string,string>;field?:string;domain?:string;restricted?:boolean}){
  if(value===undefined)return <span className="mist-note">{uiText(restricted?'受当前权限限制':'未设置')}</span>;
  if(restricted)return <div className="mist-col"><span className="mist-note">{uiText('部分可见')}</span><AuditValue value={value} references={references} field={field} domain={domain}/></div>;
  if(value===null)return <span className="mist-note">{uiText('空')}</span>;
  if(typeof value==='boolean')return <>{uiText(value?'是':'否')}</>;
  if(typeof value==='number')return <>{value.toLocaleString(interfaceLocale(),{minimumFractionDigits:monetaryFields.has(field)?2:0,maximumFractionDigits:20})}</>;
  if(typeof value==='string'){
    if(!value)return <span className="mist-note">{uiText('无')}</span>;
    const state=['state','status'].includes(field)?(domain==='payables.settlements'?settlementStates[value]??states[value]:states[value]):['type','kind'].includes(field)?kinds[value]:undefined;
    return <>{value==='[redacted]'||value==='[inline binary redacted]'?uiText('已隐藏敏感内容'):references[value]??(referenceFields.has(field)&&uuid(value)?uiText('关联记录'):state?uiText(state):/(?:At|^at)$/.test(field)&&Number.isFinite(Date.parse(value))?when(value):value)}</>;
  }
  if(Array.isArray(value))return <div className="mist-col">{value.length?value.map((v,index)=><div key={index}><AuditValue value={v} references={references} field={field} domain={domain}/></div>):<span className="mist-note">{uiText('无')}</span>}</div>;
  if(field==='target'&&typeof(value as any).view==='string'&&typeof(value as any).id==='string')return <>{references[(value as any).id]??uiText('关联记录')}</>;
  const record=value as Record<string,unknown>;
  const entries=Object.entries(record).filter(([k])=>k!=='id'&&!(pairedNames[k]&&typeof record[pairedNames[k]]==='string'&&record[pairedNames[k]]));
  if(!entries.length){const id=(value as any).id;return <span className="mist-note">{typeof id==='string'&&references[id]?references[id]:uiText('关联记录')}</span>;}
  return <Facts items={entries.map(([key,v])=>({label:uiText(AGENT_AUDIT_FIELD_LABELS[key]??'补充信息'),value:<AuditValue value={v} references={references} field={key} domain={domain}/>}))}/>;
}

export function AgentAuditHistory(){
  const session=useMistSession(),w=useMistWorkspace();
  if(!w.workspace?.id)return <EmptyState title={uiText('尚未进入公司')}/>;
  const identity=JSON.stringify([session.sessionKey,session.user?.id,w.workspace.id]);
  return <AuditHistoryView key={identity} workspaceId={w.workspace.id} members={workspaceMembers(w.workspace,w.state,session.user)}/>;
}
export function AuditHistoryView({workspaceId,members=[]}:{workspaceId:string;members?:Array<{id:string;name:string}>}){
  const nav=useNav();
  const [scope,setScope]=React.useState('mine'),[phase,setPhase]=React.useState(''),[person,setPerson]=React.useState('');
  const [related,setRelated]=React.useState<{key:'proposalId'|'agentSessionId';value:string}|null>(null),[detailReload,setDetailReload]=React.useState(0);
  const [items,setItems]=React.useState<AgentAuditEntry[]>([]),[cursor,setCursor]=React.useState<string|null>(null),[canCompany,setCanCompany]=React.useState(false),[loading,setLoading]=React.useState(true),[failure,setFailure]=React.useState('');
  const [unavailable,setUnavailable]=React.useState(0);
  const [selected,setSelected]=React.useState<AgentAuditEntry|null>(null),[detail,setDetail]=React.useState<AgentAuditDetail|null>(null),[offset,setOffset]=React.useState(0),[detailBusy,setDetailBusy]=React.useState(false),[detailError,setDetailError]=React.useState('');
  const [showInput,setShowInput]=React.useState(false),inputRequested=React.useRef(false);
  const listSeq=React.useRef(0),detailSeq=React.useRef(0),listAbort=React.useRef<AbortController|null>(null),detailAbort=React.useRef<AbortController|null>(null);
  const currentDetail=React.useRef(detail);currentDetail.current=detail;
  const base='/api/mist/workspaces/'+encodeURIComponent(workspaceId)+'/agent-audits';
  const load=React.useCallback(async(more:string|null=null)=>{
    const serial=++listSeq.current;listAbort.current?.abort();const controller=new AbortController();listAbort.current=controller;
    setLoading(true);setFailure('');if(!more){setItems([]);setCursor(null);setSelected(null);setDetail(null);setUnavailable(0);}
    const query=new URLSearchParams({scope,limit:'20',...(phase?{phase}:{}),...(related?{[related.key]:related.value}:{}),...(scope==='company'&&person?{actorId:person}:{}),...(more?{cursor:more}:{})});
    try{const page:AgentAuditPage=await mistApiRequest(base+'?'+query,{signal:controller.signal});if(serial!==listSeq.current)return;setItems(old=>more?[...old,...page.items.filter(item=>!old.some(r=>r.requestId===item.requestId))]:page.items);setCursor(page.nextCursor);setCanCompany(page.canReadCompany);setUnavailable(old=>(more?old:0)+(page.unavailableCount??0));}
    catch(error){if(serial!==listSeq.current||controller.signal.aborted)return;setFailure(error instanceof Error?error.message:'读取失败');if([401,403,404].includes((error as any)?.status)){setItems([]);setSelected(null);setDetail(null);if((error as any)?.status===403)setCanCompany(false);}}
    finally{if(serial===listSeq.current)setLoading(false);}
  },[base,scope,phase,person,related]);
  React.useEffect(()=>{void load();return()=>{listSeq.current++;listAbort.current?.abort();};},[load]);
  React.useEffect(()=>()=>{detailSeq.current++;detailAbort.current?.abort();},[]);
  React.useEffect(()=>{
    detailSeq.current++;detailAbort.current?.abort();if(!selected){setDetail(null);setDetailError('');return;}
    const serial=detailSeq.current,controller=new AbortController(),includeCommand=inputRequested.current&&!offset;detailAbort.current=controller;setDetailBusy(true);setDetailError('');if(!offset&&!includeCommand)setDetail(null);
    void mistApiRequest(base+'/'+encodeURIComponent(selected.requestId)+'?'+new URLSearchParams({offset:String(offset),limit:'25',...(includeCommand?{includeCommand:'true'}:{})}),{signal:controller.signal}).then((result:AgentAuditDetail)=>{
      if(serial!==detailSeq.current)return;
      const prior=currentDetail.current;
      if(offset&&prior&&prior.accessKey!==result.accessKey){setDetail(null);setShowInput(false);setDetailError('可见范围已更新，请重新读取');return;}
      setDetail(offset&&prior?{...result,command:prior.command,changes:[...prior.changes,...result.changes],references:{...prior.references,...result.references}}:result);
      if(!offset){setShowInput(includeCommand&&!!result.command.payload);inputRequested.current=false;}
    }).catch(error=>{if(serial!==detailSeq.current||controller.signal.aborted)return;setDetail(null);const message=error instanceof Error?error.message:'读取失败';if([401,403,404].includes((error as any)?.status)){setItems([]);setCursor(null);setSelected(null);setCanCompany(false);setFailure(message);}else setDetailError(message);}).finally(()=>{if(serial===detailSeq.current)setDetailBusy(false);});
    return()=>{detailSeq.current++;controller.abort();};
  },[base,selected?.requestId,offset,detailReload]);
  const people=new Map(members.map(m=>[m.id,m.name]));items.forEach(r=>{if(!people.has(r.actor.id))people.set(r.actor.id,r.actor.name);});
  const nameCounts=new Map<string,number>();for(const name of people.values())nameCounts.set(name,(nameCounts.get(name)??0)+1);
  const personLabel=(id:string,name:string)=>{const label=uuid(name)?uiText('未命名账号'):name;return (nameCounts.get(name)??0)>1?`${label} · ${id.slice(-4)}`:label;};
  const open=(row:AgentAuditEntry)=>{inputRequested.current=false;setShowInput(false);setOffset(0);setDetail(null);setDetailError('');setSelected(row);};
  const openTarget=(target:AgentAuditDetail['targets'][number])=>{setSelected(null);if(target.section)nav?.go(target.view,target.id,{section:target.section});else nav?.go(target.view,target.id);};
  return <div className="mist-col">
    <div className="mist-row" data-wrap>
      <Field label={uiText('范围')}><Select aria-label={uiText('操作记录范围')} value={scope} onChange={e=>{setPerson('');setScope(e.target.value);}} options={[{value:'mine',label:uiText('本人操作')},...(canCompany||scope==='company'?[{value:'company',label:uiText('公司操作')}]:[])]}/></Field>
      <Field label={uiText('操作类型')}><Select aria-label={uiText('操作类型')} value={phase} onChange={e=>setPhase(e.target.value)} options={[{value:'',label:uiText('全部')},{value:'executed',label:uiText('Agent 办理')},{value:'proposed',label:uiText('提交提议')},{value:'confirmed',label:uiText('人工确认')},{value:'rejected',label:uiText('人工拒绝')}]}/></Field>
      {scope==='company'&&<Field label={uiText('经办人')}><Select aria-label={uiText('经办人')} value={person} onChange={e=>setPerson(e.target.value)} options={[{value:'',label:uiText('全部经办人')},...[...people].map(([value,label])=>({value,label:personLabel(value,label)}))]}/></Field>}
      <Button icon={RefreshCw} disabled={loading} onClick={()=>void load()}>{uiText('刷新')}</Button>
      {related&&<><Pill>{uiText(related.key==='proposalId'?'同一提议':'同一会话')}</Pill><Button onClick={()=>setRelated(null)}>{uiText('清除关联')}</Button></>}
    </div>
    {failure&&<Banner tone="bad" title={uiText('操作记录读取失败')}>{uiText(failure)} <Button onClick={()=>scope==='company'&&!canCompany?setScope('mine'):void load()}>{uiText(scope==='company'&&!canCompany?'查看本人':'重试')}</Button></Banner>}
    {unavailable>0&&<Banner tone="warn" title={uiText('有操作记录暂不可读取')}/>}
    <DataTable ariaLabel={uiText('Agent 操作记录')} loading={loading&&!items.length} rows={items} rowKey={r=>r.requestId} onRowClick={open} minWidth={300} columns={[
      {key:'action',header:uiText('操作'),width:'minmax(170px,2fr)',render:r=><div><div>{action(r)}</div><span className="mist-note">{uuid(r.actor.name)?uiText('未命名账号'):r.actor.name} · {when(r.at)}</span></div>},
      {key:'source',header:uiText('来源'),width:'110px',render:r=><Pill>{uiText(source(r))}</Pill>},
    ]} empty={<EmptyState title={uiText(unavailable?'记录暂不可用':phase||person||related?'没有符合条件的操作':'暂无 Agent 操作记录')} action={phase||person||related?<Button onClick={()=>{setPhase('');setPerson('');setRelated(null);}}>{uiText('清除筛选')}</Button>:undefined}/>} footer={cursor?<Button disabled={loading} loading={loading} onClick={()=>void load(cursor)}>{uiText('加载更多')}</Button>:undefined}/>
    <Dialog open={!!selected} onClose={()=>setSelected(null)} title={selected?action(selected):uiText('操作详情')} width={860} footer={<><Button onClick={()=>setSelected(null)}>{uiText('关闭')}</Button>{detail?.nextOffset!==null&&detail?.nextOffset!==undefined&&<Button loading={detailBusy} onClick={()=>setOffset(detail.nextOffset!)}>{uiText('更多变更')}</Button>}{detail?.targets?.[0]&&<Button variant="primary" disabled={!nav||detailBusy} onClick={()=>openTarget(detail.targets[0])}>{uiText('打开原单')}</Button>}</>}>
      <div className="mist-col">
        {selected&&<div className="mist-row" data-wrap>{detail?.targets?.[0]&&<Mono>{detail.targets[0].label}</Mono>}<span>{uuid(selected.actor.name)?uiText('未命名账号'):selected.actor.name}</span><Pill>{uiText(source(selected))}</Pill><span className="mist-note">{when(selected.at)}</span></div>}
        {detailError&&<Banner tone="bad" title={uiText('操作详情读取失败')}>{uiText(detailError)} <Button onClick={()=>{setOffset(0);setDetailReload(v=>v+1);}}>{uiText('重新读取')}</Button></Banner>}
        {detailBusy&&!detail&&<Skeleton height={80}/>}
        {detail&&(detail.detailsRestricted||detail.commandRestricted)&&<Banner tone="warn" title={uiText('部分明细受当前权限限制')}/>}
        {detail&&<section aria-label={uiText('实际变更')} className="mist-col">{detail.changes.length?detail.changes.map(c=>{
          const names=c.path.filter(p=>p.startsWith('i:')).map(p=>detail.references[p.slice(2)]).filter(Boolean);
          const values=[
            {label:uiText('修改前'),value:<AuditValue value={c.before} references={detail.references} field={c.path[c.path.length-1]?.slice(2)} domain={domainOf(c.path)} restricted={c.beforeRestricted}/>},
            {label:uiText('修改后'),value:<AuditValue value={c.after} references={detail.references} field={c.path[c.path.length-1]?.slice(2)} domain={domainOf(c.path)} restricted={c.afterRestricted}/>},
          ];
          const structured=[c.before,c.after].some(value=>value!==null&&typeof value==='object');
          return <DetailBlock key={JSON.stringify(c.path)} title={[...names,uiText(c.label)].join(' · ')}>{structured?<div className="mist-col">{values.map(item=><DetailBlock key={item.label} title={item.label}>{item.value}</DetailBlock>)}</div>:<Facts items={values}/>}</DetailBlock>;
        }):<EmptyState title={uiText(detail.detailsRestricted?'当前权限下没有可显示的变更':detail.phase==='proposed'?'此次仅提交提议':'未改变业务内容')}/>}</section>}
        {selected&&<div className="mist-row" data-wrap>{detail&&<Button disabled={!(detail.commandAvailable??!detail.commandRestricted)||detailBusy} onClick={()=>{if(showInput)setShowInput(false);else{inputRequested.current=true;setShowInput(false);setOffset(0);setDetailReload(v=>v+1);}}}>{uiText(showInput?'隐藏原始填写':'原始填写')}</Button>}{selected.proposalId&&<Button onClick={()=>{setPhase('');setPerson('');setRelated({key:'proposalId',value:selected.proposalId!});setSelected(null);}}>{uiText('同一提议的操作')}</Button>}{selected.agentSessionId&&<Button onClick={()=>{setPhase('');setPerson('');setRelated({key:'agentSessionId',value:selected.agentSessionId!});setSelected(null);}}>{uiText('同一会话的操作')}</Button>}</div>}
        {detail&&showInput&&detail.command.payload&&<DetailBlock title={uiText('原始填写')}><AuditValue value={detail.command.type==='agent.proposal.create'?(detail.command.payload.command as any)?.payload:detail.command.payload} references={detail.references} restricted={detail.commandRestricted}/></DetailBlock>}
        {detail&&detail.targets?.length>1&&<DetailBlock title={uiText('相关来源')}><div className="mist-row" data-wrap>{detail.targets.slice(1).map(target=><Button key={target.view+':'+target.id} disabled={!nav} onClick={()=>openTarget(target)}>{target.label}</Button>)}</div></DetailBlock>}
      </div>
    </Dialog>
  </div>;
}
