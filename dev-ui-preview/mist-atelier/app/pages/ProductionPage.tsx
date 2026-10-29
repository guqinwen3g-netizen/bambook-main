import { productionQuantityBasis } from '../../../../server/src/shared/mistProductionQuantity';
import { productionName } from './businessNames';
import { RecordDisclosure } from './modules/pageKit';
import { Events } from './modules/fulfillmentKit';
import { interfaceLocale } from '../../../../services/interfaceLanguage';
import { uiText, ui } from '../../../../services/interfaceLanguage';
import {businessNow,businessToday} from '../runtime/businessClock';
/** T8 生产看板：沿用原 Mist 卡片和布局，拖动保存到公司共享数据。 */
import React from 'react';
import { AlertTriangle, CalendarRange, Factory } from 'lucide-react';
import { Banner, Button, Card, CardHeader, Checklist, DataTable, Drawer, Dropdown, EmptyState, Field, FormGrid, Kanban, KeyValue, Meter, MistPage, Mono, ObjectCell, PageHeader, Pill, SearchField, Segmented, SummaryBar, TextArea, TextInput, Thumb, Toolbar, useToast } from '../../../../components/mist';
import type { MistProduction } from '../../../../server/src/shared/mistWorkspace';
import { IMG, PROD_COLUMNS } from '../data';
import { useNav } from '../nav';
import { useMistWorkspace } from '../runtime/workspace';
import { useMistSession } from '../runtime/auth';
import { ModuleEditorPage, ModuleEditorDialog, type ModuleEditorSpec } from './modules/ModuleWorkbench';
import { PRODUCTION_HOLD_CATEGORIES, fulfillmentProductionColumn, type FulfillmentSizeQuantity } from '../../../../server/src/shared/mistFulfillment';
import { mistDate } from './OrderListPage';
import { productionNok, productionReleaseGate, productionRiskText } from './productionGate';
import { productionSampleRequirements } from '../../../../server/src/shared/mistProductionSamples';
import { workspaceMembers } from '../runtime/members';
import { ProductionSampleNotes } from './ProductionSampleNotes';
import { breakdownSizeTotals, type OrderLineBreakdown } from '../../../../server/src/shared/mistOrderBreakdown';
import { useDevice } from '../runtime/devicePreferences';

export function parseProductionSizes(value:string):FulfillmentSizeQuantity[] { if(!value.trim())return []; return value.split(/\n+/).map(line=>{ const match=line.trim().match(/^(.+?)[:：]\s*(\d+(?:\.\d{1,4})?)$/);if(!match)throw new Error('尺码数量请逐行填写，例如 M:10');return {size:match[1].trim(),quantity:Number(match[2])}; }); }
export type ProductionRange = 'week' | 'month' | 'all';
export function productionWindow(range: ProductionRange, now = businessNow(), items: Pick<MistProduction,'startDate'|'due'>[] = []): {start:Date;end:Date} {
  if (range === 'all') {
    const dates = items.flatMap(item => [item.startDate ? mistDate(item.startDate) : null, mistDate(item.due)]).filter((date):date is Date=>!!date);
    if (dates.length) {
      const start = new Date(dates.reduce((earliest,date)=>Math.min(earliest,date.getTime()),Infinity)); start.setHours(0,0,0,0);
      const end = new Date(dates.reduce((latest,date)=>Math.max(latest,date.getTime()),-Infinity)); end.setHours(0,0,0,0); end.setDate(end.getDate()+1);
      return {start,end};
    }
    return productionWindow('month',now);
  }
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  if (range === 'month') start.setDate(1); else start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  if (range === 'month') end.setMonth(end.getMonth() + 1); else end.setDate(end.getDate() + 7);
  return { start, end };
}
export function ProductionPage() {
  const density = useDevice('density');
  const { go, route } = useNav(), toast = useToast(), session = useMistSession();
  const [operation,setOperation]=React.useState<ModuleEditorSpec|null>(null);
  const { state, workspace, loading, error, run, refresh } = useMistWorkspace();
  const [q, setQ] = React.useState(''), [orderId, setOrderId] = React.useState('all');
  const [range, setRange] = React.useState<ProductionRange>('week'), [gantt, setGantt] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(route.productionId ?? null);
  const [draft, setDraft] = React.useState({ pct: 0, risk: '', note: '', startDate: '', due: '' });
  const [busy, setBusy] = React.useState(false), [failure, setFailure] = React.useState('');
  const items = (state?.productions ?? []).filter(item => !item.closed).map(item => ({ ...item, col: state ? fulfillmentProductionColumn(state, item) : item.col, name: state ? productionName(state, item) : item.name })), selected = items.find(item => item.id === selectedId);
  const fact=state?.fulfillment.productionFacts?.find(item=>item.productionId===selectedId);
  const quantityBasis=state&&selected?productionQuantityBasis(state,selected.orderId):null;
  const selectedDomain=state?.orders.find(order=>order.id===selected?.orderId)?.type;
  const finishedSupply=!!selected&&!!state?.fulfillment.purchases.some(purchase=>purchase.id===selected.sourcePurchaseId&&purchase.kind==='finished');
  const releaseLabel=finishedSupply?'放行供货':selectedDomain==='fabric'?'放行量产':'放行开产';
  const sampleChecks = fact?.release?.sampleChecks ?? (state && selected ? productionSampleRequirements(state, selected, selectedDomain === 'fabric' ? 'pioneer' : 'pp').flatMap(row => row.evidence ? [row.evidence] : []) : []);
  const productionUnit=(item:MistProduction)=>state?.orderLines.find(line=>line.id===item.lineId&&line.orderId===item.orderId)?.unit||'单位未记录';
  const canPlan=session.hasPermission('production:write'), canRelease=session.hasPermission('orders:write');
  const sizesText=(sizes:FulfillmentSizeQuantity[])=>sizes.map(size=>`${size.size}:${size.quantity}`).join('\n');
  const openPlan=()=>selected&&setOperation({title:'登记生产分支尺码',fields:[{key:'sizes',label:'实际生产尺码与计划数量（每行 尺码:数量）',type:'textarea',required:true}],initialValues:{sizes:sizesText(fact?.sizes?.length?fact.sizes:breakdownSizeTotals((state?.orderLines.find(line=>line.id===selected.lineId) as {breakdown?:OrderLineBreakdown}|undefined)?.breakdown))},submit:values=>run({type:'fulfillment.production.plan',payload:{productionId:selected.id,sizes:parseProductionSizes(String(values.sizes||''))}})});
  const openRelease=()=>selected&&setOperation({title:releaseLabel,fields:[{key:'note',label:'放行依据',type:'textarea',required:true}],initialValues:{note:''},submit:values=>run({type:'fulfillment.production.release',payload:{productionId:selected.id,note:String(values.note||'')}})});
  const openComplete=()=>selected&&setOperation({title:'登记最终实际完工',fields:[{key:'quantity',label:'最终实际完工数量',type:'number',required:true,min:0,step:'0.0001'},...(quantityBasis?.scope==='size'?[{key:'sizes',label:'各实际尺码数量（每行 尺码:数量）',type:'textarea' as const,required:true}]:[]),{key:'date',label:'实际完工日',type:'date',required:true},{key:'evidence',label:'最终点数及完工依据',type:'textarea',required:true}],initialValues:{quantity:'',sizes:'',date:businessToday(),evidence:''},submit:values=>run({type:'fulfillment.production.complete',payload:{productionId:selected.id,quantity:Number(values.quantity),sizeQuantities:parseProductionSizes(String(values.sizes||'')),date:String(values.date||''),evidence:String(values.evidence||''),fileIds:[]}})});
  const openAccept=()=>selected&&setOperation({title:'登记客户接受数量差异',fields:[{key:'note',label:'客户明确接受最终数量的依据',type:'textarea',required:true}],initialValues:{note:''},submit:values=>run({type:'fulfillment.production.acceptCompletion',payload:{productionId:selected.id,note:String(values.note||'')}})});
  const gateMembers=workspaceMembers(workspace,state,session.user);
  const gate=state&&selected?productionReleaseGate(state,selected,{actorId:session.user?.id,actorName:session.user?.displayName||'',members:gateMembers.map(member=>({...member,active:true}))}):[],gateBlocked=gate.find(item=>!item.ok),nok=state&&selected?productionNok(state,selected):undefined;
  const openHold=()=>selected&&setOperation({title:'异常暂停生产',description:`${selected.code} · 暂停期间不能推进进度、登记完工、出运或加工收货；QC 仍可检查。`,fields:[{key:'category',label:'暂停类别',type:'select',required:true,options:Object.entries(PRODUCTION_HOLD_CATEGORIES).map(([value,label])=>({value,label}))},{key:'reason',label:'暂停原因',type:'textarea',required:true}],initialValues:{category:'quality',reason:''},submitLabel:'确认暂停',submit:values=>run({type:'fulfillment.production.hold',payload:{productionId:selected.id,category:String(values.category) as keyof typeof PRODUCTION_HOLD_CATEGORIES,reason:String(values.reason||'').trim()}})});
  const openResume=()=>selected&&setOperation({title:'恢复生产',description:fact?.hold?`暂停于 ${fact.hold.at.slice(0,10)} · ${PRODUCTION_HOLD_CATEGORIES[fact.hold.category]}：${fact.hold.reason}`:undefined,fields:[{key:'note',label:'恢复依据',type:'textarea',required:true}],initialValues:{note:''},submitLabel:'恢复生产',submit:values=>run({type:'fulfillment.production.resume',payload:{productionId:selected.id,note:String(values.note||'').trim()}})});
  const openDelay=()=>selected&&setOperation({title:'登记延期',description:`${selected.code} · 原交期 ${selected.due}。延期说明写入本分支风险，看板与订单可见。`,fields:[{key:'due',label:'新交期',type:'date',required:true},{key:'reason',label:'延期原因',type:'textarea',required:true},{key:'informed',label:'是否已告知客户',type:'select',required:true,options:[{value:'yes',label:'已告知客户'},{value:'no',label:'尚未告知客户'}]}],initialValues:{due:'',reason:'',informed:'no'},submitLabel:'保存延期',submit:values=>{const due=String(values.due||''),reason=String(values.reason||'').trim();if(!due||!reason)throw new Error('请填写新交期与延期原因');if(due<=selected.due)throw new Error('新交期须晚于原交期 '+selected.due);return run({type:'production.update',payload:{id:selected.id,pct:selected.pct,due,risk:`延期 ${selected.due} → ${due}：${reason}（${values.informed==='yes'?'已告知客户':'尚未告知客户'}）`}});}});
  const units=new Map<string,number>();for(const item of items)if(item.col!=='done')units.set(productionUnit(item),(units.get(productionUnit(item))||0)+item.qty);
  const unreleased=items.filter(item=>!state?.fulfillment.productionFacts?.some(fact=>fact.productionId===item.id&&fact.release)).length;
  const nokCount=state?items.filter(item=>productionNok(state,item)).length:0;
  React.useEffect(() => { setSelectedId(route.productionId ?? null); if(route.productionId){setRange('all');setOrderId('all');setQ('');} }, [route.productionId]);
  React.useEffect(() => { if (selected) setDraft({ pct: selected.pct, risk: productionRiskText(selected), note: '', startDate: selected.startDate ?? '', due: selected.due }); setFailure(''); }, [selected?.id]);
  const matching = items.filter(item => !(orderId !== 'all' && item.orderId !== orderId || q && !`${item.name} ${item.code} ${item.factory} ${item.order}`.toLowerCase().includes(q.toLowerCase())));
  const window = productionWindow(range,businessNow(),matching);
  const shown = matching.filter(item => {
    if(range==='all')return true;
    const due = mistDate(item.due), start = item.startDate ? mistDate(item.startDate) : null;
    if (!due) return true;
    if (start) return start.getTime() < window.end.getTime() && due.getTime() >= window.start.getTime();
    return due.getTime() >= window.start.getTime() && due.getTime() < window.end.getTime();
  });
  const domains=new Set(shown.map(item=>state?.orders.find(order=>order.id===item.orderId)?.type));
  const domain=domains.size===1?[...domains][0]:undefined;
  const stageTitles:Record<string,string>=domain==='garment'?{done:'已完成'}:domain==='fabric'?{cut:'备货',sew:'加工',finish:'整理',qc:'尾检',done:'已完成'}:{cut:'准备',sew:'制作',finish:'整理',qc:'尾检',done:'已完成'};
  const columns=PROD_COLUMNS.map(column=>({...column,title:stageTitles[column.id]||column.title}));
  const risks = shown.filter(item => productionRiskText(item));
  const move = async (id: string, col: string) => {
    if (busy || !canPlan || !PROD_COLUMNS.some(column => column.id === col)) return;
    const item = items.find(item => item.id === id); if (!item || item.col === col) return;
    setBusy(true); setFailure('');
    try { await run({ type: 'production.move', payload: { id, col: col as MistProduction['col'] } }); toast(`${item.code} 已移至${columns.find(column => column.id === col)?.title}`); }
    catch (problem) { setFailure(problem instanceof Error ? problem.message : '工序未保存，请重试'); } finally { setBusy(false); }
  };
  const position = (date: string) => Math.max(0, Math.min(100, ((mistDate(date)?.getTime() ?? window.start.getTime()) - window.start.getTime()) / (window.end.getTime() - window.start.getTime()) * 100));
  if(operation)return operation.fields.length>3?<ModuleEditorPage spec={operation} onClose={()=>setOperation(null)}/>:<ModuleEditorDialog spec={operation} onClose={()=>setOperation(null)}/>;
  return <MistPage width="wide">
    <PageHeader eyebrow={uiText("订单履约 · 生产")} title={uiText("生产进度")}
      actions={<><Segmented<ProductionRange> ariaLabel={uiText("范围")} value={range} onChange={setRange} options={[{ value: 'week', label: '本周' }, { value: 'month', label: '本月' },{ value:'all',label:'全部' }]} /><Button icon={CalendarRange} onClick={() => setGantt(value => !value)}>{uiText(gantt ? '看板' : '甘特图')}</Button></>} />
    <SummaryBar items={[{label:'在手分支',value:items.filter(item=>item.col!=='done').length,unit:'个',hint:[...units].map(([unit,qty])=>`${qty.toLocaleString(interfaceLocale(), { maximumFractionDigits: 4 })} ${unit}`).join(' · ')||'暂无在手数量'},{label:'待业务放行',value:unreleased,unit:'个'},{label:'QC NOK',value:nokCount,unit:'个',hintTone:nokCount?'bad':undefined},{label:'生产风险',value:items.filter(item=>productionRiskText(item)).length,unit:'个'},{label:'已完成',value:items.filter(item=>item.col==='done').length,unit:'个'}]}/>
    {(failure || error) && <Banner tone="bad" title={uiText("生产记录未保存")} actions={error ? <Button onClick={() => void refresh()}>{uiText("重试")}</Button> : undefined}>{failure || error}</Banner>}
    {risks.length > 0 && <div className="mist-section"><Banner tone="warn" icon={AlertTriangle} title={ui`${risks.length} 个生产单有风险`} actions={<Button size="sm" onClick={() => { setSelectedId(risks[0].id); }}>{uiText("查看生产单")}</Button>} /></div>}
    <Toolbar><SearchField value={q} onChange={setQ} placeholder={uiText("款式、生产单或工厂")} /><Dropdown label={uiText("订单")} value={orderId} onChange={setOrderId} options={[{ value: 'all', label: '全部' }, ...(state?.orders ?? []).map(order => ({ value: order.id, label: order.code }))]} /></Toolbar>
    {!shown.length && !loading ? <Card><EmptyState title={uiText(q || orderId !== 'all' ? '没有匹配的生产单' : range==='all'?'暂无生产单':`本${range === 'week' ? '周' : '月'}没有计划中的生产单`)} action={range!=='all'||q||orderId!=='all'?<Button onClick={() => { setQ(''); setOrderId('all'); setRange('all'); }}>{uiText("查看全部生产单")}</Button>:undefined} /></Card> : gantt ? <Card><CardHeader title={uiText("生产计划")} sub={uiText(`${window.start.toLocaleDateString(interfaceLocale())} — ${new Date(window.end.getTime() - 1).toLocaleDateString(interfaceLocale())}`)} /><DataTable density={density} ariaLabel={uiText("生产甘特图")} rows={shown} loading={loading} rowKey={item => item.id} onRowClick={item => setSelectedId(item.id)} columns={[
      { key: 'object', header: '生产单', width: 'minmax(180px,1fr)', render: item => <ObjectCell name={item.name} meta={<Mono>{item.code}</Mono>} /> },
      { key: 'factory', header: '工厂', width: '120px', render: item => item.factory },
      { key: 'schedule', header: '计划时间', width: 'minmax(220px,2fr)', render: item => <><svg width="100%" height="28" viewBox="0 0 100 12" role="img" aria-label={uiText(item.startDate ? `${item.startDate} 至 ${item.due}` : `交期 ${item.due}，未记录开始日`)}>
        {item.startDate ? <line x1={position(item.startDate)} y1="6" x2={position(item.due)} y2="6" stroke="var(--mist-accent)" strokeWidth="3" strokeLinecap="round" /> : <circle cx={position(item.due)} cy="6" r="2" fill="var(--mist-accent)" />}</svg><span className="mist-cell-sub">{uiText(item.startDate ? `${item.startDate} → ` : '交期 ')}{item.due}</span></> },
      { key: 'progress', header: '进度', width: '100px', render: item => `${item.pct}%` },
    ]} /></Card> : <Kanban columns={columns.map(column => ({ ...column, items: shown.filter(item => item.col === column.id) }))} itemKey={item => item.id}
      onMove={busy||!canPlan ? undefined : (id, col) => { void move(id, col); }} onOpen={item => setSelectedId(item.id)} renderCard={item => <>
        <div className="mist-row"><Thumb src={IMG[item.img]} size="sm" /><div style={{ minWidth: 0 }}><b>{item.name}</b><div className="mist-obj-meta" title={uiText(`${item.code} · ${item.order} · ${state?.orderLines.find(line=>line.id===item.lineId)?.style||'条目不可用'}`)}><Mono>{item.code}</Mono> · {item.order} · {state?.orderLines.find(line=>line.id===item.lineId)?.style||'条目不可用'}</div></div></div>
        <Meter segments={[{ value: item.pct, tone: item.pct === 100 ? 'ok' : 'accent' }]} caption={uiText(`${item.pct}% · ${item.qty.toLocaleString(interfaceLocale(), { maximumFractionDigits: 4 })} ${productionUnit(item)}`)} />
        <div className="mist-kb-card-foot"><Factory className="mist-icon" data-size="xs" />{item.factory}<span className="mist-spacer" />{state&&productionNok(state,item) ? <Pill tone="bad">QC NOK</Pill> : productionRiskText(item) ? <Pill tone="warn">{uiText(productionRiskText(item).length>14?productionRiskText(item).slice(0,14)+'…':productionRiskText(item))}</Pill> : !state?.fulfillment.productionFacts?.some(fact=>fact.productionId===item.id&&fact.release) ? <Pill tone="neutral">{uiText("待放行")}</Pill> : <span>{item.due}</span>}</div>
      </>} />}
    <Drawer open={!!selected} onClose={() => { if (!busy) setSelectedId(null); }} title={uiText(selected?.code ?? '生产单')} sub={uiText(selected?.name)} size="lg"
      footer={<><Button disabled={busy} onClick={() => selected && go('orders/detail', selected.orderId, { orderLineId: selected.lineId, productionId: selected.id })}>{uiText("打开关联订单")}</Button>{canPlan&&<Button variant="primary" loading={busy} onClick={async () => {
        if (!selected || busy) return; setBusy(true); setFailure('');
        try { await run({ type: 'production.update', payload: { id: selected.id, pct: draft.pct, risk: draft.risk, note: draft.note, startDate: draft.startDate || undefined, due: draft.due } }); setSelectedId(null); toast('生产记录已保存'); }
        catch (problem) { setFailure(problem instanceof Error ? problem.message : '生产记录保存失败'); } finally { setBusy(false); }
      }}>{uiText("保存进度")}</Button>}</>}>
      <div className="mist-col" data-module-detail>{failure && <Banner tone="bad" title={uiText("保存失败")}>{failure}</Banner>}
      {nok&&<Banner tone="bad" title={uiText("生产 QC NOK")} actions={<Button onClick={()=>go('qc-workbench',nok.id,{productionId:selected!.id,orderLineId:selected!.lineId,section:'production'})}>{uiText("查看 QC 结论")}</Button>}>{nok.code}{uiText(" · 待复验与业务确认")}</Banner>}
      {fact?.hold&&<Banner tone="warn" title={uiText("生产已异常暂停")}>{PRODUCTION_HOLD_CATEGORIES[fact.hold.category]}：{fact.hold.reason}（{fact.hold.actor} · {fact.hold.at.slice(0,10)}{uiText("）")}</Banner>}
      {!fact?.release&&<div className="mist-col" style={{gap:6}} data-release-gate><b className="mist-h3">{uiText(finishedSupply?'供货核对':selectedDomain==='fabric'?'量产核对':'开产核对')}</b><Checklist items={gate.map(item=>({label:item.label,done:item.ok,note:item.detail,noteTone:item.ok?undefined:'bad'}))}/></div>}
      <ProductionSampleNotes key={selectedId} checks={sampleChecks} />
      <KeyValue items={[{label:finishedSupply?'供货状态':'开产状态',value:fact?.hold||nok?'已暂停':fact?.release?'已放行':'待放行'},...(selectedDomain==='garment'?[{label:'计划尺码',value:fact?.sizes.length?sizesText(fact.sizes):'未登记'}]:[]),{label:'完工状态',value:fact?.completion?'已完工':'未完工'},...(fact?.completion?[{label:'完工数量',value:`${fact.completion.quantity} ${selected?productionUnit(selected):''}`}]:[]),...(fact?.completion&&selected&&fact.completion.quantity!==selected.qty?[{label:'差异确认',value:fact.customerAcceptance?'已确认':'待确认'}]:[])]}/>
      {fact?.release && <RecordDisclosure title="放行记录"><KeyValue items={[{label:'经办人',value:fact.release.actor},{label:'时间',value:fact.release.at}]} />{fact.release.note}</RecordDisclosure>}
      {fact?.completion && <RecordDisclosure title="完工记录">{fact.completion.evidence}</RecordDisclosure>}
      {selected&&<RecordDisclosure title="跟进与操作记录"><Events entity="production" id={selected.id}/></RecordDisclosure>}
      {fact?.customerAcceptance && <RecordDisclosure title="差异确认记录">{fact.customerAcceptance.note}</RecordDisclosure>}
      <div className="mist-row">{canPlan&&selectedDomain==='garment'&&!fact?.release&&<Button onClick={openPlan}>{uiText("登记生产尺码")}</Button>}{canRelease&&!fact?.release&&<Button disabled={!!gateBlocked} title={uiText(gateBlocked?`${gateBlocked.label}：${gateBlocked.detail}`:undefined)} onClick={openRelease}>{uiText(releaseLabel)}</Button>}{canPlan&&fact?.release&&!fact?.completion&&<Button disabled={!quantityBasis} title={!quantityBasis?uiText('请先核对并批准订单数量口径'):undefined} onClick={openComplete}>{uiText("登记最终完工数量")}</Button>}{canRelease&&fact?.completion&&selected&&fact.completion.quantity!==selected.qty&&!fact.customerAcceptance&&<Button onClick={openAccept}>{uiText("客户接受数量差异")}</Button>}{canPlan&&selected&&selected.col!=='done'&&<Button onClick={openDelay}>{uiText("登记延期")}</Button>}{canPlan&&fact?.hold&&<Button onClick={openResume}>{uiText("恢复生产")}</Button>}{canPlan&&fact?.release&&!fact.hold&&!fact.completion&&selected?.col!=='done'&&<Button onClick={openHold}>{uiText("异常暂停")}</Button>}<Button onClick={()=>selected&&go('samples',undefined,{productionId:selected.id})}>{uiText("准备本分支样品")}</Button><Button onClick={()=>selected&&go('qc-workbench',undefined,{productionId:selected.id,orderLineId:selected.lineId,section:'production'})}>{uiText("本分支生产QC")}</Button></div>{canPlan?<FormGrid><Field label={uiText("生产进度（%）")}><TextInput type="number" min={0} max={100} value={draft.pct} onChange={event => setDraft(value => ({ ...value, pct: Number(event.target.value) }))} /></Field><Field label={uiText("计划开始日")}><TextInput type="date" value={draft.startDate} onChange={event => setDraft(value => ({ ...value, startDate: event.target.value }))} /></Field><Field label={uiText("计划交期")}><TextInput type="date" value={mistDate(draft.due)?.toISOString().slice(0, 10) ?? draft.due} onChange={event => setDraft(value => ({ ...value, due: event.target.value }))} /></Field><Field label={uiText("风险")}><TextInput value={draft.risk} onChange={event => setDraft(value => ({ ...value, risk: event.target.value }))} /></Field><Field label={uiText("跟进记录")} full><TextArea value={draft.note} onChange={event => setDraft(value => ({ ...value, note: event.target.value }))} /></Field></FormGrid>:selected?<KeyValue items={[{label:'生产进度',value:selected.pct+'%'},{label:'计划开始日',value:selected.startDate||'—'},{label:'计划交期',value:selected.due},{label:'风险',value:productionRiskText(selected)||'—'}]}/>:null}
      </div>
    </Drawer>
  </MistPage>;
}
