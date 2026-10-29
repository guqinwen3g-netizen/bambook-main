import { uiText, ui } from '../../../../services/interfaceLanguage';
import { MistPresentedErrorContext } from '../runtime/errorPresentation';
import {businessDate,businessNow,businessToday} from '../runtime/businessClock';
/** T6 收款核销：保留原 Mist 双栏，对账结果由公司共享数据保存。 */
import { AccessHiddenNotice } from './AccessHiddenNotice';
import { MIST_FINANCE_SCOPES } from '../../../../server/src/shared/mistFinancePermissions';
import React from 'react';
import { ArrowRight, Download, Landmark, Link2, Sparkles, Upload } from 'lucide-react';
import { Banner, Button, Card, CardFooter, CardHeader, DataTable, Dialog, Drawer, EmptyState, Facts, Field, FormGrid, KeyValue, MistPage, Mono, PageHeader, Pill, Select, SummaryBar, Tabs, TextInput, Tile, useToast, type Column } from '../../../../components/mist';
import type { MistCommand, MistInvoice, MistReceipt, MistAllocation } from '../../../../server/src/shared/mistWorkspace';
import { isActiveMistInvoice, isPendingFinanceMistInvoice, mistCommandPermission, mistPaymentReverseBlock } from '../../../../server/src/shared/mistWorkspace';
import { fmt } from '../data';
import { useNav } from '../nav';
import { useMistWorkspace } from '../runtime/workspace';
import { useMistSession } from '../runtime/auth';
import { useRouteDraft, useRouteScope } from './modules/useRouteDraft';
import { FinanceAccounts, FinanceEntrances, FinancePayables, FinanceRecords, financeArea, factoryReceiptUses, type FinanceArea } from './FinanceWorkspace';
import type { OrderFundingAssignment,OrderFundingCommand } from '../../../../server/src/shared/mistOrderFunding';
import { orderDepositCoverage,orderFundingReconciliationLimit } from '../../../../server/src/shared/mistOrderFunding';
import { mistPayerMatchesInvoice } from '../../../../server/src/shared/mistOpeningBalance';
import { downloadMistCsv, mistDate } from './OrderListPage';
import { FinanceDevBilling } from './FinanceDevBilling';
import { useDevice } from '../runtime/devicePreferences';

import { financeReceiptDisplay, RECEIPT_STATE as STATE } from '../runtime/financeReceiptDisplay';
import { OptionInput } from './OptionInput';
import { CURRENCIES, PAYER_RELATIONS, withCurrent } from '../runtime/tradeOptions';
export { financeReceiptDisplay };
type ImportedReceipt = Extract<MistCommand, { type: 'finance.importReceipts' }>['payload']['receipts'][number];
export function parseMistReceiptCsv(text: string): ImportedReceipt[] {
  const rows:string[][]=[];let row:string[]=[],value='',quoted=false,closed=false;
  const cell=()=>{row.push(value);value='';closed=false;};
  const line=()=>{cell();if(row.some(item=>item.trim()))rows.push(row);row=[];};
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(quoted){if(char==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=char;continue;}
    if(closed&&char!==','&&char!=='\n'&&char!=='\r'){if(/\s/.test(char))continue;throw new Error('CSV 引号结束后存在无效内容。');}
    if(char==='"'){if(value.trim())throw new Error('CSV 单元格引号位置无效。');quoted=true;value='';}
    else if(char===',')cell();
    else if(char==='\n'||char==='\r'){if(char==='\r'&&text[i+1]==='\n')i++;line();}
    else value+=char;
  }
  if(quoted)throw new Error('CSV 引号未闭合，请检查文件。');line();
  const headers=(rows.shift()??[]).map(cell=>cell.replace(/^\uFEFF/,'').trim().toLowerCase());
  const index=(names:string[])=>{const found=headers.map((header,index)=>names.includes(header)?index:-1).filter(index=>index>=0);if(found.length>1)throw new Error('CSV 包含重复的业务列。');return found[0]??-1;};
  const fields={date:index(['date','日期','到账日期','到账']),payer:index(['payer','付款方','付款人']),amount:index(['amount','金额','到账金额']),currency:index(['currency','币种']),ref:index(['ref','reference','附言','参考号','流水附言'])};
  if(Object.values(fields).some(index=>index<0))throw new Error('请提供日期、付款方、金额、币种、附言五列。');
  if(!rows.length||rows.length>2000)throw new Error('流水数量须为1至2000行。');
  return rows.map((cells,index)=>{const get=(field:keyof typeof fields)=>(cells[fields[field]]??'').trim(),date=get('date'),raw=get('amount');
    const dateValue=new Date(date+'T00:00:00Z');
    if(cells.length!==headers.length||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(dateValue.getTime())||dateValue.toISOString().slice(0,10)!==date||!get('payer')||!/^\d+(?:,\d{3})*(?:\.\d{1,2})?$/.test(raw)||!/^\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$/.test(raw)&&raw.includes(',')||!/^[A-Za-z]{3}$/.test(get('currency')))throw new Error(`第 ${index+2} 行的日期、付款方、金额或币种无效。`);
    const amount=Number(raw.replace(/,/g,''));if(!Number.isFinite(amount)||amount<=0||amount>=1e12)throw new Error(`第 ${index+2} 行的金额无效。`);
    return{date,payer:get('payer'),amount,currency:get('currency').toUpperCase(),ref:get('ref')};
  });
}
function financeDay(date:Date){return businessDate(date);}
export function financeAllocationAmount(input:string,maximum:number):number|null { if(!/^\d+(?:\.\d{1,2})?$/.test(input.trim()))return null;const amount=Number(input);return Number.isFinite(amount)&&amount>0&&Math.round(amount*100)<=Math.round(maximum*100)?amount:null; }
const cashTotal=(values:number[])=>values.reduce((sum,value)=>sum+Math.round(value*100),0)/100;

async function fileText(file: File) {
  if (typeof file.text === 'function') return file.text();
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result ?? '')); reader.onerror = () => reject(new Error('文件读取失败')); reader.readAsText(file); });
}
export function FinancePage() {
  const density = useDevice('density');
  const { go,route } = useNav(), toast = useToast(), workspace=useMistWorkspace(),session=useMistSession(),routeScope=useRouteScope();
  const presentedError=React.useContext(MistPresentedErrorContext);
  // 公司银行账户与余额只对登记收付款的财务开放（服务端同样不下发）。
  const canSeeAccounts=session.hasPermission(MIST_FINANCE_SCOPES.voucher)&&!workspace.workspace?.access?.hidden.some(section=>section.key==='bankAccounts'),areaOf=(section?:string)=>{const next=financeArea(section);return next==='accounts'&&!canSeeAccounts?'receivables':next;};
  const [area,setArea]=React.useState<FinanceArea>(()=>areaOf(route.section));
  React.useEffect(()=>setArea(areaOf(route.section)),[route.section,canSeeAccounts]);
  const { state, loading, error, run, refresh, saving, pending, recover }=workspace;
  const scope=`${workspace.workspace?.id||''}:${workspace.workspace?.ownerId||''}`,activeScope=React.useRef(scope);activeScope.current=scope;
  const alive=React.useRef(true);React.useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const operation=React.useRef(false),fileSequence=React.useRef(0),routed=React.useRef('');
  const [tab, setTab] = React.useState<'recv' | 'pay' | 'inv'>('recv');
  const [sel, setSel] = React.useState(''), [pick, setPick] = React.useState<string | undefined>();
  const [payerBasis,setPayerBasis]=React.useState(''),[allocationInput,setAllocationInput]=React.useState('');
  const [working, setWorking] = React.useState(false), [failure, setFailure] = useRouteDraft('');
  const busy=working||loading||saving||!!pending;
  const [importRows, setImportRows] = useRouteDraft<ImportedReceipt[]>([]), [fileName, setFileName] = React.useState(''), [importAccount, setImportAccount] = React.useState('');
  const [invoiceId, setInvoiceId] = React.useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useRouteDraft(false);
  const [reversal,setReversal]=useRouteDraft<{kind:'allocation'|'payment';id:string;title:string}|null>(null);
  const [reversalReason,setReversalReason]=useRouteDraft('');
  const [payment, setPayment] = useRouteDraft({ date: businessToday(), payee: '', amount: '', currency: 'USD', ref: '', accountId: '' });
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [fundingDialog,setFundingDialog]=useRouteDraft<{receiptId:string;id?:string;release?:boolean}|null>(null);
  const [funding,setFunding]=useRouteDraft({customerId:'',orderId:'',amount:'',note:''});
  const fundingRows=state?.orderFunding?.assignments??[],canFund=session.hasPermission(MIST_FINANCE_SCOPES.reconcile),canVoucher=session.hasPermission(MIST_FINANCE_SCOPES.voucher);
  const sourceOrderId=route.section?.startsWith('funding:')?route.section.slice('funding:'.length):undefined;
  const sourceOrder=state?.orders.find(order=>order.id===sourceOrderId),deposit=sourceOrder&&state?orderDepositCoverage(state,sourceOrder.id):null;
  const receipts = state?.receipts ?? [], invoices = state?.invoices ?? [], allocations = state?.allocations ?? [], payments = state?.payments ?? [];
  const sourceInvoiceId=route.section?.startsWith('invoice:')?route.section.slice('invoice:'.length):undefined,sourceInvoice=invoices.find(item=>item.id===sourceInvoiceId);
  const unclaimedCount=receipts.filter(item=>financeReceiptDisplay(item,fundingRows,allocations).unclaimed).length;
  const today=financeDay(businessNow());
  const overdueScope=route.section?.startsWith('overdue'),orderType=overdueScope?route.section?.split(':')[1]:undefined;
  const hasInvoiceFilter=route.section==='open'||overdueScope||!!route.customerId;
  const visibleInvoices=invoices.filter(invoice=>{
    const order=state?.orders.find(order=>order.id===invoice.orderId);
    return (!route.customerId||order?.customerId===route.customerId)&&(!hasInvoiceFilter||isActiveMistInvoice(invoice)&&invoice.open>0)&&(!overdueScope||invoice.due<today)&&(!orderType||order?.type===orderType);
  });
  React.useEffect(()=>{operation.current=false;fileSequence.current++;routed.current='';setWorking(false);setFailure('');setImportRows([]);setPaymentOpen(false);setInvoiceId(null);setSel('');setPick(undefined);setPayment({date:financeDay(businessNow()),payee:'',amount:'',currency:'USD',ref:'',accountId:''});setImportAccount('');},[scope]);
  React.useEffect(()=>{const key=scope+':'+(route.id||'')+':'+(route.section||'');if(routed.current===key)return;if(route.id&&invoices.some(invoice=>invoice.id===route.id)){setInvoiceId(route.id);setTab('inv');routed.current=key;}else if(route.id&&receipts.some(receipt=>receipt.id===route.id)){setSel(route.id);setTab('recv');routed.current=key;}else if(sourceInvoiceId){setInvoiceId(null);setTab('recv');const target=invoices.find(item=>item.id===sourceInvoiceId),available=receipts.filter(item=>item.remaining>0&&item.currency===target?.currency);const linked=available.find(item=>fundingRows.some(row=>row.receiptId===item.id&&row.orderId===target?.orderId&&row.state==='active')),suggested=available.find(item=>item.suggest===sourceInvoiceId);setSel((linked||suggested)?.id||'');setPick(sourceInvoiceId);routed.current=key;}else if(sourceOrderId){setTab('recv');routed.current=key;}else if(hasInvoiceFilter){setTab('inv');routed.current=key;}},[route.id,route.section,scope,invoices,receipts,hasInvoiceFilter]);
  const unknownTarget=!!state&&!!route.id&&!loading&&!receipts.some(item=>item.id===route.id)&&!invoices.some(item=>item.id===route.id)&&!(area==='records'&&payments.some(item=>item.id===route.id))&&!(area==='payables'&&[...(state.payables?.bills??[]),...(state.payables?.payments??[]),...(state.payables?.requests??[]),...(state.payables?.plans??[]),...(state.payables?.settlements??[])].some(item=>item.id===route.id));
  const receipt = unknownTarget?undefined:receipts.find(item => item.id === sel) ?? (sourceInvoiceId?undefined:receipts.find(item=>item.remaining>0) ?? receipts[0]);
  const receiptDisplay=receipt?financeReceiptDisplay(receipt,fundingRows,allocations):null;
  React.useEffect(() => { if (receipt) setPick(sourceInvoiceId||receipt.suggest); else setPick(undefined); }, [receipt?.id, receipt?.suggest,sourceInvoiceId]);
  React.useEffect(()=>setPayerBasis(''),[receipt?.id,pick,scope]);
  const candidates = receipt ? invoices.filter(invoice => (!sourceInvoiceId||invoice.id===sourceInvoiceId)&&isActiveMistInvoice(invoice) && invoice.currency === receipt.currency && invoice.open > 0&&!!state&&orderFundingReconciliationLimit(state,receipt.id,invoice.id)>0).sort((a, b) => a.id === receipt.suggest ? -1 : b.id === receipt.suggest ? 1 : 0) : [];
  const invoice = candidates.find(item => item.id === pick), previewInvoice = invoices.find(item => item.id === invoiceId);
  const needsPayerBasis=!!receipt&&!!invoice&&!!state&&!mistPayerMatchesInvoice(state,invoice,receipt.payer);
  const maximumAllocation=receipt&&invoice&&state?orderFundingReconciliationLimit(state,receipt.id,invoice.id):0;
  React.useEffect(()=>setAllocationInput(maximumAllocation>0?String(maximumAllocation):''),[receipt?.id,invoice?.id,scope]);
  const allocationAmount=financeAllocationAmount(allocationInput,maximumAllocation);
  const pendingReceipts = receipts.filter(item => item.remaining > 0);
  const suggestions = pendingReceipts.filter(item => (!sourceInvoiceId||item.suggest===sourceInvoiceId)&&item.state === 'suggested' && (item.confidence ?? 0) >= 80 && invoices.some(invoice => isActiveMistInvoice(invoice) && invoice.id === item.suggest && invoice.currency === item.currency && invoice.open > 0&&!!state&&mistPayerMatchesInvoice(state,invoice,item.payer)&&orderFundingReconciliationLimit(state,item.id,invoice.id)>=Math.min(item.remaining,invoice.open)));
  const execute = async (command: MistCommand|OrderFundingCommand, success: (result:Record<string,unknown>) => void) => {
    const permission=mistCommandPermission(command);if(permission&&!session.hasPermission(permission as any)){setFailure('没有办理此项财务动作的权限。');return;}
    if (busy||operation.current) return; const bound=scope;operation.current=true;setWorking(true);setFailure('');
    try { const receipt=await run(command);if(alive.current&&activeScope.current===bound&&routeScope.isCurrent())success(receipt.result); } catch (problem) { if(alive.current&&activeScope.current===bound&&routeScope.isCurrent())setFailure(problem instanceof Error ? problem.message : '操作失败，请重试'); } finally { if(alive.current&&activeScope.current===bound){operation.current=false;setWorking(false);} }
  };
  const openFunding=(source:MistReceipt,assignment?:OrderFundingAssignment,release=false)=>{
    const order=state?.orders.find(o=>o.id===(assignment?.orderId||sourceOrderId)&&o.currency===source.currency);
    const assigned=fundingRows.filter(row=>row.receiptId===source.id&&row.state==='active').reduce((sum,row)=>sum+Math.round(row.amount*100),0);
    setFunding({customerId:assignment?.customerId||order?.customerId||state?.customers.find(c=>c.name.trim().toLocaleLowerCase()===source.payer.trim().toLocaleLowerCase())?.id||'',orderId:assignment?.orderId||order?.id||'',amount:String(assignment?.amount??Math.max(0,(Math.round(source.amount*100)-assigned)/100)),note:''});
    setFundingDialog({receiptId:source.id,id:assignment?.id,release});setFailure('');
  };
  const fundingReceipt=receipts.find(r=>r.id===fundingDialog?.receiptId);
  const confirm = () => { if (!canFund||!receipt || !invoice || !isActiveMistInvoice(invoice) || receipt.remaining <= 0||allocationAmount===null||needsPayerBasis&&!payerBasis.trim()) return; const amount=allocationAmount;void execute({ type: 'finance.reconcile', payload: { receiptId: receipt.id, invoiceId: invoice.id,...(Math.round(amount*100)!==Math.round(Math.min(receipt.remaining,invoice.open)*100)?{amount}:{}),...(needsPayerBasis?{payerBasis:payerBasis.trim()}:{}) } }, () => { toast('核销记录已保存'); if(amount<receipt.remaining)return;if(sourceInvoiceId){setSel('');return;}const next = pendingReceipts.find(item => item.id !== receipt.id); if (next) setSel(next.id); }); };
  const openReversal=(kind:'allocation'|'payment',id:string,title:string)=>{setReversal({kind,id,title});setReversalReason('');setFailure('');};
  const submitReversal=()=>{if(!reversal)return;const reason=reversalReason.trim();if(!reason){setFailure('请填写冲回原因。');return;}
    const command:MistCommand=reversal.kind==='allocation'?{type:'finance.allocation.reverse',payload:{allocationId:reversal.id,reason}}:{type:'finance.payment.reverse',payload:{paymentId:reversal.id,reason}};
    void execute(command,()=>{setReversal(null);setReversalReason('');toast(reversal.kind==='allocation'?'核销已冲回':'付款凭证已冲回');});};
  const openArea=(next:FinanceArea)=>{setArea(next);setInvoiceId(null);if(next==='receivables')setTab('inv');go('payment-vouchers',undefined,{section:next});};
  const openReceipt=(id:string)=>{setArea('receivables');setTab('recv');setSel(id);go('payment-vouchers',id);};
  const currencies=[...new Set([...receipts.map(row=>row.currency),...invoices.map(row=>row.currency)])];
  const displayCurrency=previewInvoice?.currency||receipt?.currency||(currencies.includes('USD')?'USD':currencies[0])||'USD';
  const now=businessNow(),monthAllocations=allocations.filter(item=>{const date=mistDate(item.createdAt);return date&&date.getFullYear()===now.getFullYear()&&date.getMonth()===now.getMonth();});
  const overdueInvoices=invoices.filter(item=>isActiveMistInvoice(item)&&item.open>0&&item.due<today);
  const pendingAmount=cashTotal(pendingReceipts.filter(item=>item.currency===displayCurrency).map(item=>item.remaining));
  const otherPending=currencies.filter(currency=>currency!==displayCurrency).map(currency=>`${fmt(cashTotal(pendingReceipts.filter(item=>item.currency===currency).map(item=>item.remaining)),2)} ${currency}`).join(' · ');
  const resolvePending=async()=>{if(working||saving||loading||operation.current)return;const bound=scope,original=pending;operation.current=true;setWorking(true);setFailure('');try{const receipt=await recover();if(receipt&&alive.current&&activeScope.current===bound&&routeScope.isCurrent()){if(original?.command?.type==='finance.importReceipts')setImportRows([]);if(original?.command?.type==='finance.payment.save')setPaymentOpen(false);toast('原操作结果已核对');}}catch(error){if(alive.current&&activeScope.current===bound)setFailure(error instanceof Error?error.message:'原请求核对失败');}finally{if(alive.current&&activeScope.current===bound){operation.current=false;setWorking(false);}}};
  const columns: Column<MistReceipt>[] = [
    { key: 'd', header: '到账', width: '96px', render: item => <b className="mist-cell-strong">{item.date}</b> },
    { key: 'p', header: '付款方 / 附言', width: 'minmax(180px,2fr)', render: item => <><div className="mist-obj-name" style={{ fontSize: 13.5 }}>{item.payer}</div><span className="mist-cell-sub"><Mono>{item.ref}</Mono></span></> },
    { key: 'a', header: '金额', width: '120px', align: 'right', sortValue: item => item.amount, render: item => <><b className="mist-cell-strong mist-num">{fmt(item.amount, 2)}</b><span className="mist-cell-sub">{item.currency}{uiText(" · 余 ")}{fmt(item.remaining, 2)}</span></> },
    { key: 's', header: '状态', width: '124px', render: item => {const display=financeReceiptDisplay(item,fundingRows,allocations);return <Pill tone={display.tone}>{uiText(display.label)}</Pill>;} },
  ];
  const exportRows = () => {
    if (tab === 'pay') downloadMistCsv('付款凭证.csv', ['凭证', '日期', '收款方', '金额', '币种', '附言'], payments.map(item => [item.code, item.date, item.payee, item.amount, item.currency, item.ref]));
    else if (tab === 'inv') downloadMistCsv('发票台账.csv', ['发票', '订单', '客户', '金额', '未收余额', '币种', '到期日', '状态'], visibleInvoices.map(item => [item.code, item.order, item.customer, item.amount, isPendingFinanceMistInvoice(item)?'待财务确认':item.open, item.currency, item.due, isPendingFinanceMistInvoice(item)?'待财务确认':isActiveMistInvoice(item)?'有效':'已作废']));
    else downloadMistCsv('核销明细.csv', ['流水', '发票', '核销金额', '币种', '时间', '操作人'], allocations.map(item => [receipts.find(receipt => receipt.id === item.receiptId)?.code ?? state?.partialReceipts?.find(receipt => receipt.id === item.receiptId)?.code ?? item.receiptId, invoices.find(invoice => invoice.id === item.invoiceId)?.code ?? item.invoiceId, item.amount, item.currency, item.createdAt, item.actor]));
    toast('已导出当前台账');
  };
  if(area==='records'&&route.detail==='full'&&route.id)return <FinanceRecords onReceipt={openReceipt}/>;
  return <MistPage>
    <PageHeader eyebrow={uiText("财务与成本 · 财务")} title={uiText("财务管理")}
      actions={<>{(area==='receivables'||area==='records')&&<>{area==='records'&&canVoucher&&<Button icon={Upload} disabled={busy} onClick={()=>fileInput.current?.click()}>{uiText("导入流水")}</Button>}{canVoucher&&<Button icon={Upload} disabled={busy||!canVoucher} onClick={() => tab === 'pay'||area==='records' ? setPaymentOpen(true) : fileInput.current?.click()}>{uiText(tab === 'pay'||area==='records' ? '登记付款' : '导入流水')}</Button>}{area==='receivables'&&<Button icon={Download} onClick={exportRows}>{uiText("导出")}</Button>}</>}<Button disabled={busy} onClick={()=>void refresh()}>{uiText("刷新")}</Button></>} />
    <AccessHiddenNotice keys={['receivables','receipts','payments','payables','funding']} />
    <FinanceEntrances state={state} area={area} onChange={openArea} accounts={canSeeAccounts}/>
    {sourceInvoiceId&&<Banner tone={sourceInvoice?'neutral':'bad'} title={sourceInvoice?sourceInvoice.code:'来源发票不可用'} actions={sourceInvoice?<Button onClick={()=>go('invoices',sourceInvoice.id)}>{uiText('返回发票')}</Button>:undefined}>{sourceInvoice?`${sourceInvoice.customer} · ${isPendingFinanceMistInvoice(sourceInvoice)?uiText('待财务确认'):`${fmt(sourceInvoice.open,2)} ${sourceInvoice.currency}`}`:undefined}</Banner>}
    <input ref={fileInput} hidden type="file" accept=".csv,text/csv" aria-label={uiText("银行流水文件")} disabled={!canVoucher||busy} onChange={async event => { const input=event.target,file=input.files?.[0];if(!file||busy||!canVoucher)return;const bound=scope,sequence=++fileSequence.current;setWorking(true);setFailure('');try{const rows=parseMistReceiptCsv(await fileText(file));if(alive.current&&activeScope.current===bound&&fileSequence.current===sequence&&routeScope.isCurrent()){setImportRows(rows);setFileName(file.name);}}catch(problem){if(alive.current&&activeScope.current===bound&&fileSequence.current===sequence&&routeScope.isCurrent())setFailure(problem instanceof Error?problem.message:'文件读取失败');}finally{input.value='';if(alive.current&&activeScope.current===bound&&fileSequence.current===sequence)setWorking(false);} }} />
    {(failure || error) && (failure || error)!==presentedError && !fundingDialog && !reversal && !paymentOpen && !importRows.length && <Banner tone="bad" title={uiText("操作尚未完成")} actions={error ? <Button onClick={() => void refresh()}>{uiText("重试")}</Button> : undefined}>{failure || error}</Banner>}
    {sourceOrder&&deposit&&<Banner title={uiText('来源订单 '+sourceOrder.code)} actions={<Button onClick={()=>go('orders/detail',sourceOrder.id)}>{uiText("返回来源订单")}</Button>}>{uiText(deposit.required===null?'合同付款方式或定金比例尚未明确，不能判定定金已满足。':deposit.status==='not_required'?'当前合同付款方式不适用T/T定金门槛。':`合同定金要求 ${fmt(deposit.required,2)} ${sourceOrder.currency} · 已核实归属 ${fmt(deposit.received,2)} ${sourceOrder.currency}`)}</Banner>}
    {unknownTarget&&<Banner tone="warn" title={uiText("未找到目标票据或流水")} actions={<Button onClick={()=>go('payment-vouchers')}>{uiText("返回财务台账")}</Button>}>{uiText("请从本公司重新选择，未自动切换到其他流水。")}</Banner>}
    {pending&&!saving&&<Banner tone="warn" title={uiText("上一次操作结果待核对")} actions={<Button disabled={working||saving} onClick={()=>void resolvePending()}>{uiText("核对原操作结果")}</Button>}>{uiText("核对原请求后再继续操作。")}</Banner>}
    {hasInvoiceFilter&&tab==='inv'&&<Banner title={uiText(overdueScope?'当前仅显示对应范围的逾期未结发票':'当前仅显示对应范围的未结发票')} actions={<Button onClick={()=>go('payment-vouchers')}>{uiText("查看全部发票")}</Button>}/>}
    {area==='receivables'?<>
    <SummaryBar items={[
      { label: '待核销到账', value: state?.partialReceipts?.length ? '—' : fmt(pendingAmount, 2), unit: state?.partialReceipts?.length ? undefined : displayCurrency, hint: state?.partialReceipts?.length ? '部分到账余额不可见' : otherPending || `${pendingReceipts.length} 笔流水` },
      { label: '本月已核销', value: fmt(cashTotal(monthAllocations.filter(item => item.currency === displayCurrency).map(item=>item.amount)),2), unit: displayCurrency, hint: `${monthAllocations.length} 条本月核销记录` },
      { label: '未认领', value: state?.partialReceipts?.length ? '—' : unclaimedCount, unit: state?.partialReceipts?.length ? undefined : '笔', hint: state?.partialReceipts?.length ? '部分到账余额不可见' : unclaimedCount?'需联系付款方':'暂无待认领流水', hintTone: unclaimedCount?'bad':undefined },
      { label: '逾期应收', value: fmt(cashTotal(overdueInvoices.filter(item=>item.currency===displayCurrency).map(item=>item.open)),2), unit: displayCurrency, hint: '按发票余额统计', hintTone: 'warn' }]} />
    {suggestions.length > 0 && <div className="mist-section"><Banner tone="ai" icon={Sparkles} title={ui`小竹匹配了 ${suggestions.length} 笔到账`} actions={canFund?<Button size="sm" variant="ai" disabled={busy} onClick={() => void execute({ type: 'finance.acceptSuggestions', payload: { receiptIds: suggestions.map(item => item.id) } }, result => toast(`已采纳 ${Number(result.applied??0)} 条核销建议`))}>{uiText("全部采纳")}</Button>:undefined} /></div>}
    {state&&<FinanceDevBilling state={state} canInvoice={session.hasPermission(MIST_FINANCE_SCOPES.invoice)} busy={busy} execute={execute} />}
    <Tabs<'recv' | 'pay' | 'inv'> value={tab} onChange={setTab} options={[{ value: 'recv', label: '收款核销', count: pendingReceipts.length }, { value: 'pay', label: '付款凭证', count: payments.length }, { value: 'inv', label: '发票', count: visibleInvoices.length }]} />
    {tab === 'pay' ? <Card><DataTable density={density} ariaLabel={uiText("付款凭证")} loading={loading} rows={payments} rowKey={item => item.id} empty={<EmptyState icon={Landmark} title={uiText("还没有付款凭证")} action={canVoucher?<Button disabled={busy} onClick={() => setPaymentOpen(true)}>{uiText("登记付款")}</Button>:undefined} />} columns={[
      { key: 'code', header: '凭证', render: item => <Mono>{item.code}</Mono> }, { key: 'date', header: '日期', render: item => item.date }, { key: 'payee', header: '收款方', render: item => item.payee },
      { key: 'amount', header: '金额', align: 'right', render: item => `${fmt(item.amount, 2)} ${item.currency}` }, { key: 'ref', header: '附言', render: item => item.ref },
      { key: 'reverse', header: '冲回', width: '120px', render: item => {const blocked=state?mistPaymentReverseBlock(state,item):null;if(item.reversalOf)return <Pill tone="neutral">{uiText("反向凭证")}</Pill>;if(payments.some(row=>row.reversalOf===item.id))return <Pill tone="warn">{uiText("已冲回")}</Pill>;return blocked?<span className="mist-note">{uiText(item.amount>0?'应付页冲回':'—')}</span>:!canVoucher?null:<Button size="sm" disabled={busy} onClick={()=>openReversal('payment',item.id,`${item.code} · ${fmt(item.amount,2)} ${item.currency} · ${item.payee}`)}>{uiText("冲回")}</Button>;} },
    ]} /></Card> : tab === 'inv' ? <Card><DataTable density={density} ariaLabel={uiText("发票")} loading={loading} rows={visibleInvoices} rowKey={item => item.id} onRowClick={item => setInvoiceId(item.id)} columns={[
      { key: 'id', header: '发票', width: 'minmax(180px,2fr)', render: (item: MistInvoice) => <ObjectInvoice item={item} /> },
      { key: 'customer', header: '客户', width: '1fr', render: item => item.customer },
      { key: 'amount', header: '票面金额', width: '120px', align: 'right', sortValue: item => item.amount, render: item => `${fmt(item.amount, 2)} ${item.currency}` },
      { key: 'open', header: '未收余额', width: '120px', align: 'right', sortValue: item => item.open, render: item => isPendingFinanceMistInvoice(item)?uiText('待财务确认'):`${fmt(item.open, 2)} ${item.currency}` },
      { key: 'due', header: '到期日', width: '110px', render: item => item.due },
    ]} /></Card> : <div className="mist-detail" data-layout="main-rail" style={{ gridTemplateColumns: 'minmax(0,1fr) 380px' }}>
      <Card><DataTable density={density} ariaLabel={uiText("到账流水")} loading={loading} rows={receipts} rowKey={item => item.id} columns={columns} selectedKey={receipt?.id} onRowClick={item => setSel(item.id)} empty={<EmptyState title={uiText(state?.partialReceipts?.length ? '没有完整可见的银行流水' : '还没有银行流水')} action={<Button disabled={!canVoucher||busy} onClick={() => fileInput.current?.click()}>{uiText("导入流水")}</Button>} />} footer={<span>{state?.partialReceipts?.length ? ui`完整可见 ${receipts.length} 笔` : ui`${receipts.length} 笔流水`}</span>} />{(state?.partialReceipts?.length ?? 0)>0 && <div className="mist-card-body mist-col" role="list" aria-label={uiText("部分可见到账")}><b>{uiText("部分可见到账")}</b>{state!.partialReceipts!.map(item=><div className="mist-row" role="listitem" key={item.id}><Mono>{item.code}</Mono><span>{item.date} · {item.payer}</span><span className="mist-spacer"/><span>{uiText("本范围已核销")} {fmt(item.visibleAllocatedAmount,2)} {item.currency}</span>{item.hiddenCount>0 && <span>{ui`另有 ${item.hiddenCount} 笔其他范围业务`}</span>}</div>)}</div>}</Card>
      <Card><CardHeader title={uiText("核销到发票")} sub={receipt && <Mono>{receipt.code}</Mono>} tools={receiptDisplay && <Pill tone={receiptDisplay.tone}>{uiText(receiptDisplay.label)}</Pill>} />
        {receipt ? <><div className="mist-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Facts items={[{ label: '未分配金额', value: <span className="mist-num">{fmt(receipt.remaining, 2)} {receipt.currency}</span> }, { label: '付款方', value: receipt.payer }]} />
          <div className="mist-section"><span className="mist-eyebrow">{uiText("订单定金与客户余额")}</span>
            {canFund&&<Button disabled={busy||!canFund} onClick={()=>openFunding(receipt)}>{uiText("关联订单定金 / 客户余额")}</Button>}
            {fundingRows.filter(row=>row.receiptId===receipt.id).map(row=><div className="mist-col" key={row.id}><b>{uiText(row.orderId?state?.orders.find(order=>order.id===row.orderId)?.code||'来源订单':state?.customers.find(customer=>customer.id===row.customerId)?.name+' · 客户款归属')}</b><span className="mist-note">{uiText("归属登记 ")}{fmt(row.amount,2)} {row.currency} · {uiText(row.state==='active'?'已登记归属':'已释放')} · {row.note}</span><div className="mist-row mist-module-actions">{row.orderId&&<Button size="sm" onClick={()=>go('orders/detail',row.orderId!)}>{uiText("打开订单")}</Button>}{row.state==='active'&&<><Button size="sm" disabled={busy||!canFund} onClick={()=>openFunding(receipt,row)}>{uiText("调整归属")}</Button><Button size="sm" disabled={busy||!canFund} onClick={()=>openFunding(receipt,row,true)}>{uiText("释放归属")}</Button></>}</div></div>)}
          </div>
          <span className="mist-eyebrow">{uiText("候选发票")}</span><div className="mist-choices" role="radiogroup" aria-label={uiText("选择待核销发票")} style={{ ['--mist-choice-cols' as string]: 1 }}>
            {candidates.map(item => <button key={item.id} type="button" role="radio" aria-checked={pick === item.id} className="mist-choice" disabled={busy} onClick={() => setPick(item.id)}><b><Mono>{item.code}</Mono>{item.id === receipt.suggest && receipt.confidence && <Pill tone="ai" plain>{receipt.confidence}{uiText("% 匹配")}</Pill>}<span className="mist-radio" /></b><small>{item.customer} · {item.order}{uiText(" · 未收 ")}{fmt(item.open, 2)} {item.currency}</small></button>)}
            {!candidates.length && <EmptyState compact title={uiText("没有可核销发票")} />}
          </div>
          {needsPayerBasis&&<Field label={uiText("付款方关系依据")} required><OptionInput ariaLabel="付款方关系依据" options={PAYER_RELATIONS} disabled={busy||!canFund} value={payerBasis} onChange={setPayerBasis}/></Field>}
          {invoice&&<Field label={uiText("本次核销金额")} required hint={ui`最多 ${fmt(maximumAllocation,2)} ${receipt.currency}`} error={allocationAmount===null?'金额须大于零、最多两位小数且不超过可分配余额':undefined}><TextInput aria-label={uiText("本次核销金额")} type="number" min="0.01" step="0.01" value={allocationInput} disabled={busy||!canFund} onChange={e=>setAllocationInput(e.target.value)}/></Field>}
          {invoice&&allocationAmount!==null&&<div className="mist-banner" data-tone="neutral"><Tile icon={Link2} size="sm"/><div><b>{uiText("本次分配 ")}{fmt(allocationAmount,2)} {receipt.currency}</b><p>{uiText("核销后流水未分配 ")}{fmt((Math.round(receipt.remaining*100)-Math.round(allocationAmount*100))/100,2)} {receipt.currency}{uiText(" · 发票未收 ")}{fmt((Math.round(invoice.open*100)-Math.round(allocationAmount*100))/100,2)} {invoice.currency}</p></div></div>}
          <div className="mist-col"><span className="mist-eyebrow">{uiText("到账用途")}</span>{allocations.filter(a=>a.receiptId===receipt.id).map(a=><div className="mist-row mist-module-actions" key={a.id}><Mono>{invoices.find(i=>i.id===a.invoiceId)?.code||a.invoiceId}</Mono><span className="mist-num">{fmt(a.amount,2)} {a.currency}</span><Button size="sm" onClick={()=>setInvoiceId(a.invoiceId)}>{uiText("查看核销票据")}</Button><Button size="sm" disabled={busy||!canFund} onClick={()=>openReversal('allocation',a.id,`${receipt.code} → ${invoices.find(i=>i.id===a.invoiceId)?.code||a.invoiceId} · ${fmt(a.amount,2)} ${a.currency}`)}>{uiText("核销冲回")}</Button></div>)}
            {state&&factoryReceiptUses(state,receipt.id).map(use=><div key={use.id} className="mist-row"><span>{uiText('工厂补偿')} · {use.claimCode} · {fmt(use.amount,2)} {use.currency}</span><Button size="sm" onClick={()=>go('claims',use.claimId)}>{uiText('查看索赔案件')}</Button></div>)}
            {(state?.financeReversals??[]).filter(r=>r.kind==='allocation'&&r.receiptId===receipt.id).map(r=><div className="mist-col" key={r.id}><div className="mist-row mist-module-actions"><Pill tone="neutral">{uiText("已冲回")}</Pill><Mono>{invoices.find(i=>i.id===r.invoiceId)?.code||r.invoiceId}</Mono><span className="mist-num">{fmt(r.amount,2)} {r.currency}</span></div><span className="mist-note">{r.at} · {r.actor} · {r.reason}</span></div>)}
            </div>
        </div><CardFooter><span className="mist-spacer" />{canFund&&<Button variant="primary" iconRight={ArrowRight} loading={busy} disabled={busy||!canFund||!invoice || receipt.remaining <= 0||allocationAmount===null||needsPayerBasis&&!payerBasis.trim()} onClick={confirm}>{uiText(receipt.remaining <= 0 ? '已核销' : '确认核销')}</Button>}</CardFooter></> : <EmptyState compact title={uiText("请选择一笔到账流水")} />}
      </Card>
    </div>}
    </>:area==='records'?<FinanceRecords onReceipt={openReceipt}/>:area==='payables'?<FinancePayables/>:<FinanceAccounts/>}
    <Dialog open={!!fundingDialog} onClose={()=>{if(!busy){setFundingDialog(null);setFailure('');}}} title={uiText(fundingDialog?.release?'释放资金归属':'关联订单定金 / 客户余额')} description={uiText(fundingReceipt?`${fundingReceipt.code} · 原始到账 ${fmt(fundingReceipt.amount,2)} ${fundingReceipt.currency}`:'')} footer={<><Button disabled={busy} onClick={()=>{setFundingDialog(null);setFailure('');}}>{uiText("取消")}</Button><Button variant="primary" loading={busy} disabled={busy||!canFund} onClick={()=>{
      if(!fundingDialog||!funding.note.trim())return setFailure('请填写资金归属或释放依据。');
      if(fundingDialog.release){void execute({type:'funding.release',payload:{id:fundingDialog.id!,note:funding.note}},()=>{setFundingDialog(null);toast('资金归属已释放，原到账和核销事实保留');});return;}
      if(!funding.customerId||!Number.isFinite(Number(funding.amount))||Number(funding.amount)<=0)return setFailure('请选择归属客户并填写大于零的归属金额。');
      void execute({type:'funding.assign',payload:{id:fundingDialog.id,receiptId:fundingDialog.receiptId,customerId:funding.customerId,orderId:funding.orderId||null,amount:Number(funding.amount),note:funding.note}},()=>{setFundingDialog(null);toast('资金归属已保存，尚未核销发票');});
    }}>{uiText("保存资金归属")}</Button></>}>
      {failure&&<Banner tone="bad" title={uiText("资金归属尚未保存")}>{failure}</Banner>}
      <FormGrid>{!fundingDialog?.release&&<><Field label={uiText("归属客户")} required><Select aria-label={uiText("归属客户")} value={funding.customerId} options={[{value:'',label:'请选择客户'},...(state?.customers??[]).map(c=>({value:c.id,label:c.name}))]} onChange={e=>setFunding({...funding,customerId:e.target.value,orderId:''})}/></Field><Field label={uiText("归属订单")}><Select aria-label={uiText("归属订单")} value={funding.orderId} options={[{value:'',label:'暂不归属订单 · 客户余额'},...(state?.orders??[]).filter(o=>o.customerId===funding.customerId&&o.currency===fundingReceipt?.currency).map(o=>({value:o.id,label:o.code}))]} onChange={e=>setFunding({...funding,orderId:e.target.value})}/></Field><Field label={uiText("归属金额")} required><TextInput aria-label={uiText("归属金额")} type="number" min="0.01" step="0.01" value={funding.amount} onChange={e=>setFunding({...funding,amount:e.target.value})}/></Field></>}<Field label={uiText("资金归属依据")} required full><TextInput aria-label={uiText("资金归属依据")} value={funding.note} onChange={e=>setFunding({...funding,note:e.target.value})}/></Field></FormGrid>
    </Dialog>
    <Dialog open={!!reversal} onClose={()=>{if(!busy)setReversal(null);}} title={uiText(reversal?.kind==='allocation'?'核销冲回':'付款冲回')} description={uiText(reversal?.title)} footer={<><Button disabled={busy} onClick={()=>setReversal(null)}>{uiText("取消")}</Button><Button variant="primary" loading={busy} disabled={busy||!reversalReason.trim()||(reversal?.kind==='allocation'?!canFund:!canVoucher)} onClick={submitReversal}>{uiText("确认冲回")}</Button></>}>
      {failure&&<Banner tone="bad" title={uiText("尚未冲回")}>{failure}</Banner>}{reversal?.kind==='payment'&&<Banner title={uiText("仅冲回账务记录，不发起银行退款")} />}
      <FormGrid><Field label={uiText("冲回原因")} required full><TextInput aria-label={uiText("冲回原因")} value={reversalReason} onChange={event=>setReversalReason(event.target.value)} placeholder={uiText("例如：核错发票、重复登记")}/></Field></FormGrid>
    </Dialog>
    <Dialog open={importRows.length > 0} onClose={() => { if (!busy) setImportRows([]); }} title={uiText("导入银行流水")} description={uiText(fileName)} width={860}
      footer={<><Button onClick={() => setImportRows([])} disabled={busy}>{uiText("取消")}</Button><Button variant="primary" loading={busy} disabled={busy||!canVoucher} onClick={() => void execute({ type: 'finance.importReceipts', payload: { receipts: importRows, ...(importAccount ? { accountId: importAccount } : {}) } }, result => { setImportRows([]); setImportAccount(''); toast(`银行流水已导入 ${Number(result.imported??0)} 笔${Number(result.skipped??0)?`，跳过 ${Number(result.skipped)} 笔已存在流水`:''}`); })}>{uiText("确认导入 ")}{importRows.length}{uiText(" 笔")}</Button></>}>
      {failure && <Banner tone="bad" title={uiText("导入失败")}>{failure}</Banner>}{importRows.some(row=>!row.ref)&&<Banner tone="warn" title={uiText("部分流水没有银行参考号")}>{uiText("无法据此识别跨文件重复；请核实确为独立到账后再确认导入。")}</Banner>}{(()=>{const curs=[...new Set(importRows.map(r=>r.currency))],first=importRows.reduce((m,r)=>r.date<m?r.date:m,importRows[0]?.date||''),opts=(state?.bankAccounts??[]).filter(a=>!a.closed&&curs.length===1&&a.currency===curs[0]&&a.openingDate<=first);return <FormGrid><Field label={uiText("入账账户")} hint={uiText(curs.length>1?'本批流水含多个币种，导入后逐笔归属账户':'同一对账单可直接归属到账户；也可导入后逐笔归属')}><Select aria-label={uiText("入账账户")} value={importAccount} disabled={curs.length!==1} onChange={e=>setImportAccount(e.target.value)} options={[{value:'',label:'暂不归属（导入后逐笔归属）'},...opts.map(a=>({value:a.id,label:`${a.code} · ${a.name} · ${a.currency}`}))]}/></Field></FormGrid>;})()}<DataTable density={density} rows={importRows} rowKey={item => String(importRows.indexOf(item))} columns={[{ key: 'payer', header: '付款方', render: item => item.payer }, { key: 'amount', header: '金额', render: item => `${fmt(item.amount, 2)} ${item.currency}` }, { key: 'date', header: '日期', render: item => item.date }, { key: 'ref', header: '附言', render: item => item.ref }]} />
    </Dialog>
    <Dialog open={!!previewInvoice} onClose={() => {setInvoiceId(null);if(route.id){const {id,view,...target}=route;go(view,undefined,target);}}} title={uiText(previewInvoice?.code ?? '发票')} footer={previewInvoice && <><Button onClick={()=>go('invoices',previewInvoice.id)}>{uiText('查看发票')}</Button>{(previewInvoice.opening?<Button onClick={() => go('crm', previewInvoice.customerId, { customerId: previewInvoice.customerId })}>{uiText("打开客户档案")}</Button>:previewInvoice.devId?<Button onClick={() => go('development/detail', previewInvoice.devId)}>{uiText("打开开发案")}</Button>:<Button onClick={() => go('orders/detail', previewInvoice.orderId)}>{uiText("打开关联订单")}</Button>)}</>}>
      {previewInvoice && <KeyValue items={[{ label: '客户', value: previewInvoice.customer }, { label: previewInvoice.opening?'来源':previewInvoice.devId?'来源开发案':'订单', value: previewInvoice.opening?'期初未结应收':previewInvoice.order, mono: true }, { label: '票面金额', value: `${fmt(previewInvoice.amount, 2)} ${previewInvoice.currency}` }, { label: '未收余额', value: isPendingFinanceMistInvoice(previewInvoice)?uiText('待财务确认'):`${fmt(previewInvoice.open, 2)} ${previewInvoice.currency}` }, { label: '到期日', value: previewInvoice.due }, ...(previewInvoice.voidedAt?[{label:'状态',value:'已作废'},{label:'作废时间',value:previewInvoice.voidedAt},{label:'作废依据',value:previewInvoice.voidReason||'未记录'}]:[])]} />}
    </Dialog>
    <Drawer open={paymentOpen} onClose={() => { if (!busy) setPaymentOpen(false); }} title={uiText("登记付款凭证")} footer={<Button variant="primary" loading={busy} disabled={busy||!canVoucher} onClick={() => {
      if (!payment.date || !payment.payee.trim() || !Number.isFinite(Number(payment.amount)) || Number(payment.amount) <= 0) { setFailure('请填写付款日期、收款方和大于零的金额。'); return; }
      const { accountId, ...fields } = payment; void execute({ type: 'finance.payment.save', payload: { ...fields, amount: Number(payment.amount), ...(accountId ? { accountId } : {}) } }, () => { setPaymentOpen(false); setPayment(value => ({ ...value, payee: '', amount: '', ref: '' })); toast('付款凭证已保存'); });
    }}>{uiText("保存付款")}</Button>}>
      {failure && <Banner tone="bad" title={uiText("付款尚未保存")}>{failure}</Banner>}<Banner title={uiText("只登记已发生的付款事实")}>{uiText("不发起银行付款，也不分配到供应商应付；供应商货款请在“应付待办”登记供应商付款。")}</Banner><FormGrid>
        <Field label={uiText("付款日期")} required><TextInput type="date" value={payment.date} onChange={event => setPayment(value => ({ ...value, date: event.target.value }))} /></Field>
        <Field label={uiText("收款方")} required><TextInput value={payment.payee} onChange={event => setPayment(value => ({ ...value, payee: event.target.value }))} /></Field>
        <Field label={uiText("金额")} required><TextInput type="number" min="0.01" step="0.01" value={payment.amount} onChange={event => setPayment(value => ({ ...value, amount: event.target.value }))} /></Field>
        <Field label={uiText("币种")}><Select aria-label={uiText("币种")} value={payment.currency} onChange={event => setPayment(value => ({ ...value, currency: event.target.value, accountId: '' }))} options={withCurrent(CURRENCIES, payment.currency)} /></Field>
        <Field label={uiText("付款账户")} hint={uiText("付出的公司银行账户；也可之后再归属")}><Select aria-label={uiText("付款账户")} value={payment.accountId || ''} onChange={event => setPayment(value => ({ ...value, accountId: event.target.value }))} options={[{ value: '', label: '暂不归属' }, ...(state?.bankAccounts ?? []).filter(a => !a.closed && a.currency === payment.currency && a.openingDate <= payment.date).map(a => ({ value: a.id, label: `${a.code} · ${a.name}` }))]} /></Field>
        <Field label={uiText("附言")} full><TextInput value={payment.ref} onChange={event => setPayment(value => ({ ...value, ref: event.target.value }))} /></Field>
      </FormGrid>
    </Drawer>
  </MistPage>;
}
function ObjectInvoice({ item }: { item: MistInvoice }) { return <><Mono>{item.code}</Mono>{!isActiveMistInvoice(item)&&<Pill tone="bad">{uiText("已作废")}</Pill>}{isPendingFinanceMistInvoice(item)&&<Pill tone="accent">{uiText("待财务确认")}</Pill>}<span className="mist-cell-sub">{item.order}</span></>; }
