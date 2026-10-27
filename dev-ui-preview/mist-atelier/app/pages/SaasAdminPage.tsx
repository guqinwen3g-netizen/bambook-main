import { interfaceLocale } from '../../../../services/interfaceLanguage';
import { uiText, ui } from '../../../../services/interfaceLanguage';
import React from 'react';
import { Building2, Plus, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { Banner, Button, Card, CardHeader, DataTable, Dialog, Drawer, EmptyState, Field, FormGrid, KeyValue, MistPage, Mono, PageHeader, Pill, Select, StatCard, StatGrid, TextInput, Toolbar } from '../../../../components/mist';
import { useNav } from '../nav';
import { useMistSession } from '../runtime/auth';
import { enterCompanyManagement, platformAdminApi, type Invitation, type PlatformCompany, type PlatformMember } from '../runtime/platformAdmin';
const statuses=[{value:'active',label:'运行中'},{value:'suspended',label:'已暂停'},{value:'closed',label:'已关闭'}];
const statusLabel=(value:string)=>statuses.find(s=>s.value===value)?.label??value;
const message=(e:unknown)=>e instanceof Error?e.message:'操作未完成，请重试。';
const blank={name:'',slug:'',ownerName:'',ownerEmail:''};
/** 注册待审批的账号与成员都是 pending，不能算作停用。 */
export function memberState(m:{accountStatus?:string;memberStatus?:string}):{label:string;tone:'ok'|'warn'|'neutral'|'bad'}{
  if(m.accountStatus==='rejected')return {label:'已拒绝',tone:'bad'};
  if(m.accountStatus==='pending'||m.memberStatus==='pending')return {label:'待审批',tone:'warn'};
  if(m.accountStatus&&m.accountStatus!=='active')return {label:'账号停用',tone:'neutral'};
  return m.memberStatus==='active'?{label:'在公司',tone:'ok'}:m.memberStatus==='left'?{label:'已退出',tone:'neutral'}:{label:'已暂停',tone:'neutral'};
}
export function SaasAdminPage(){
 const nav=useNav();
 const session=useMistSession(),allowed=session.user?.platformRole==='platform_admin';
 const [companies,setCompanies]=React.useState<PlatformCompany[]>([]),[loading,setLoading]=React.useState(true),[error,setError]=React.useState('');
 const [query,setQuery]=React.useState(''),[filter,setFilter]=React.useState('all'),[selected,setSelected]=React.useState<string|null>(nav?.route?.id??null);
 const [members,setMembers]=React.useState<PlatformMember[]>([]),[membersLoading,setMembersLoading]=React.useState(false),[memberEmail,setMemberEmail]=React.useState('');
 const [creating,setCreating]=React.useState(false),[draft,setDraft]=React.useState(blank),[busy,setBusy]=React.useState(false),[formError,setFormError]=React.useState('');
 const [edit,setEdit]=React.useState({status:'active',plan:'standard',seats:''});
 const [confirmation,setConfirmation]=React.useState<{kind:'status'|'member';member?:PlatformMember}|null>(null),[credentials,setCredentials]=React.useState<{email:string;invitation:Invitation}|null>(null);
 const identity=React.useRef(session.sessionKey);identity.current=session.sessionKey;
 const company=companies.find(c=>c.id===selected);
 const [legalName,setLegalName]=React.useState<string|undefined>(undefined);
 React.useEffect(()=>{setLegalName(undefined);if(!selected)return;const controller=new AbortController(),key=session.sessionKey;void platformAdminApi.companySettings(selected,controller.signal).then(({snapshot})=>{if(!controller.signal.aborted&&identity.current===key)setLegalName(snapshot.settings.companyProfile?.legalName);}).catch(()=>{});return()=>controller.abort();},[selected,session.sessionKey]);
 const reload=React.useCallback(async(signal?:AbortSignal)=>{if(!allowed)return;const key=session.sessionKey;setLoading(true);setError('');try{const result=await platformAdminApi.list(signal);if(!signal?.aborted&&identity.current===key)setCompanies(result.companies);}catch(e){if(!signal?.aborted&&identity.current===key)setError(message(e));}finally{if(!signal?.aborted&&identity.current===key)setLoading(false);}},[allowed,session.sessionKey]);
 React.useEffect(()=>{setSelected(nav?.route?.id??null);setCompanies([]);setCredentials(null);setCreating(false);const controller=new AbortController();void reload(controller.signal);return()=>controller.abort();},[reload]);
 React.useEffect(()=>{if(!company)return;setEdit({status:company.status,plan:company.plan,seats:company.seatLimit===null?'':String(company.seatLimit)});setFormError('');},[selected]);
 const selectedRef=React.useRef(selected);selectedRef.current=selected;
 const reloadMembers=React.useCallback(async(signal?:AbortSignal)=>{if(!selected)return;const key=session.sessionKey;setMembersLoading(true);try{const result=await platformAdminApi.members(selected,signal);if(!signal?.aborted&&identity.current===key)setMembers(selectedRef.current===selected?result.members:[]);}catch(e){if(!signal?.aborted&&identity.current===key)setFormError(message(e));}finally{if(!signal?.aborted&&identity.current===key)setMembersLoading(false);}},[selected,session.sessionKey]);
 React.useEffect(()=>{setMembers([]);setMemberEmail('');const controller=new AbortController();void reloadMembers(controller.signal);return()=>controller.abort();},[reloadMembers]);
 async function mutate(work:()=>Promise<void>){const key=session.sessionKey;setBusy(true);setFormError('');try{await work();}catch(e){if(identity.current===key)setFormError(message(e));}finally{if(identity.current===key)setBusy(false);}}
 async function create(){if(!draft.name.trim()||!draft.ownerName.trim()||!/^\S+@\S+\.\S+$/.test(draft.ownerEmail)||! /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(draft.slug)){setFormError('请填写公司名称、3–50 位公司标识、负责人姓名和有效邮箱。');return;}
  await mutate(async()=>{const key=session.sessionKey;const result=await platformAdminApi.create(draft);if(identity.current!==key)return;setCreating(false);setDraft(blank);await reload();setSelected(result.company.id);setCredentials({email:result.owner.email,invitation:result.invitation});});
 }
 async function save(){if(edit.seats!==''&&(!/^\d+$/.test(edit.seats)||Number(edit.seats)<1)){setFormError('席位上限须为正整数，留空表示不限。');return;}if(!edit.plan.trim()){setFormError('请填写服务方案。');return;}if(company&&edit.status!==company.status&&edit.status!=='active'){setConfirmation({kind:'status'});return;}await persist();}
 async function persist(){if(!company)return;const id=company.id;await mutate(async()=>{await platformAdminApi.update(id,{status:edit.status,plan:edit.plan.trim(),seatLimit:edit.seats===''?null:Number(edit.seats)});setConfirmation(null);await reload();});}
 const visible=companies.filter(c=>(filter==='all'||c.status===filter)&&`${c.name} ${c.slug} ${c.legalName??''}`.toLowerCase().includes(query.toLowerCase()));
 if(!allowed)return <MistPage><EmptyState icon={ShieldCheck} title={uiText("需要平台管理员身份")}/></MistPage>;
 return <MistPage width="wide"><PageHeader eyebrow={uiText("平台运营")} title={uiText("平台管理")} actions={<><Button onClick={()=>nav?.go('system-settings')}>{uiText("平台设置")}</Button><Button variant="primary" icon={Plus} onClick={()=>{setFormError('');setDraft(blank);setCreating(true);}}>{uiText("开通公司")}</Button></>}/>
  <StatGrid><StatCard icon={Building2} label={uiText("公司")} value={companies.length}/><StatCard icon={ShieldCheck} label={uiText("运行中")} value={companies.filter(c=>c.status==='active').length}/><StatCard icon={Users} label={uiText("有效成员归属")} value={companies.reduce((n,c)=>n+c.members,0)}/></StatGrid>
  <Toolbar right={<Button icon={RefreshCw} loading={loading} onClick={()=>void reload()}>{uiText("刷新")}</Button>}><TextInput aria-label={uiText("搜索公司")} placeholder={uiText("搜索公司名称或标识")} value={query} onChange={e=>setQuery(e.target.value)}/><Select aria-label={uiText("公司状态")} value={filter} onChange={e=>setFilter(e.target.value)} options={[{value:'all',label:'全部状态'},...statuses]}/></Toolbar>
  {error&&<Banner tone="bad" title={uiText("读取公司失败")}>{uiText(error)}</Banner>}
  <Card><DataTable ariaLabel={uiText("公司列表")} rows={visible} rowKey={c=>c.id} loading={loading} selectedKey={selected} onRowClick={c=>setSelected(c.id)} columns={[{key:'name',header:'公司',render:c=><><b>{c.name}</b><div className="mist-caption"><Mono>{c.slug}</Mono></div></>},{key:'status',header:'状态',render:c=><Pill tone={c.status==='active'?'ok':c.status==='suspended'?'warn':'neutral'}>{statusLabel(c.status)}</Pill>},{key:'plan',header:'服务方案',render:c=>c.plan==='standard'?'标准服务':c.plan},{key:'members',header:'成员 / 席位',render:c=>`${c.members} / ${c.seatLimit??'不限'}`},{key:'action',header:'',render:c=><Button size="sm" onClick={()=>setSelected(c.id)} aria-label={uiText('管理'+c.name)}>{uiText("管理")}</Button>}]} empty={<EmptyState title={uiText(query||filter!=='all'?'没有匹配的公司':'尚未开通公司')} description={uiText(query||filter!=='all'?'调整搜索条件后重试。':'开通公司后，在这里管理成员归属与服务状态。')}/>}/></Card>
  <Drawer open={!!company} onClose={()=>{if(!busy)setSelected(null);}} title={uiText(company?.name??'公司管理')} sub={uiText(company?.slug)} size="lg">
   {company&&<div className="mist-col">{formError&&<Banner tone="bad" title={uiText("操作未完成")}>{formError}</Banner>}
    <KeyValue items={[{label:'法定名称',value:legalName||company.legalName||'尚未填写'},{label:'开通日期',value:new Date(company.createdAt).toLocaleDateString(interfaceLocale())}]}/>
    <Card><CardHeader title={uiText("公司后台")}/><div className="mist-card-body"><Button variant="primary" icon={ShieldCheck} loading={busy} onClick={()=>void mutate(async()=>{await enterCompanyManagement(company.id);nav?.go('admin-panel');})}>{uiText("进入公司后台")}</Button></div></Card>
    <Card><CardHeader title={uiText("服务设置")}/><div className="mist-card-body"><FormGrid cols={2}><Field label={uiText("状态")}><Select aria-label={uiText("服务状态")} value={edit.status} onChange={e=>setEdit({...edit,status:e.target.value})} options={statuses}/></Field><Field label={uiText("服务方案")}><TextInput value={edit.plan} onChange={e=>setEdit({...edit,plan:e.target.value})}/></Field><Field label={uiText("席位上限")} hint={uiText("留空表示不限；按有效公司成员计数。")}><TextInput type="number" min={1} value={edit.seats} onChange={e=>setEdit({...edit,seats:e.target.value})}/></Field></FormGrid><Button loading={busy} onClick={()=>void save()}>{uiText("保存服务设置")}</Button></div></Card>
    <Card><CardHeader title={uiText("公司成员")} tools={<Button size="sm" icon={RefreshCw} loading={membersLoading} onClick={()=>void reloadMembers()}>{uiText("刷新成员")}</Button>}/><div className="mist-card-body"><FormGrid cols={2}><TextInput aria-label={uiText("添加成员邮箱")} placeholder={uiText("已有账号邮箱")} value={memberEmail} onChange={e=>setMemberEmail(e.target.value)}/><Button disabled={!memberEmail.trim()} loading={busy} onClick={()=>void mutate(async()=>{await platformAdminApi.addMember(company.id,memberEmail.trim());setMemberEmail('');await reloadMembers();await reload();})}>{uiText("加入公司")}</Button></FormGrid></div>
     <DataTable ariaLabel={uiText("公司成员")} rows={members} rowKey={m=>m.userId} loading={membersLoading} columns={[{key:'name',header:'成员',render:m=><>{m.displayName}<div className="mist-caption">{m.email}</div></>},{key:'state',header:'归属状态',render:m=>{const state=memberState(m);return <Pill tone={state.tone}>{uiText(state.label)}</Pill>;}},{key:'mail',header:'邀请邮件',render:m=>m.memberStatus==='active'?<Button size="sm" disabled={busy} onClick={()=>void mutate(async()=>{const r=await platformAdminApi.resendMember(company.id,m.userId);setCredentials({email:m.email,invitation:r.invitation});})}>{uiText("重发邀请")}</Button>:null},{key:'action',header:'',render:m=>m.memberStatus==='active'?<Button size="sm" variant="quiet" disabled={busy} onClick={()=>setConfirmation({kind:'member',member:m})} aria-label={uiText('移出'+m.displayName)}>{uiText("移出公司")}</Button>:<Button size="sm" disabled={busy} onClick={()=>void mutate(async()=>{await platformAdminApi.addMember(company.id,m.email);await reloadMembers();await reload();})}>{uiText("恢复归属")}</Button>}]} empty={<EmptyState title={uiText("暂无成员")} compact/>}/>
    </Card></div>}
  </Drawer>
  <Dialog open={creating} onClose={()=>{if(!busy)setCreating(false);}} title={uiText("开通公司")} description={uiText("建立独立公司，并为负责人配置公司管理员权限。会向负责人发送账号邀请邮件。")} footer={<><Button disabled={busy} onClick={()=>setCreating(false)}>{uiText("取消")}</Button><Button variant="primary" loading={busy} onClick={()=>void create()}>{uiText("确认开通")}</Button></>}>
   {formError&&<Banner tone="bad" title={uiText("未开通")}>{formError}</Banner>}<FormGrid cols={2}>
    <Field label={uiText("公司名称")} required><TextInput aria-label={uiText("公司名称")} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></Field>
    <Field label={uiText("公司标识")} required hint={uiText("3–50 位小写字母、数字或连字符。")}><TextInput aria-label={uiText("公司标识")} value={draft.slug} onChange={e=>setDraft({...draft,slug:e.target.value})}/></Field>
    <Field label={uiText("负责人姓名")} required><TextInput aria-label={uiText("负责人姓名")} value={draft.ownerName} onChange={e=>setDraft({...draft,ownerName:e.target.value})}/></Field>
    <Field label={uiText("负责人邮箱")} required><TextInput aria-label={uiText("负责人邮箱")} type="email" value={draft.ownerEmail} onChange={e=>setDraft({...draft,ownerEmail:e.target.value})}/></Field>
   </FormGrid>
  </Dialog>
  <Dialog open={!!confirmation} onClose={()=>{if(!busy)setConfirmation(null);}} title={uiText(confirmation?.kind==='member'?'移出公司':'更改公司状态')} tone="warn" description={uiText(confirmation?.kind==='member'?`确认将 ${confirmation.member?.displayName} 移出 ${company?.name}？其现有公司访问将立即失效。`:`确认将 ${company?.name} 设为${statusLabel(edit.status)}？该公司的现有访问将立即失效。`)} footer={<><Button disabled={busy} onClick={()=>setConfirmation(null)}>{uiText("取消")}</Button><Button variant="danger" loading={busy} onClick={()=>{if(confirmation?.kind==='status')void persist();else if(company&&confirmation?.member)void mutate(async()=>{await platformAdminApi.removeMember(company.id,confirmation.member!.userId);setConfirmation(null);await reloadMembers();await reload();});}}>{uiText("确认")}</Button></>}/>
  <Dialog open={!!credentials} onClose={()=>setCredentials(null)} title={uiText("公司账号邀请")} description={uiText(credentials?.invitation.message)} footer={<Button onClick={()=>setCredentials(null)}>{uiText("关闭")}</Button>}><KeyValue items={[{label:'账号',value:credentials?.email??''},{label:'邮件状态',value:credentials?.invitation.status==='sent'?'已提交发送':'未确认发送，请检查后重发'}]}/></Dialog>
 </MistPage>;
}
