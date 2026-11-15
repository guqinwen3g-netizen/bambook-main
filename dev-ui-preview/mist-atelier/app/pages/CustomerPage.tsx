import {CUSTOMER_GRADE_SCOPE,CUSTOMER_CREDIT_SCOPE} from '../../../../server/src/shared/mistCustomerFieldAuthority';
import { CustomerList } from './CustomerList';
import { interfaceLocale } from '../../../../services/interfaceLanguage';
import { uiText, ui } from '../../../../services/interfaceLanguage';
import {businessNow} from '../runtime/businessClock';
/** T7 客户档案：原 Mist 构图，所有 Tab 读取同一客户的关联实体。 */
import { BaseDataImportButton } from './modules/BaseDataImport';
import React from 'react';
import { View } from '../../../../types';
import { BadgeDollarSign, CalendarClock, ClipboardList, Download, Ellipsis, Layers, Mail, Plus, Sparkles, TrendingUp, Wallet } from 'lucide-react';
import { Avatar, Banner, Button, Card, Checkbox, CardHeader, DataTable, Dialog, Drawer, EmptyState, Field, FormGrid, IconButton, IdentityHeader, KeyValue, MistPage, Mono, ObjectCell, PageHeader, Pill, Select, StageProgress, StatCard, StatGrid, Tabs, TextInput, Thumb, Timeline, useToast } from '../../../../components/mist';
import type { MistCommand, MistContact, MistCustomer, MistState } from '../../../../server/src/shared/mistWorkspace';
import { IMG, STAGES, fmt } from '../data';
import { useNav } from '../nav';
import { setComposeIntent } from '../runtime/composeIntent';
import { useMistWorkspace } from '../runtime/workspace';
import { useMistSession } from '../runtime/auth';
import { defaultMemberId, memberSelectOptions, workspaceMembers } from '../runtime/members';
import { ModuleEditorPage, type ModuleEditorSpec } from './modules/ModuleWorkbench';
import { CustomerMailPanel, FollowUpPanel, OpportunityPanel } from './CustomerRelations';
import { useFilePreview } from '../runtime/files';
import { useDevice } from '../runtime/devicePreferences';
import { IncotermPlaceInput, OptionInput } from './OptionInput';
import { COUNTRIES, CURRENCIES, CUSTOMER_GRADES, CUSTOMER_PAYMENT_TERMS, INDUSTRIES, PRODUCT_CATEGORIES, withCurrent, type TradeOption } from '../runtime/tradeOptions';
import { FailureNotice } from '../runtime/FailureNotice';
import { useRouteScope } from './modules/useRouteDraft';
const CUSTOMER_CHOICES: Partial<Record<string, TradeOption[]>> = { country: COUNTRIES, industry: INDUSTRIES, grade: CUSTOMER_GRADES, terms: CUSTOMER_PAYMENT_TERMS, categories: PRODUCT_CATEGORIES };

const customerProfileSource = (value: MistCustomer) => JSON.stringify([value.id, value.name, value.country, value.city, value.industry, value.ownerId, value.grade, value.currency, value.terms, value.incoterm, value.categories, value.creditLimit, value.since]);
type CustomerContactDraft = Partial<MistContact> & { primary?: boolean };
const contactSource = (value: CustomerContactDraft) => JSON.stringify([value.id, value.customerId, value.name, value.role, value.email, value.phone, !!value.primary]);
function currentContact(state: MistState, customerId: string, id: string) {
  const value = state.contacts.find(item => item.customerId === customerId && item.id === id);
  if (!value) return undefined;
  const linked = state.market.relations.find(item => item.customerId === customerId)?.contacts.find(item => item.id === id);
  return { ...value, primary: !!linked?.primary };
}

export function CustomerPage() {
  const density = useDevice('density');
  const { go, route, openAI } = useNav(), toast = useToast(), session = useMistSession();
  const { state, loading, error, run, refresh, downloadFile, workspace, pending, dismissError } = useMistWorkspace();
  const filePreview = useFilePreview();
  const members = workspaceMembers(workspace, state, session.user);
  const requestedId = route.id ?? route.customerId;
  const customer = requestedId ? state?.customers.find(item => item.id === requestedId) : state?.customers[0];
  const [tab, setTab] = React.useState('overview');
  const [creating, setCreating] = React.useState(false);
  const canChangeOwner = session.localMode || session.hasPermission('relations:admin');
  const canGrade = session.hasPermission(CUSTOMER_GRADE_SCOPE), canCredit = session.hasPermission(CUSTOMER_CREDIT_SCOPE);
  const canCreate = session.hasPermission('relations:write'), canDevelop=session.hasPermission('products:write')&&session.canAccessView(View.Development), canMail=session.hasPermission('emails:write');
  const manageableCustomers = workspace?.access?.manageableCustomerIds;
  const canMaintainCustomer = canCreate && (manageableCustomers ? !!customer && manageableCustomers.includes(customer.id) : !!session.localMode || canChangeOwner || customer?.ownerId === session.user?.id);
  React.useEffect(()=>{if(!canCreate)setCreating(false);if(!canMaintainCustomer){setEdit(null);setDeleteContact(false);}},[canCreate,canMaintainCustomer]);
  const [contact, setContact] = React.useState<CustomerContactDraft | null>(null);
  const [contactOrigin, setContactOrigin] = React.useState<string | null>(null);
  const relationContact = (id?: string) => state?.market.relations.find(r => r.customerId === customer?.id)?.contacts.find(c => c.id === id);
  const [edit, setEdit] = React.useState<MistCustomer | null>(null);
  const [editOrigin, setEditOrigin] = React.useState<string | null>(null);
  const [deleteContact, setDeleteContact] = React.useState(false), [frequency, setFrequency] = React.useState(false);
  const [busy, setBusy] = React.useState(false), [failure, setFailure] = React.useState('');
  const localFailure = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => { if (failure) localFailure.current?.scrollIntoView?.({ block: 'nearest' }); }, [failure]);
  const showFailure = (message: string) => { if (message === failure) localFailure.current?.scrollIntoView?.({ block: 'nearest' }); setFailure(message); };
  const routeScope = useRouteScope();
  const actionScope = JSON.stringify([session.sessionKey, session.user?.id, workspace?.id, customer?.id]);
  const activeScope = React.useRef(actionScope); activeScope.current = actionScope;
  const live = React.useRef({ state, workspace, pending }); live.current = { state, workspace, pending };
  React.useEffect(() => { setTab(route.section && ['followups', 'opportunities', 'mail'].includes(route.section) ? route.section : 'overview'); setContact(null); setContactOrigin(null); setEdit(null); setEditOrigin(null); setDeleteContact(false); setBusy(false); setFailure(''); }, [customer?.id, route.section, actionScope]);
  const orders = (state?.orders ?? []).filter(item => item.customerId === customer?.id);
  const devs = (state?.devs ?? []).filter(item => item.customerId === customer?.id);
  const contacts = (state?.contacts ?? []).filter(item => item.customerId === customer?.id);
  const invoices = (state?.invoices ?? []).filter(invoice => orders.some(order => order.id === invoice.orderId));
  const active = orders.filter(order => !['已出运', '履约完成', '已完成', '已取消', '已作废', '待收尾款'].includes(order.state));
  const events = (state?.events ?? []).filter(event => event.entityId === customer?.id || orders.some(order => order.id === event.entityId) || devs.some(dev => dev.id === event.entityId) || contacts.some(contact => contact.id === event.entityId)).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  // mar25：客户文件汇总开发案、动态、报价、订单、关系档案与关联邮件的附件。
  const relation = state?.market.relations.find(r => r.customerId === customer?.id);
  const quotes = (state?.market.quotations ?? []).filter(q => q.customerId === customer?.id);
  const mails = (state?.email?.messages ?? []).filter(m => m.folder !== 'trash' && m.links.some(l => l.kind === 'customer' && l.id === customer?.id));
  const fileIds = new Set([...devs.flatMap(dev => dev.fileIds), ...events.flatMap(event => event.fileIds), ...quotes.flatMap(q => [...q.fileIds, ...(q.documents || []).map(d => d.fileId)]), ...orders.flatMap(o => (o as { fileIds?: string[] }).fileIds || []), ...(relation?.fileIds || []), ...mails.flatMap(m => (m.attachments || []).map(a => a.fileId).filter((id): id is string => !!id))]);
  const files = (state?.files ?? []).filter(file => fileIds.has(file.id));
  const openContact = (value: CustomerContactDraft) => { setFailure(''); setContact(value); setContactOrigin(value.id ? contactSource(value) : null); };
  const closeContact = () => { if (!busy) { setContact(null); setContactOrigin(null); setFailure(''); } };
  const closeProfile = () => { if (!busy) { setEdit(null); setEditOrigin(null); setFailure(''); } };
  const closeDelete = () => { if (!busy) { setDeleteContact(false); setFailure(''); } };
  const execute = async (command: MistCommand, done: () => void, expectedRevision: number) => {
    if (busy || live.current.pending) return;
    const bound = actionScope, available = () => routeScope.isCurrent() && activeScope.current === bound;
    setBusy(true); setFailure('');
    try { await run(command, { expectedRevision }); if (available()) done(); }
    catch (problem) { if (available()) {
      const message = problem instanceof Error ? problem.message : '操作失败，请重试'; showFailure(message);
      // Only the live modal owns this confirmed failure. Unknown results keep their original recovery notice.
      if (!(problem as { mistPendingCommand?: unknown })?.mistPendingCommand) dismissError?.(message); // The provider checks its synchronous durable intent; rendered pending can lag a rejection.
    } } finally { if (available()) setBusy(false); }
  };
  const checkedWorkspace = () => {
    const current = live.current.workspace;
    if (!current || !Number.isSafeInteger(current.revision)) { showFailure('公司资料尚未读取，请重试。'); return null; }
    return current;
  };
  const checkedContact = () => {
    const current = checkedWorkspace(); if (!current || !customer || !contact) return null;
    if (contact.id) {
      const source = currentContact(current.state, customer.id, contact.id);
      if (!source || contactOrigin !== contactSource(source)) { showFailure('联系人资料已更新，请重新打开后核对。'); return null; }
    }
    return current;
  };
  const saveContact = async () => {
    if (!canMaintainCustomer || !contact || !customer || busy) return;
    if (!contact.name?.trim()) { showFailure('请填写联系人姓名'); return; }
    if (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) { showFailure('请填写有效邮箱'); return; }
    const current = checkedContact(); if (!current) return;
    await execute({ type: 'market.contact.save', payload: { kind:'customer',parentId:customer.id,id: contact.id,primary:!!contact.primary, name: contact.name, role: contact.role ?? '', email: contact.email ?? '', phone: contact.phone ?? '' } }, () => { setContact(null); setContactOrigin(null); toast('联系人已保存'); }, current.revision);
  };
  const saveProfile = async () => {
    if (!canMaintainCustomer || !edit || busy) return;
    const current = checkedWorkspace(); if (!current) return;
    const source = current.state.customers.find(item => item.id === edit.id);
    if (!source || editOrigin !== customerProfileSource(source)) { showFailure('客户资料已更新，请重新打开后核对。'); return; }
    const { id, owner: _owner, ...patch } = edit;
    await execute({ type: 'market.customer.update', payload: { id, patch } }, () => { setEdit(null); setEditOrigin(null); toast('客户资料已保存'); }, current.revision);
  };
  const removeContact = async () => {
    if (!canMaintainCustomer || !contact?.id || !customer || busy) return;
    const current = checkedContact(); if (!current) return;
    await execute({ type: 'market.contact.delete', payload: { kind:'customer',parentId:customer.id,id:contact.id } }, () => { setDeleteContact(false); setContact(null); setContactOrigin(null); toast('联系人已删除'); }, current.revision);
  };
  const createSpec:ModuleEditorSpec={
    title:'新建客户',submitLabel:'创建客户档案',
    initialValues:{name:'',code:'',country:'',city:'',industry:'',ownerId:defaultMemberId(members,session.user?.id),grade:'',currency:state?.settings.companyProfile?.defaultCurrency||'USD',terms:'',incoterm:'',categories:'',since:'',creditLimit:0},
    fields:[
      {key:'name',label:'客户名称',required:true},{key:'code',label:'客户编码',hint:'留空时由公司自动生成唯一编码'},
      {key:'country',label:'国家',type:'choice',options:COUNTRIES},{key:'city',label:'城市'},{key:'industry',label:'行业',type:'choice',options:INDUSTRIES},
      {key:'ownerId',label:'客户经理',type:'select',required:true,options:memberSelectOptions(members)},...(canGrade?[{key:'grade',label:'等级',type:'choice' as const,options:CUSTOMER_GRADES}]:[]),
      {key:'currency',label:'结算币种',type:'select',required:true,options:withCurrent(CURRENCIES,state?.settings.companyProfile?.defaultCurrency||'USD')},
      {key:'terms',label:'付款条款',type:'choice',options:CUSTOMER_PAYMENT_TERMS},{key:'incoterm',label:'贸易术语',type:'incoterm'},{key:'categories',label:'主要品类',type:'choice',options:PRODUCT_CATEGORIES},
      {key:'since',label:'合作起始日',type:'date'},...(canCredit?[{key:'creditLimit',label:'信用额度（结算币种）',type:'number' as const,min:0,step:'0.01'}]:[]),
    ],
    submit:async values=>{
      const value=(key:string)=>String(values[key]??'');
      const receipt=await run({type:'market.customer.create',payload:{input:{name:value('name'),code:value('code'),country:value('country'),city:value('city'),industry:value('industry'),ownerId:value('ownerId'),grade:value('grade'),currency:value('currency'),terms:value('terms'),incoterm:value('incoterm'),categories:value('categories'),since:value('since'),creditLimit:Number(values.creditLimit)}}});
      const id=receipt.result.customerId;
      if(typeof id!=='string'||!id)throw new Error('保存回执没有客户编号，请核对原操作结果');
      setCreating(false);go('crm',id,{customerId:id});
    },
  };
  const customerActions=<><Select aria-label={uiText("选择客户")} value={customer?.id||''} disabled={loading||creating} onChange={event=>{if(event.target.value)go('crm',event.target.value,{customerId:event.target.value});}} options={[{value:'',label:'选择客户'},...(state?.customers||[]).map(c=>({value:c.id,label:c.name+' · '+c.code}))]}/>{canCreate&&<BaseDataImportButton kind="customer" disabled={loading}/>}{canCreate&&<Button icon={Plus} disabled={loading} onClick={()=>setCreating(true)}>{uiText("新建客户")}</Button>}</>;
  if(creating&&canCreate)return <ModuleEditorPage spec={createSpec} onClose={()=>setCreating(false)}/>;
  // mar17：未指定客户且有多个客户时先看客户列表；只有一个客户时直接进入详情。
  if(!requestedId&&state&&state.customers.length>1)return <CustomerList state={state} actions={canCreate?<Button icon={Plus} onClick={()=>setCreating(true)}>{uiText('新建客户')}</Button>:null} onOpen={id=>go('crm',id,{customerId:id})}/>;
  const emailValid = (email?:string):email is string => !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const customerEmail = contacts.find(item=>emailValid(item.email))?.email;
  // Mail goes out through the smart mailbox so it stays with the customer; the mailbox opens a draft linked to this customer.
  const writeMail = (email?: string) => { if (!emailValid(email)) { setFailure('请先为联系人填写有效邮箱'); return; } setComposeIntent({ to: email!, subject: '', links: customer ? [{ kind: 'customer', id: customer.id }] : [] }); go('emails'); };
  if (!customer) return <MistPage><PageHeader title={uiText("客户管理")} actions={customerActions}/><EmptyState title={uiText(loading ? '正在读取客户' : requestedId ? '没有找到指定客户' : '还没有客户档案')} description={error ? uiText(error) : requestedId ? uiText('请选择本公司已有客户，或新建客户。') : undefined} action={error || requestedId ? <Button onClick={() => void refresh()}>{uiText("重新读取")}</Button> : undefined} /></MistPage>;
  const currencyOrders = orders.filter(order => order.currency === customer.currency && !['已作废', '已取消'].includes(order.state)), currencyInvoices = invoices.filter(invoice => invoice.currency === customer.currency);
  const start = new Date(customer.since).getTime(), years = Number.isFinite(start) ? Math.max(0, (businessNow().getTime() - start) / (365.25 * 24 * 3600 * 1000)).toFixed(1) : '—';
  const contactList = <div className="mist-related">{contacts.length ? contacts.map(item => <button key={item.id} type="button" onClick={() => { openContact({ ...item, primary: !!relationContact(item.id)?.primary }); setFailure(''); }}><Avatar name={item.name} identityKey={`contact:${item.id}`} tone={item.tone} /><span><b>{item.name}</b><small>{item.role} · {item.email || item.phone || '待补充联系方式'}</small></span></button>) : <EmptyState compact title={uiText("还没有联系人")} action={canMaintainCustomer?<Button onClick={() => openContact({ name: '', role: '', email: '', phone: '' })}>{uiText("添加联系人")}</Button>:undefined} />}</div>;
  return <MistPage>
    <IdentityHeader thumb={<span className="mist-thumb" data-size="lg" style={{ fontSize: 22, fontWeight: 300, color: 'var(--mist-accent-ink)', background: 'var(--mist-accent-tint)' }}>{customer.name.slice(0, 2)}</span>}
      meta={[`${customer.country} · ${customer.city}`, customer.industry, <Mono key="code">{customer.code}</Mono>]} title={uiText(customer.name)}
      facts={[{ label: '客户经理', value: <><Avatar name={customer.owner} identityKey={customer.ownerId} size="xs" />{customer.owner}</> }, { label: '等级', value: <Pill tone="accent">{customer.grade}</Pill> }]}
      actions={<>{customerActions}{canMail&&<Button icon={Mail} disabled={!customerEmail} title={uiText(customerEmail?'使用本机邮件应用撰写，Bambook不会发送邮件':'请先添加含有效邮箱的联系人')} onClick={() => writeMail(customerEmail)}>{uiText("写邮件")}</Button>}{canDevelop&&<Button variant="primary" icon={Plus} onClick={() => go('development/new', undefined, { customerId: customer.id })}>{uiText("新建开发案")}</Button>}{canMaintainCustomer&&<IconButton icon={Ellipsis} label={uiText("编辑客户资料")} onClick={() => { setEdit({ ...customer }); setEditOrigin(customerProfileSource(customer)); setFailure(''); }} />}</>} />
    {!edit && !contact && !deleteContact && !pending && (error || failure) && <FailureNotice title={"操作尚未完成"} detail={failure || error} />}
    <Tabs value={tab} onChange={setTab} options={[{ value: 'overview', label: '概览' }, { value: 'orders', label: '订单', count: orders.length }, { value: 'dev', label: '开发', count: devs.length }, { value: 'followups', label: '跟进', count: (state?.crm?.followUps ?? []).filter(row => row.customerId === customer.id).length }, { value: 'opportunities', label: '商机', count: (state?.crm?.opportunities ?? []).filter(row => row.customerId === customer.id && !['won', 'lost'].includes(row.stage)).length }, { value: 'mail', label: '邮件' }, { value: 'contacts', label: '联系人', count: contacts.length }, { value: 'files', label: '文件', count: files.length }]} />
    <StatGrid>
      <StatCard icon={BadgeDollarSign} label={uiText("今年下单")} value={fmt(currencyOrders.filter(order => new Date(order.createdAt).getFullYear() === businessNow().getFullYear()).reduce((sum, order) => sum + order.amount, 0), 2)} unit={uiText(customer.currency)} foot={`共 ${orders.length} 个订单`} />
      <StatCard icon={ClipboardList} label={uiText("在途订单")} value={active.length} unit={uiText("单")} foot={active.map(order => order.code).join(' · ')} onClick={() => setTab('orders')} />
      <StatCard icon={Wallet} label={uiText("应收余额")} value={fmt(currencyInvoices.reduce((sum, invoice) => sum + invoice.open, 0), 2)} unit={uiText(customer.currency)} foot={`${invoices.length} 张发票`} onClick={() => go('payment-vouchers')} />
      <StatCard icon={CalendarClock} label={uiText("合作时长")} value={years} unit={uiText("年")} foot={customer.since ? `${uiText("起始")} ${customer.since}` : undefined} />
    </StatGrid>
    <div className="mist-detail" data-layout="main-rail">
      <div>
        {tab === 'overview' && <Banner tone="ai" icon={Sparkles} title={uiText("小竹洞察")} actions={<Button size="sm" variant="ai" onClick={() => openAI(`仅根据以下已读取事实概括客户 ${customer.name}（${customer.code}）：${active.length} 个在途订单，${devs.length} 个开发案，待收 ${fmt(currencyInvoices.reduce((sum, invoice) => sum + invoice.open, 0), 2)} ${customer.currency}。说明缺失信息，不要推断未提供的对客沟通或承诺。`)}>{uiText("展开")}</Button>}>{customer.name}{uiText(" 当前有 ")}{active.length}{uiText(" 个在途订单、")}{devs.length}{uiText(" 个开发案；待收 ")}{fmt(currencyInvoices.reduce((sum, invoice) => sum + invoice.open, 0), 2)} {customer.currency}。</Banner>}
        {(tab === 'overview' || tab === 'orders') && <Card><CardHeader title={uiText("订单")} tools={<Button variant="quiet" size="sm" onClick={() => go('orders', undefined, { customerId: customer.id })}>{uiText("全部订单")}</Button>} />
          <DataTable density={density} ariaLabel={uiText("客户订单")} rows={orders} rowKey={order => order.id} onRowClick={order => go('orders/detail', order.id, { customerId: customer.id })} empty={<EmptyState compact title={uiText("还没有订单")} action={<Button onClick={() => go('orders/new', undefined, { customerId: customer.id })}>{uiText("新建订单")}</Button>} />} columns={[
            { key: 'id', header: '订单', width: 'minmax(180px,1.6fr)', render: order => <ObjectCell thumb={<Thumb src={IMG[order.img]} icon={Layers} size="sm" />} name={<Mono>{order.code}</Mono>} meta={order.season} /> },
            { key: 'a', header: '金额', width: '120px', align: 'right', render: order => <b className="mist-cell-strong mist-num">{fmt(order.amount, 2)} <span className="mist-muted">{order.currency}</span></b> },
            { key: 'd', header: '交期', width: '88px', hideOnMobile: true, render: order => <span className="mist-num">{order.due}</span> },
            { key: 's', header: '状态', width: '120px', render: order => <Pill tone={order.tone}>{order.state}</Pill> },
          ]} /></Card>}
        {(tab === 'overview' || tab === 'dev') && <Card><CardHeader title={uiText("进行中的开发")} sub={ui`${devs.length} 个开发案`} tools={<Button variant="quiet" size="sm" onClick={() => go('development', undefined, { customerId: customer.id })}>{uiText("开发与寻样")}</Button>} />
          <DataTable density={density} ariaLabel={uiText("客户开发案")} rows={devs} rowKey={dev => dev.id} onRowClick={dev => go('development/detail', dev.id, { customerId: customer.id, versionId: dev.currentVersionId ?? undefined })} empty={<EmptyState compact title={uiText("还没有开发案")} />} columns={[
            { key: 'n', header: '开发对象', width: 'minmax(200px,2fr)', render: dev => <ObjectCell thumb={<Thumb src={IMG[dev.img]} size="sm" />} name={dev.name} meta={<Mono>{dev.code}</Mono>} /> },
            { key: 'st', header: '阶段', width: '120px', hideOnMobile: true, render: dev => <><StageProgress total={5} current={dev.stage} /><span className="mist-cell-sub" style={{ marginTop: 6 }}>{STAGES[dev.stage]}</span></> },
            { key: 's', header: '状态', width: '118px', render: dev => <Pill tone={dev.tone}>{dev.state}</Pill> },
          ]} /></Card>}
        {state?.crm && (tab === 'overview' || tab === 'opportunities') && <OpportunityPanel customer={customer} state={state} can={session.hasPermission('crm:write')} />}
        {state?.crm && tab === 'followups' && <FollowUpPanel customer={customer} state={state} can={session.hasPermission('crm:write')} />}
        {state && tab === 'mail' && <CustomerMailPanel customer={customer} state={state} />}
        {tab === 'contacts' && <Card><CardHeader title={uiText("联系人")} tools={canMaintainCustomer?<IconButton icon={Plus} label={uiText("添加联系人")} onClick={() => { openContact({ name: '', role: '', email: '', phone: '' }); setFailure(''); }} />:undefined} />{contactList}</Card>}
        {tab === 'files' && <Card><CardHeader title={uiText("客户关联文件")} /><DataTable density={density} rows={files} rowKey={file => file.id} onRowClick={file => filePreview.open(file, files)} empty={<EmptyState compact title={uiText("还没有关联文件")} description={uiText("开发案及沟通记录的附件会汇总到这里。")} />} columns={[
          { key: 'name', header: '文件', render: file => <span className="mist-file"><span>{file.name}</span></span> }, { key: 'size', header: '大小', render: file => `${Math.ceil(file.size / 1024)} KB` }, { key: 'download', header: '下载', render: file => <IconButton icon={Download} size="sm" label={ui`下载 ${file.name}`} onClick={event => { event.stopPropagation(); void downloadFile(file).catch(problem => setFailure(problem instanceof Error ? problem.message : '下载失败')); }} /> },
        ]} />{filePreview.node}</Card>}
      </div>
      <div className="mist-detail-rail">
        <Card><CardHeader title={uiText("档案")} /><KeyValue items={[{ label: '结算币种', value: customer.currency }, { label: '付款条款', value: customer.terms }, { label: '贸易术语', value: customer.incoterm }, { label: '主要品类', value: customer.categories }, { label: '信用额度', value: `${fmt(customer.creditLimit, 2)} ${customer.currency}` }]} /></Card>
        {tab !== 'contacts' && <Card><CardHeader title={uiText("联系人")} tools={canMaintainCustomer?<IconButton icon={Plus} label={uiText("添加联系人")} size="sm" onClick={() => { openContact({ name: '', role: '', email: '', phone: '' }); setFailure(''); }} />:undefined} />{contactList}</Card>}
        {state?.crm && tab !== 'followups' && <FollowUpPanel customer={customer} state={state} can={session.hasPermission('crm:write')} compact />}
        <Card><CardHeader title={uiText("沟通动态")} tools={<IconButton icon={TrendingUp} label={uiText("业务动态统计")} size="sm" onClick={() => setFrequency(true)} />} /><Timeline events={events.map(event => ({ who: event.actor, when: new Date(event.at).toLocaleString(interfaceLocale(),{timeZone:'Asia/Shanghai',hour12:false}), text: event.text }))} />{!events.length && <EmptyState compact title={uiText("暂无动态")} />}</Card>
      </div>
    </div>
    <Drawer open={!!contact} onClose={closeContact} title={uiText(!canMaintainCustomer?'联系人':contact?.id ? '编辑联系人' : '添加联系人')} footer={<><Button disabled={busy} onClick={closeContact}>{uiText(canMaintainCustomer?'取消':'关闭')}</Button>{canMaintainCustomer&&contact?.id && <Button variant="danger" disabled={busy} onClick={() => { setFailure(''); setDeleteContact(true); }}>{uiText("删除")}</Button>}{canMaintainCustomer&&<Button variant="primary" loading={busy} disabled={!!pending} onClick={() => void saveContact()}>{uiText("保存")}</Button>}</>}>
      {failure && !deleteContact && <div ref={localFailure}><Banner tone={pending ? 'warn' : 'bad'} title={uiText(pending ? '结果待核对' : '联系人未保存')}>{failure}</Banner></div>}<FormGrid>{(['name', 'role', 'email', 'phone'] as const).map((key, index) => <Field key={key} label={uiText(['姓名', '职责', '邮箱', '电话'][index])} required={key === 'name'}><TextInput aria-label={uiText(['姓名', '职责', '邮箱', '电话'][index])} readOnly={!canMaintainCustomer} type={key === 'email' ? 'email' : 'text'} value={contact?.[key] ?? ''} onChange={event => setContact(value => ({ ...value, [key]: event.target.value }))} /></Field>)}{canMaintainCustomer ? <Checkbox label={uiText('主联系人')} checked={!!contact?.primary} onChange={primary => setContact(value => ({ ...value, primary }))} /> : contact?.primary ? <span className="mist-note">{uiText('主联系人')}</span> : null}</FormGrid>
      {canMail&&contact?.email && <Button icon={Mail} disabled={!emailValid(contact.email)} title={uiText("使用本机邮件应用撰写，Bambook不会发送邮件")} onClick={() => writeMail(contact.email)}>{uiText("写邮件")}</Button>}
    </Drawer>
    <Dialog open={deleteContact} onClose={closeDelete} title={uiText("删除联系人？")} description={uiText(contact?.name)} footer={<><Button disabled={busy} onClick={closeDelete}>{uiText("取消")}</Button><Button variant="danger" loading={busy} disabled={!!pending} onClick={() => void removeContact()}>{uiText("删除联系人")}</Button></>}>
      {failure && <div ref={localFailure}><Banner tone={pending ? 'warn' : 'bad'} title={uiText(pending ? '结果待核对' : '删除未完成')}>{failure}</Banner></div>}
    </Dialog>
    <Drawer open={!!edit} onClose={closeProfile} title={uiText("编辑客户资料")} size="lg" footer={<Button variant="primary" loading={busy} disabled={!!pending} onClick={() => void saveProfile()}>{uiText("保存资料")}</Button>}>
      {failure && <div ref={localFailure}><Banner tone={pending ? 'warn' : 'bad'} title={uiText(pending ? '结果待核对' : '资料未保存')}>{failure}</Banner></div>}<FormGrid>{(['name', 'country', 'city', 'industry', 'grade', 'terms', 'incoterm', 'categories', 'since'] as const).map((key, index) => <Field key={key} label={uiText(['客户名称', '国家', '城市', '行业', '等级', '付款条款', '贸易术语', '主要品类', '合作起始日'][index])}>{key === 'incoterm' ? <IncotermPlaceInput value={edit?.incoterm ?? ''} onChange={incoterm => setEdit(value => value ? { ...value, incoterm } : value)} /> : CUSTOMER_CHOICES[key] ? <OptionInput disabled={key==='grade'&&!canGrade} ariaLabel={['客户名称', '国家', '城市', '行业', '等级', '付款条款', '贸易术语', '主要品类', '合作起始日'][index]} options={CUSTOMER_CHOICES[key]!} value={edit?.[key] ?? ''} onChange={next => setEdit(value => value ? { ...value, [key]: next } : value)} /> : <TextInput type={key === 'since' ? 'date' : 'text'} value={edit?.[key] ?? ''} onChange={event => setEdit(value => value ? { ...value, [key]: event.target.value } : value)} />}</Field>)}<Field label={uiText("客户经理")}><Select aria-label={uiText("客户经理")} disabled={!canChangeOwner} value={edit?.ownerId ?? ''} onChange={event => setEdit(value => value ? { ...value, ownerId: event.target.value } : value)} options={memberSelectOptions(members, { current: { id: edit?.ownerId, name: edit?.owner } })} /></Field><Field label={uiText("结算币种")}><Select disabled={!canCredit&&Number(edit?.creditLimit)>0} aria-label={uiText("结算币种")} value={edit?.currency ?? 'USD'} onChange={event => setEdit(value => value ? { ...value, currency: event.target.value } : value)} options={withCurrent(CURRENCIES, edit?.currency || 'USD')} /></Field><Field label={uiText("信用额度（结算币种）")}><TextInput readOnly={!canCredit} type="number" min={0} value={edit?.creditLimit ?? 0} onChange={event => setEdit(value => value ? { ...value, creditLimit: Number(event.target.value) } : value)} /></Field></FormGrid>
    </Drawer>
    <Dialog open={frequency} onClose={() => setFrequency(false)} title={uiText("业务动态统计")}><KeyValue items={[{ label: '全部业务动态', value: events.length }, { label: '最近 30 天业务动态', value: events.filter(event => businessNow().getTime() - new Date(event.at).getTime() <= 30 * 86400000).length }, { label: '最近业务动态', value: events[0] ? new Date(events[0].at).toLocaleString(interfaceLocale(),{timeZone:'Asia/Shanghai',hour12:false}) : '暂无记录' }]} /></Dialog>
  </MistPage>;
}
