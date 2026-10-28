import { uiText, ui } from '../../../../services/interfaceLanguage';
import {businessNow} from '../runtime/businessClock';
/** Four finance entrances. Only existing workspace facts are projected; unavailable accounting capabilities stay explicit. */
import React from 'react';
import { ArrowDownLeft, ArrowUpRight, Landmark, ReceiptText } from 'lucide-react';
import { Banner, Button, Card, CardHeader, DataTable, EmptyState, Facts, Mono, ObjectCell, Pill, SearchField, Segmented, StatCard, StatGrid, Tabs, Toolbar, type Column } from '../../../../components/mist';
import type { MistState, MistReceipt, MistPayment } from '../../../../server/src/shared/mistWorkspace';
import { isActiveMistInvoice, mistBankAccountBalances, mistFxLockUsage, type MistFxRecord } from '../../../../server/src/shared/mistWorkspace';
import { AccountAssignDialog, BankAccountDialog, FxAllocateDialog, FxDialog, fxUnallocatedMinor, FxPeriodRatesCard, FxReverseDialog, FxRevaluationCard, AccountStatusCell, accountLabel, editAccountDraft, newAccountDraft, newFxDraft, useBankAccountCommand } from './FinanceBankAccounts';
import { useMistWorkspace } from '../runtime/workspace';
import { useMistSession } from '../runtime/auth';
import { MIST_FINANCE_SCOPES } from '../../../../server/src/shared/mistFinancePermissions';
import { useNav } from '../nav';
import { ActionBar, DetailBlock, DetailBody, ListDetail, ListDetailPage, PreviewSummary, useListDetailRoute } from './modules/pageKit';
import { downloadMistCsv } from './OrderListPage';
import { platformBusinessDate } from '../../../../server/src/shared/mistPlatform';
import { supplierPayableSummary } from '../../../../server/src/shared/mistPayables';
export { FinancePayables } from './FinancePayables';

export type FinanceArea = 'receivables' | 'payables' | 'records' | 'accounts';
export function financeArea(section?: string): FinanceArea { return section?.startsWith('records:') ? 'records' : section === 'payables' || section === 'records' || section === 'accounts' ? section : 'receivables'; }
export function financeCurrencyTotals(rows: ReadonlyArray<{ currency: string; amount: number }>) {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.currency, (totals.get(row.currency) || 0) + Math.round(row.amount * 100));
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, minor]) => ({ currency, amount: minor / 100 }));
}
const money = (amount: number, currency: string) => `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
const totalsText = (totals: ReturnType<typeof financeCurrencyTotals>) => totals.map(t => money(t.amount, t.currency)).join(' · ') || '暂无已登记金额';

export function FinanceEntrances({ state, area, onChange, accounts = true }: { state: MistState | null; area: FinanceArea; onChange: (area: FinanceArea) => void; accounts?: boolean }) {
  const open = financeCurrencyTotals((state?.invoices || []).filter(i => isActiveMistInvoice(i) && i.open > 0).map(i => ({ currency: i.currency, amount: i.open })));
  const unallocated = financeCurrencyTotals((state?.receipts || []).filter(r => r.remaining > 0).map(r => ({ currency: r.currency, amount: r.remaining })));
  const payable = financeCurrencyTotals(state ? supplierPayableSummary(state, platformBusinessDate(businessNow())).filter(r => r.open > 0).map(r => ({ currency: r.currency, amount: r.open })) : []);
  const bank = state ? mistBankAccountBalances(state) : null, balances = financeCurrencyTotals((bank?.accounts || []).map(a => ({ currency: a.account.currency, amount: a.balance })));
  const unassigned = bank ? bank.unassigned.receipts + bank.unassigned.payments : 0;
  const amount = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // 多币种时每个币种一行（与报表中心统计卡一致），不折算、不合计。
  const stat = (totals: ReturnType<typeof financeCurrencyTotals>): React.ReactNode => totals.length === 1 ? amount(totals[0].amount) : totals.length ? <span className="mist-stat-lines">{totals.map(t => <span key={t.currency}>{t.currency} {amount(t.amount)}</span>)}</span> : '暂无';
  const foot = (totals: ReturnType<typeof financeCurrencyTotals>, fallback: string) => totals.length ? '' : fallback;
  return <div className="mist-section" data-finance-entrances>
    <StatGrid>
      <StatCard icon={ReceiptText} label={uiText("应收未收")} value={stat(open)} unit={uiText(open.length === 1 ? open[0].currency : undefined)} foot={foot(open, totalsText(open))} onClick={() => onChange('receivables')} />
      <StatCard icon={ArrowUpRight} label={uiText("应付未付")} value={stat(payable)} unit={uiText(payable.length === 1 ? payable[0].currency : undefined)} foot={foot(payable, '按已登记的供应商票据计算')} onClick={() => onChange('payables')} />
      <StatCard icon={ArrowDownLeft} label={uiText("未分配到账")} value={stat(unallocated)} unit={uiText(unallocated.length === 1 ? unallocated[0].currency : undefined)} foot={foot(unallocated, totalsText(unallocated))} onClick={() => onChange('records')} />
      {accounts && <StatCard icon={Landmark} label={uiText("公司账户余额")} value={bank?.accounts.length ? stat(balances) : '—'} unit={uiText(balances.length === 1 ? balances[0].currency : undefined)} foot={bank?.accounts.length ? (unassigned ? ui`待归属 · ${unassigned}` : undefined) : uiText('未登记账户')} onClick={() => onChange('accounts')} />}
    </StatGrid>
    <Tabs<FinanceArea> value={area} onChange={onChange} options={[{ value: 'receivables', label: '应收待办' }, { value: 'payables', label: '应付待办' }, { value: 'records', label: '收付款记录' }, ...(accounts ? [{ value: 'accounts' as const, label: '账户与余额' }] : [])]} />
  </div>;
}

type FinanceRecordFilter = 'all' | 'receipt' | 'payment' | 'unassigned';
const recordFilter = (section?: string): FinanceRecordFilter => { const value=section?.split(':')[1]; return value==='receipt'||value==='payment'||value==='unassigned'?value:'all'; };
const recordSection = (filter: FinanceRecordFilter) => filter==='all'?'records':`records:${filter}`;
type FinanceRecord = { id: string; code: string; date: string; party: string; amount: number; currency: string; ref: string; direction: 'receipt' | 'payment'; receipt?: MistReceipt; payment?: MistPayment };
export function financeRecords(state: MistState | null): FinanceRecord[] {
  return [
    ...(state?.receipts || []).map(r => ({ id: r.id, code: r.code, date: r.date, party: r.payer, amount: r.amount, currency: r.currency, ref: r.ref, direction: 'receipt' as const, receipt: r })),
    ...(state?.payments || []).map(p => ({ id: p.id, code: p.code, date: p.date, party: p.payee, amount: p.amount, currency: p.currency, ref: p.ref, direction: 'payment' as const, payment: p })),
  ].sort((a, b) => b.date.localeCompare(a.date) || a.code.localeCompare(b.code));
}
export function factoryReceiptUses(state:MistState|null,receiptId:string){
 return (state?.platform?.claims??[]).flatMap(claim=>(claim.coordination?.recoveries??[]).flatMap(recovery=>(recovery.settlements??[]).filter(entry=>entry.kind==='receipt'&&!entry.reversed&&entry.receiptId===receiptId).map(entry=>({id:entry.id,claimId:claim.id,claimCode:claim.code,supplier:recovery.supplierName,amount:entry.amount,currency:entry.currency,date:entry.date,actor:entry.by}))));
}
export function FinanceRecords({ onReceipt }: { onReceipt: (id: string) => void }) {
  const { state, loading } = useMistWorkspace(), { route, go } = useNav(), session=useMistSession(),canReconcile=session.hasPermission(MIST_FINANCE_SCOPES.reconcile),accountsVisible=session.hasPermission(MIST_FINANCE_SCOPES.voucher);
  const [query, setQuery] = React.useState(''), [direction, setDirection] = React.useState<FinanceRecordFilter>(()=>recordFilter(route.section)), [currency, setCurrency] = React.useState('all');
  const [selected, setSelected] = React.useState(route.id || ''), [drawer, setDrawer] = React.useState(!!route.id), full = useListDetailRoute();
  React.useEffect(() => { setSelected(route.id || ''); setDrawer(!!route.id); }, [route.id]);
  React.useEffect(()=>setDirection(recordFilter(route.section)),[route.section]);
  const changeDirection=(value:FinanceRecordFilter)=>{setDirection(value);go('payment-vouchers',undefined,{section:recordSection(value)},{keepScroll:true});};
  const rows = financeRecords(state), partials = (state?.partialReceipts ?? []).filter(r => (direction === 'all' || direction === 'receipt') && (currency === 'all' || currency === r.currency) && (!query.trim() || `${r.code} ${r.payer} ${r.date}`.toLowerCase().includes(query.trim().toLowerCase()))), currencies = [...new Set([...rows.map(r => r.currency), ...(state?.partialReceipts ?? []).map(r => r.currency)])].sort();
  const knownAccounts=new Set((state?.bankAccounts||[]).map(a=>a.id));
  const isUnassigned=(r:FinanceRecord)=>!knownAccounts.has((r.receipt||r.payment)?.accountId||'');
  const shown = rows.filter(r => (direction === 'all' || (direction==='unassigned'?accountsVisible&&isUnassigned(r):r.direction === direction)) && (currency === 'all' || r.currency === currency) && (!query.trim() || `${r.code} ${r.party} ${r.ref} ${r.date}`.toLowerCase().includes(query.trim().toLowerCase())));
  const [assigning, setAssigning] = React.useState(false), { canWrite } = useBankAccountCommand();
  const current = rows.find(r => r.id === selected), currentRow = current?.receipt || current?.payment, account = (state?.bankAccounts || []).find(a => a.id === currentRow?.accountId), supplierPayment = (state?.payables?.payments || []).find(p => p.paymentId === current?.id), allocations = (state?.allocations || []).filter(a => a.receiptId === current?.id);
  const refundCredit=current?.payment?state?.platform?.credits.find(note=>state.platform?.creditApplications.some(row=>row.creditId===note.id&&row.paymentId===current.id)):undefined;
  const refundClaim=state?.platform?.claims.find(claim=>claim.id===refundCredit?.claimId),factoryUses=current?.receipt?factoryReceiptUses(state,current.id):[];
  const paymentPurpose=refundCredit?ui`客户退款 · ${refundCredit.code}`:uiText(supplierPayment?'供应商付款':'一般付款');
  const columns: Column<FinanceRecord>[] = [
    { key: 'code', header: '流水 / 对方', width: 'minmax(170px,1.5fr)', render: r => <ObjectCell name={<Mono>{r.code}</Mono>} meta={r.party} /> },
    { key: 'date', header: '日期 / 方向', width: '108px', render: r => <span className="mist-col"><span>{r.date}</span><Pill tone={r.direction === 'receipt' ? 'accent' : 'neutral'}>{uiText(r.direction === 'receipt' ? '实际收款' : '付款记录')}</Pill></span> },
    { key: 'amount', header: '原币金额', width: '140px', align: 'right', render: r => <span className="mist-num">{money(r.amount, r.currency)}</span> },
    { key: 'ref', header: '银行参考 / 附言', width: 'minmax(130px,1fr)', hideOnMobile: true, render: r => r.ref || '未填写' },
    ...(accountsVisible ? [{ key: 'account', header: '账户', width: '110px', hideOnMobile: true, render: (r: FinanceRecord) => { const a = (state?.bankAccounts || []).find(x => x.id === (r.receipt || r.payment)?.accountId); return a ? <Mono>{a.code}</Mono> : <Pill tone="warn">{uiText("未归属")}</Pill>; } }] : []),
  ];
  const detail = current ? <DetailBody data-finance-record={current.id} heading={<h2 className="mist-h2">{current.code}</h2>}>
    <Facts items={[{ label: '方向', value: current.direction === 'receipt' ? '实际收款' : '已登记付款记录' }, { label: '交易日期', value: current.date }, { label: '付款方 / 收款方', value: current.party }, { label: '原币金额', value: money(current.amount, current.currency) }, { label: '银行参考 / 附言', value: current.ref || '未填写' }, ...(accountsVisible ? [{ label: '公司银行账户', value: account ? `${account.code} · ${accountLabel(account)}` : '未归属' }] : [])]} />
    <ActionBar actions={[
      { label: account ? '调整归属账户' : '归属账户', onClick: () => setAssigning(true), hidden:!canWrite },
      ...(current.receipt ? [{label:'查看收款核销',onClick:()=>onReceipt(current.id)},...(allocations.length&&canReconcile?[{label:'核销冲回',onClick:()=>onReceipt(current.id)}]:[])] : supplierPayment ? [{label:'查看应付分配',onClick:()=>go('payment-vouchers',supplierPayment.id,{section:'payables'})},{label:'付款冲回',onClick:()=>go('payment-vouchers',supplierPayment.id,{section:'payables'}),hidden:!canWrite||!canReconcile}] : refundClaim ? [{label:'查看索赔案件',onClick:()=>go('claims',refundClaim.id)}] : []),
    ]} />
    {current.receipt && <DetailBlock title={uiText("到账用途")}><Facts items={[{ label: '当前未分配', value: money(current.receipt.remaining, current.currency) }, { label: '原始到账', value: money(current.amount, current.currency) }]} />
      {allocations.map(a => { const i = state?.invoices.find(i => i.id === a.invoiceId); return <div className="mist-col" key={a.id}><div className="mist-row mist-module-actions"><Mono>{i?.code || '来源票据未找到'}</Mono><span className="mist-num">{money(a.amount, a.currency)}</span>{i && <Button size="sm" onClick={() => go('payment-vouchers', i.id)}>{uiText("查看票据")}</Button>}</div><span className="mist-note">{a.createdAt} · {a.actor}{uiText(a.payerBasis ? ` · ${a.payerBasis}` : '')}</span></div>; })}
      {factoryUses.map(use=><div className="mist-row" key={use.id}><span>{uiText('工厂补偿')} · {use.claimCode}</span><span>{money(use.amount,use.currency)}</span><Button size="sm" onClick={()=>go('claims',use.claimId)}>{uiText('查看索赔案件')}</Button></div>)}
    </DetailBlock>}
    {!current.receipt&&<Facts items={[{label:'业务来源',value:paymentPurpose}]}/>}
  </DetailBody> : <EmptyState compact title={uiText(route.id ? '未找到交易记录' : '交易详情')} />;
  const assignDialog = assigning && state && current && currentRow && <AccountAssignDialog state={state} kind={current.direction} row={currentRow} onClose={() => setAssigning(false)} />;
  if (full.active && current) return <ListDetailPage backLabel="收付款记录" onBack={full.back} after={assignDialog}>{detail}</ListDetailPage>;
  const summary = current ? <PreviewSummary openLabel="打开交易详情" onOpen={() => full.open(current.id)} data={{
    code: current.code, status: <Pill tone={current.direction === 'receipt' ? 'accent' : 'neutral'}>{uiText(current.direction === 'receipt' ? '实际收款' : '付款记录')}</Pill>,
    title: money(current.amount, current.currency), description: current.party,
    facts: [
      { label: '交易日期', value: current.date }, { label: '银行参考 / 附言', value: current.ref || '未填写' },
      { label: '归属账户', value: account ? `${account.code} · ${account.name}` : <Pill tone="warn">{uiText("未归属")}</Pill> },
      ...(current.receipt ? [{ label: '未分配', value: money(current.receipt.remaining, current.currency) }] : [{label:'业务来源',value:paymentPurpose}]),
    ] }} /> : null;
  return <div className="mist-col">
    <Toolbar><SearchField value={query} onChange={setQuery} placeholder={uiText("搜索流水号、对方、附言或日期")} /><Button onClick={() => downloadMistCsv('收付款记录.csv', ['流水', '方向', '日期', '对方', '金额', '币种', '附言'], shown.map(r => [r.code, r.direction === 'receipt' ? '收款' : '付款', r.date, r.party, r.amount, r.currency, r.ref]))}>{uiText("导出当前记录")}</Button></Toolbar>
    <Segmented<FinanceRecordFilter> value={direction} onChange={changeDirection} options={[{ value: 'all', label: `全部 · ${rows.length}` }, { value: 'receipt', label: `收款 · ${rows.filter(r => r.direction === 'receipt').length}` }, { value: 'payment', label: `付款 · ${rows.filter(r => r.direction === 'payment').length}` },...(accountsVisible?[{value:'unassigned' as const,label:`待归属 · ${rows.filter(isUnassigned).length}`}]:[])]} />
    <Segmented value={currency} onChange={setCurrency} options={[{ value: 'all', label: '全部币种' }, ...currencies.map(c => ({ value: c, label: c }))]} />
    {assignDialog}
    <ListDetail drawerOpen={drawer && !!current} drawerTitle={current?.code || '交易详情'} onDrawerClose={() => setDrawer(false)} detail={detail} summary={summary} list={<Card><DataTable ariaLabel={uiText("收付款记录")} rows={shown} columns={columns} loading={loading} selectedKey={selected} rowKey={r => r.id} onRowClick={r => { setSelected(r.id); setDrawer(true); go('payment-vouchers', r.id, { section: recordSection(direction) }, { keepScroll: true }); }} empty={<EmptyState title={uiText(rows.length ? '没有符合条件的收付款记录' : '还没有收付款记录')} action={rows.length ? <Button onClick={() => { setQuery(''); changeDirection('all'); setCurrency('all'); }}>{uiText("清除筛选")}</Button> : undefined} />} /></Card>} />
    {partials.length>0 && <Card><CardHeader title={uiText('部分可见到账')} /><div className="mist-card-body mist-col" role="list" aria-label={uiText('部分可见到账')}>{partials.map(item=><div className="mist-row" role="listitem" key={item.id}><Mono>{item.code}</Mono><span>{item.date} · {item.payer}</span><span className="mist-spacer"/><span>{uiText('本范围已核销')} {money(item.visibleAllocatedAmount,item.currency)}</span>{item.hiddenCount>0 && <span>{ui`另有 ${item.hiddenCount} 笔其他范围业务`}</span>}</div>)}</div></Card>}
  </div>;
}

export function financeCustomerReceivables(state: MistState | null) {
  const groups = new Map<string, { customerId: string; name: string; currency: string; amount: number; invoices: number }>();
  for (const i of state?.invoices || []) if (isActiveMistInvoice(i) && i.open > 0) {
    const order = state?.orders.find(o => o.id === i.orderId), customerId = order?.customerId || '', key = JSON.stringify([customerId || i.customer, i.currency]);
    const old = groups.get(key) || { customerId, name: i.customer, currency: i.currency, amount: 0, invoices: 0 };
    old.amount += Math.round(i.open * 100); old.invoices++; groups.set(key, old);
  }
  return [...groups.entries()].map(([id, g]) => ({ id, ...g, amount: g.amount / 100 }));
}
export function FinanceAccounts() {
  const { state, loading } = useMistWorkspace(), { go } = useNav(); const customers = financeCustomerReceivables(state);
  const { canWrite } = useBankAccountCommand(), [editing, setEditing] = React.useState<ReturnType<typeof newAccountDraft> | null>(null);
  const [fx, setFx] = React.useState<ReturnType<typeof newFxDraft> | null>(null), [reversing, setReversing] = React.useState<MistFxRecord | null>(null), [linking, setLinking] = React.useState<MistFxRecord | null>(null);
  const fxRows = [...(state?.fxRecords || [])].sort((a, b) => b.date.localeCompare(a.date) || b.code.localeCompare(a.code)), accountCode = (id?: string) => (state?.bankAccounts || []).find(a => a.id === id)?.code || '';
  const currencies = new Set((state?.bankAccounts || []).map(a => a.currency)), canSettle = currencies.size >= 2;
  const bank = state ? mistBankAccountBalances(state) : { accounts: [], unassigned: { receipts: 0, payments: 0 } }, unassigned = bank.unassigned.receipts + bank.unassigned.payments;
  const used = (id?: string) => !!id && !!bank.accounts.find(a => a.account.id === id && a.receiptCount + a.paymentCount > 0);
  return <div className="mist-col">
    {!bank.accounts.length ? <Banner tone="warn" title={uiText("还没有登记公司银行账户")} />
      : unassigned > 0 ? <Banner tone="warn" title={ui`待归属 · ${unassigned}`}>{uiText("余额未含待归属流水")}</Banner> : null}
    <ActionBar actions={[{ label: '新增账户', onClick: () => setEditing(newAccountDraft()), hidden:!canWrite }, { label: '查看未归属流水', onClick: () => go('payment-vouchers', undefined, { section: 'records:unassigned' }), hidden: !unassigned }, { label: '登记锁汇', onClick: () => setFx(newFxDraft('lock', state)), hidden:!canWrite }, { label: '登记结汇', onClick: () => setFx(newFxDraft('settlement', state)), hidden:!canWrite, reason:canSettle ? undefined : '先登记原币和本币两个不同币种的账户' }]} />
    <Card><DataTable ariaLabel={uiText("公司银行账户")} rows={bank.accounts} rowKey={r => r.account.id} loading={loading} onRowClick={r => { if (canWrite) setEditing(editAccountDraft(r.account)); }} columns={[
      { key: 'account', header: '账户', width: 'minmax(200px,1.6fr)', render: r => <ObjectCell name={<><Mono>{r.account.code}</Mono> {r.account.name}</>} meta={`${r.account.bankName} · ${r.account.accountNo} · 期初日 ${r.account.openingDate}`} /> },
      { key: 'opening', header: '期初', width: '150px', align: 'right', hideOnMobile: true, render: r => <span className="mist-num">{money(r.account.openingBalance, r.account.currency)}</span> },
      { key: 'in', header: '归属到账', width: '150px', align: 'right', hideOnMobile: true, render: r => <span className="mist-num" title={ui`${r.receiptCount} 笔`}>{money(r.receipts, r.account.currency)}</span> },
      { key: 'out', header: '归属付款', width: '150px', align: 'right', hideOnMobile: true, render: r => <span className="mist-num" title={ui`${r.paymentCount} 笔`}>{money(r.payments, r.account.currency)}</span> },
      { key: 'fx', header: '结汇划转', width: '150px', align: 'right', hideOnMobile: true, render: r => <span className="mist-num">{money(r.fxIn - r.fxOut, r.account.currency)}</span> },
      { key: 'balance', header: '账户余额', width: '150px', align: 'right', render: r => <span className="mist-num">{money(r.balance, r.account.currency)}</span> },
      { key: 'status', header: '状态', width: '170px', render: r => <AccountStatusCell account={r.account} balance={r.balance} /> },
    ]} empty={<EmptyState title={uiText("暂无公司银行账户")} description={uiText("点上方“新增账户”登记账户与期初余额。")} />} /></Card>
    {editing && <BankAccountDialog draft={editing} used={used(editing.id)} onClose={() => setEditing(null)} />}
    <Card><DataTable ariaLabel={uiText("锁汇与结汇记录")} rows={fxRows} rowKey={r => r.id} loading={loading} columns={[
      { key: 'code', header: '记录', width: 'minmax(160px,1.2fr)', render: r => <ObjectCell name={<><Mono>{r.code}</Mono> {uiText(r.kind === 'lock' ? '锁汇' : '结汇')}</>} meta={`${r.date} · ${r.ref}${r.kind === 'lock' ? ' · 交割截止 ' + r.settleBy : ''}`} /> },
      { key: 'amount', header: '原币', width: '140px', align: 'right', render: r => <span className="mist-num">{money(r.amount, r.currency)}</span> },
      { key: 'rate', header: '汇率', width: '100px', align: 'right', hideOnMobile: true, render: r => <span className="mist-num" title={uiText(r.kind === 'lock' ? '锁定汇率' : '由水单金额得出')}>{r.rate}</span> },
      { key: 'local', header: '本币', width: '150px', align: 'right', hideOnMobile: true, render: r => <span className="mist-num">{money(r.localAmount, r.localCurrency)}</span> },
      { key: 'bank', header: '银行 / 账户', width: 'minmax(120px,1fr)', hideOnMobile: true, render: r => r.kind === 'lock' ? r.bankName : `${accountCode(r.fromAccountId)} → ${accountCode(r.toAccountId)}${r.lockId ? ' · 交割 ' + ((state?.fxRecords || []).find(x => x.id === r.lockId)?.code || '') : ''}` },
      { key: 'state', header: '状态', width: '150px', render: r => r.reversed ? <Pill tone="neutral">{uiText("已冲回")}</Pill> : r.kind === 'lock' ? (() => { const u = mistFxLockUsage(state!, r.id); return <Pill tone={u.remaining > 0 ? 'accent' : 'ok'}>{uiText(u.remaining > 0 ? `剩余 ${money(u.remaining, r.currency)}` : '已全部交割')}</Pill>; })() : fxUnallocatedMinor(r) > 0 ? <Pill tone="warn">{uiText("未对应到账 ")}{money(fxUnallocatedMinor(r) / 100, r.currency)}</Pill> : <Pill tone="ok">{uiText("已入账 · 已对应到账")}</Pill> },
      { key: 'act', header: '操作', width: '150px', render: r => r.reversed ? <span className="mist-note">{r.reversed.reason}</span> : <span className="mist-row">{r.kind === 'lock' && mistFxLockUsage(state!, r.id).remaining > 0 && canWrite && canSettle && <Button size="sm" onClick={() => setFx(newFxDraft('settlement', state, r.id))}>{uiText("交割")}</Button>}{r.kind === 'settlement' && fxUnallocatedMinor(r) > 0 && canWrite && <Button size="sm" onClick={() => setLinking(r)}>{uiText("对应到账")}</Button>}{canWrite && <Button size="sm" onClick={() => setReversing(r)}>{uiText("冲回")}</Button>}</span> },
    ]} empty={<EmptyState title={uiText("暂无锁汇或结汇记录")} />} /></Card>
    {fx && state && <FxDialog state={state} draft={fx} onClose={() => setFx(null)} />}
    {reversing && <FxReverseDialog record={reversing} onClose={() => setReversing(null)} />}
    {linking && state && <FxAllocateDialog state={state} record={linking} onClose={() => setLinking(null)} />}
    <FxPeriodRatesCard />
    <FxRevaluationCard />
    <Card><DataTable ariaLabel={uiText("客户应收余额（原币）")} rows={customers} rowKey={r => r.id} loading={loading} onRowClick={r => { if (r.customerId) go('payment-vouchers', undefined, { section: 'open', customerId: r.customerId }); }} columns={[
      { key: 'customer', header: '客户', render: r => <ObjectCell name={r.name} meta={r.customerId ? undefined : '缺少来源客户标识，请核对'} /> },
      { key: 'count', header: '未结票据', width: '90px', align: 'right', render: r => r.invoices }, { key: 'amount', header: '未收余额', width: '150px', align: 'right', render: r => money(r.amount, r.currency) },
    ]} empty={<EmptyState title={uiText("暂无未结客户应收")} />} /></Card>
    <Card><div className="mist-card-body mist-col"><h2 className="mist-h2">{uiText("未分配到账（按原币）")}</h2>{financeCurrencyTotals((state?.receipts || []).filter(r => r.remaining > 0).map(r => ({ currency: r.currency, amount: r.remaining }))).map(t => <div className="mist-row" key={t.currency}><Mono>{t.currency}</Mono><span className="mist-num">{money(t.amount, t.currency)}</span><Button onClick={() => go('payment-vouchers', undefined, { section: 'records' })}>{uiText("查看收付款记录")}</Button></div>)}</div></Card>
  </div>;
}
