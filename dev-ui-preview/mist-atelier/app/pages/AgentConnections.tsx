import React from 'react';
import {Plus,RefreshCw,Copy} from 'lucide-react';
import {Banner,Button,DataTable,Dialog,EmptyState,Field,FormGrid,KeyValue,Pill,Select,TextInput,useToast} from '../../../../components/mist';
import {uiText,interfaceLocale} from '../../../../services/interfaceLanguage';
import {useMistSession} from '../runtime/auth';
import {mistApiRequest,useMistWorkspace} from '../runtime/workspace';
import type {AgentConnectionView,AgentConnectionPage} from '../../../../server/src/shared/mistAgentConnections';
const stamp=(at:string)=>new Date(at).toLocaleString(interfaceLocale(),{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
type Action={kind:'create';id:string;name:string;mode:'read'|'operate'}|{kind:'renew'|'revoke';row:AgentConnectionView;requestId:string};
type Issued={connection:AgentConnectionView;delegation:{token:string;expiresAt:string}};
export function AgentConnections(){const s=useMistSession(),w=useMistWorkspace();return w.workspace?<ConnectionList key={JSON.stringify([s.sessionKey,s.user?.id,w.workspace.id])} workspaceId={w.workspace.id}/>:<EmptyState title={uiText('尚未进入公司')}/>;}
export function ConnectionList({workspaceId}:{workspaceId:string}){
 const base='/api/mist/workspaces/'+encodeURIComponent(workspaceId)+'/agent-connections',toast=useToast();
 const [rows,setRows]=React.useState<AgentConnectionView[]>([]),[cursor,setCursor]=React.useState<string|null>(null),[canConnect,setCanConnect]=React.useState(false),[loading,setLoading]=React.useState(true),[error,setError]=React.useState('');
 const [action,setAction]=React.useState<Action|null>(null),[issued,setIssued]=React.useState<Issued|null>(null),[busy,setBusy]=React.useState(false),[failure,setFailure]=React.useState(''),[attempted,setAttempted]=React.useState(false),[clock,setClock]=React.useState(Date.now());
 const alive=React.useRef(true),sequence=React.useRef(0),operation=React.useRef(0),readAbort=React.useRef<AbortController|null>(null),writeAbort=React.useRef<AbortController|null>(null);
 const endpoint=new URL('/api/mist/mcp',location.origin).href;
 const load=React.useCallback(async(after:string|null=null)=>{const serial=++sequence.current;readAbort.current?.abort();const abort=new AbortController();readAbort.current=abort;setLoading(true);setError('');if(!after){setRows([]);setCursor(null);}
  try{const page:AgentConnectionPage=await mistApiRequest(base+(after?'?cursor='+encodeURIComponent(after):''),{signal:abort.signal});if(!alive.current||serial!==sequence.current)return;setRows(old=>after?[...old,...page.items.filter(item=>!old.some(r=>r.id===item.id))]:page.items);setCursor(page.nextCursor);setCanConnect(page.canConnect);}
  catch(e){if(!alive.current||abort.signal.aborted||serial!==sequence.current)return;setError(e instanceof Error?e.message:'连接读取失败');if([401,403,404].includes((e as any)?.status)){setRows([]);setCanConnect(false);setIssued(null);setAction(null);}}
  finally{if(alive.current&&serial===sequence.current)setLoading(false);}
 },[base]);
 React.useEffect(()=>{alive.current=true;void load();const timer=setInterval(()=>setClock(Date.now()),30_000);return()=>{alive.current=false;sequence.current++;operation.current++;readAbort.current?.abort();writeAbort.current?.abort();clearInterval(timer);};},[load]);
 const begin=(next:Action)=>{setFailure('');setAttempted(false);setAction(next);setIssued(null);};
 const close=()=>{operation.current++;writeAbort.current?.abort();setBusy(false);setAction(null);setFailure('');setIssued(null);if(attempted)void load();};
 const submit=async()=>{if(!action||busy)return;if(action.kind==='create'&&!action.name.trim()){setFailure('请填写连接名称');return;}const serial=++operation.current,abort=new AbortController();writeAbort.current=abort;setBusy(true);setFailure('');setAttempted(true);
  const tail=action.kind==='create'?'':'/'+encodeURIComponent(action.row.id)+'/'+action.kind;
  const body=action.kind==='create'?{id:action.id,name:action.name,mode:action.mode}:{requestId:action.requestId,...(action.kind==='renew'?{version:action.row.version}:{})};
  try{const result=await mistApiRequest(base+tail,{method:'POST',body:JSON.stringify(body),signal:abort.signal});if(!alive.current||serial!==operation.current)return;if(action.kind!=='revoke'&&(!result.delegation?.token||!result.connection))throw new Error('连接凭据响应无效');setAction(null);if(action.kind==='revoke'){setIssued(null);toast(uiText('连接已撤销'),'ok');}else setIssued(result);void load();}
  catch(e){if(!alive.current||abort.signal.aborted||serial!==operation.current)return;setFailure(e instanceof Error?e.message:'操作未完成，请重试');}
  finally{if(alive.current&&serial===operation.current)setBusy(false);}
 };
 const copy=async(config:boolean)=>{if(!issued||Date.parse(issued.delegation.expiresAt)<=Date.now())return;const text=config?JSON.stringify({mcpServers:{bambook:{url:endpoint,headers:{'x-bambook-delegation':issued.delegation.token}}}},null,2):issued.delegation.token;try{await navigator.clipboard.writeText(text);if(alive.current)toast(uiText('已复制'),'ok');}catch{if(alive.current)setFailure('复制失败，请重试');}};
 const expired=!!issued&&Date.parse(issued.delegation.expiresAt)<=clock;
 return <div className="mist-col">
  <div className="mist-row" data-wrap><Button icon={RefreshCw} disabled={loading} onClick={()=>void load()}>{uiText('刷新')}</Button>{canConnect&&<Button variant="primary" icon={Plus} onClick={()=>begin({kind:'create',id:crypto.randomUUID(),name:'',mode:'read'})}>{uiText('新建连接')}</Button>}</div>
  {error&&<Banner tone="bad" title={uiText('连接读取失败')}>{uiText(error)} <Button onClick={()=>void load()}>{uiText('重试')}</Button></Banner>}
  <DataTable ariaLabel={uiText('Agent 连接')} rows={rows} rowKey={r=>r.id} loading={loading&&!rows.length} minWidth={300} columns={[
   {key:'name',header:uiText('连接'),width:'minmax(120px,2fr)',render:r=>{const state=r.state==='active'&&Date.parse(r.expiresAt)<=clock?'expired':r.state;return <div><div className="mist-row" data-wrap><span>{r.name}</span><Pill tone={state==='active'?'ok':'neutral'}>{uiText(state==='active'?'有效':state==='expired'?'已过期':state==='invalid'?'已失效':'已撤销')}</Pill></div><span className="mist-note">{uiText(r.mode==='read'?'只读':'可办理')} · {uiText('到期')} {stamp(r.expiresAt)}</span></div>;}},
   {key:'actions',header:uiText('操作'),width:'130px',render:r=>r.state==='revoked'?null:<div className="mist-row" data-wrap>{canConnect&&<Button size="sm" onClick={()=>begin({kind:'renew',row:r,requestId:crypto.randomUUID()})}>{uiText('续签')}</Button>}<Button size="sm" onClick={()=>begin({kind:'revoke',row:r,requestId:crypto.randomUUID()})}>{uiText('撤销')}</Button></div>},
  ]} empty={<EmptyState title={uiText('暂无 Agent 连接')}/>} footer={cursor?<Button loading={loading} onClick={()=>void load(cursor)}>{uiText('加载更多')}</Button>:undefined}/>
  <Dialog open={!!action} onClose={close} title={uiText(action?.kind==='create'?'新建 Agent 连接':action?.kind==='renew'?'续签连接':'撤销连接')} description={action?.kind==='create'?undefined:uiText(action?.kind==='renew'?'旧凭据将立即失效。':'此连接将立即失效。')} footer={<><Button onClick={close}>{uiText('取消')}</Button><Button variant={action?.kind==='revoke'?'danger':'primary'} loading={busy} onClick={()=>void submit()}>{uiText(action?.kind==='create'?'创建连接':action?.kind==='renew'?'确认续签':'确认撤销')}</Button></>}>
   <div className="mist-col">{failure&&<Banner tone="bad" title={uiText(failure)}/>} {action?.kind==='create'?<><FormGrid cols={1}><Field label={uiText('连接名称')} required><TextInput aria-label={uiText('连接名称')} value={action.name} maxLength={60} disabled={attempted} onChange={e=>setAction({...action,name:e.target.value})}/></Field><Field label={uiText('权限')} required><Select aria-label={uiText('权限')} value={action.mode} disabled={attempted} onChange={e=>setAction({...action,mode:e.target.value as 'read'|'operate'})} options={[{value:'read',label:uiText('只读')},{value:'operate',label:uiText('可办理')}]}/></Field></FormGrid>{action.mode==='operate'&&<Banner tone="warn" title={uiText('审批、资金等操作仍须本人确认')}/>}</>:action&&<KeyValue items={[{label:uiText('连接名称'),value:action.row.name},{label:uiText('权限'),value:uiText(action.row.mode==='read'?'只读':'可办理')}]}/>}</div>
  </Dialog>
  <Dialog open={!!issued} onClose={()=>{setIssued(null);setFailure('');}} title={uiText('连接凭据')} footer={<><Button onClick={()=>{setIssued(null);setFailure('');}}>{uiText('关闭')}</Button><Button variant="primary" icon={Copy} disabled={expired} onClick={()=>void copy(true)}>{uiText('复制配置')}</Button></>}>
   {issued&&<div className="mist-col">{failure&&<Banner tone="bad" title={uiText(failure)}/>} {expired&&<Banner tone="warn" title={uiText('凭据已过期，请续签')}/>}<FormGrid cols={1}><Field label={uiText('连接地址')}><TextInput value={endpoint} readOnly/></Field><Field label={uiText('凭据')}><TextInput aria-label={uiText('连接凭据')} type="password" value={issued.delegation.token} readOnly autoComplete="off"/></Field></FormGrid><KeyValue items={[{label:uiText('连接名称'),value:issued.connection.name},{label:uiText('到期时间'),value:stamp(issued.delegation.expiresAt)}]}/><Button icon={Copy} disabled={expired} onClick={()=>void copy(false)}>{uiText('复制凭据')}</Button></div>}
  </Dialog>
 </div>;
}
