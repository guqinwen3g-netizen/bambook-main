import { uiText, ui, localizedPageTitle } from '../../../../services/interfaceLanguage';
import { isPendingFinanceMistInvoice, MIST_LOGISTICS_DUTY, type MistState, type MistTarget, type MistTask } from '../../../../server/src/shared/mistWorkspace';
import type { MistReview } from './reviews';
import { addBusinessDays, pendingWeeklyArchive } from '../../../../server/src/shared/mistTeam';
import { shipmentStage } from './shipmentStage';
import { financeReceiptDisplay } from './financeReceiptDisplay';
import { materialDeliveryRows, materialReceiverIds } from '../../../../server/src/shared/mistInternalFabric';
import { developmentVersionSamples } from '../../../../server/src/shared/mistDevelopmentSamples';
import { SETTLEMENT_SCOPES, PAYMENT_REQUEST_SCOPES, settlementReceipts, purchaseRequiresSettlementLink, payableBills, billRequestedUnpaidMinor } from '../../../../server/src/shared/mistPayables';
import { MIST_FINANCE_SCOPES } from '../../../../server/src/shared/mistFinancePermissions';
import { businessDate } from './businessClock';

type CanRead = (view: string) => boolean;
export type MistWorkSource = 'review' | 'qc' | 'shipping' | 'finance' | 'report' | 'material' | 'task';
/**
 * 等我处理的一条事项。module 是它计入的侧栏模块（与模块页「待我处理」同一归属）；
 * 其他公司的审批归到 approvals，只进「我的工作」合计。
 */
export type MistWorkItem = { id: string; source: MistWorkSource; sourceLabel: string; title: string; meta: string; when: string; urgent: boolean; at: string; due?: string; target: MistTarget & { detail?: 'full' }; module: string };
export const MIST_WORK_SOURCE_LABEL: Record<MistWorkSource, string> = { review: '待我审批', qc: 'QC', shipping: '出运', finance: '财务', report: '周报', material: '物料', task: '工作事项' };
export type MistWorkOptions = {
  canRead: CanRead; me: string; today: string; reviews?: MistReview[];
  /** 当前账号是否持有某项权限；不传时岗位事项（按权限分派）一律不算我的。 */
  can?: (permission: string) => boolean;
  /** 本公司；只有本公司的审批按业务模块归类。 */
  workspaceId?: string;
};
const FINANCE_RETURN_DAYS = 30;
/** 不在主导航里的视图归到同组的主模块，保证侧栏数字加起来等于合计。 */
const MODULE_ALIAS: Record<string, string> = { invoices: 'payment-vouchers' };
export const mistWorkModule = (view: string | undefined) => { const base = (view || '').split('/')[0] || 'cockpit'; return MODULE_ALIAS[base] ?? base; };

/** 工作事项是否等我处理：指定给我，或属于我持有权限的岗位。都没写的事项不属于任何人。 */
export function isMyMistTask(task: MistTask, options: Pick<MistWorkOptions, 'me' | 'can' | 'canRead'>) {
  if (task.done) return false;
  const mine = (!!options.me && (task.assigneeIds ?? []).includes(options.me)) || (!!task.permission && !!options.can?.(task.permission));
  return mine && options.canRead(mistWorkModule(task.target?.view));
}
export function mistMyTasks(state: MistState | null | undefined, options: Pick<MistWorkOptions, 'me' | 'can' | 'canRead'>) {
  return (state?.tasks ?? []).map(task=>{
    if(task.kind==='customer-handover'&&task.target.view==='relations'){
      const relation=state?.market.relations.find(row=>row.id===task.target.id),customer=state?.customers.find(row=>row.id===(relation?.customerId||task.target.id));
      if(customer)return {...task,title:localizedPageTitle('接手客户')+' · '+customer.name};
    }
    if(task.target.view==='claims'&&(task.kind?.startsWith('claim-verify:')||task.kind?.startsWith('claim-factory:'))){
      const claim=state?.platform.claims.find(row=>row.id===task.target.id);
      if(claim)return {...task,title:localizedPageTitle(task.kind.startsWith('claim-verify:')?'客诉核实':'工厂回复')+' · '+claim.code};
    }
    if(task.kind?.startsWith('claim-repair-qc:')&&task.target.view==='claims'){
      const claim=state?.platform?.claims.find(row=>row.id===task.target.id),job=state?.platform?.claimGoods.filter(row=>row.claimId===claim?.id).flatMap(row=>row.repairs??[]).find(row=>task.kind==='claim-repair-qc:'+row.id);
      if(claim&&job)return {...task,title:localizedPageTitle('返修复检')+' · '+claim.code,permission:`qc:${job.domain}_chain:write`};
    }
    if(task.kind?.startsWith('claim-repair-return:')&&task.target.view==='inventory')return {...task,title:localizedPageTitle(task.title),target:{...task.target,detail:'full' as const}};
    if(task.kind?.startsWith('claim-inventory:')&&task.target.view==='inventory'){
      const receipt=state?.fulfillment.returnReceipts?.find(row=>row.id===task.target.id);
      const goods=state?.platform.claimGoods.find(row=>task.kind==='claim-inventory:'+row.id);
      if(goods?.destination==='Repair'&&goods.receivedQuantity===goods.quantity){
        const outstanding=(state?.fulfillment.receivedRecords||[]).filter(row=>row.goodsId===goods.id&&!row.releasedRepairId&&!row.disposal);
        // A dedicated return task replaces the parent only while every outstanding lot is outside.
        // The persisted parent remains unfinished and returns when local work is available again.
        if(outstanding.length&&outstanding.every(record=>(goods.repairDispatches||[]).some(trip=>trip.receivedEventId===record.id&&!trip.returned&&state?.tasks.some(child=>!child.done&&child.kind==='claim-repair-return:'+trip.id))))return {...task,done:true};
      }
      if(receipt)return {...task,title:localizedPageTitle('退货处理')+' · '+receipt.code,target:{...task.target,section:'claim:'+receipt.claimId},permission:'inventory:write'};
    }
    if(task.kind?.startsWith('claim-recovery:')&&task.target.view==='claims'){
      const claim=state?.platform?.claims.find(row=>row.id===task.target.id),recovery=claim?.coordination?.recoveries.find(row=>task.kind==='claim-recovery:'+row.id);
      if(claim&&recovery?.state==='Agreed')return {...task,title:localizedPageTitle('工厂补偿')+' · '+claim.code,permission:'invoices:reconcile'};
    }
    return task;
  }).filter(task => {
    if (!isMyMistTask(task, options)) return false;
    // Once a request exists, the shipment supplies the actionable handoff; keep the original task fact intact.
    const shipmentHandoff = task.kind === 'shipping' && task.permission === MIST_LOGISTICS_DUTY && task.target.view === 'orders/detail';
    return !(shipmentHandoff && options.can?.(MIST_LOGISTICS_DUTY) && options.canRead('shipments')
      && state?.fulfillment.shipments.some(shipment => !['cancelled','departed'].includes(shipment.state) && shipment.lines?.some(line => line.orderId === task.target.id)));
  });
}

/** 开发确认存于准确版本；订单样品确认存于 QC 任务，不能互相代替。 */
function sampleBusinessFinished(state: MistState, task: MistState['fulfillment']['qcTasks'][number]): boolean {
  if (task.source.kind !== 'version') {
    if (task.businessConfirmation?.result === 'rejected') return true;
    if (task.businessConfirmation?.result !== 'approved') return false;
    const reportId = task.reportIds.at(-1);
    return !!reportId && task.businessContinued?.reportId === reportId;
  }
  const source = task.source;
  const version = state.versions.find(item => item.id === source.versionId && item.devId === source.devId);
  if (!version) return false;
  const confirmations = version.confirmations ?? [], samples = developmentVersionSamples(state, version);
  const sampleIds = task.sampleId ? [task.sampleId] : samples.map(sample => sample.id);
  if (task.sampleId && !samples.some(sample => sample.id === task.sampleId)) return false;
  // 未指定形态的旧确认只在单一实物范围内有效，不能清掉后来追加的形态。
  const covers = (id: string) => confirmations.some(confirmation => confirmation.samples?.length
    ? confirmation.samples.some(sample => sample.sampleId === id)
    : samples.length <= 1);
  return sampleIds.length ? sampleIds.every(covers) : confirmations.some(confirmation => !confirmation.samples?.length);
}

/**
 * 由业务记录派生、等我处理的事项（不写入公司，原记录状态变化后自动消失）：
 * 待我审批；QC 待认领/处理中（QC 岗）与结果待业务确认（业务岗）；出运承接、单证准备、对客交单及实际出运；
 * 未认领收款、待确认发票（财务岗）；我提交后被退回的付款申请。
 */
export function mistWorkQueue(state: MistState | null | undefined, options: MistWorkOptions): MistWorkItem[] {
  const { canRead, me, reviews = [], today, workspaceId } = options, can = options.can ?? (() => false), items: MistWorkItem[] = [];
  const push = (item: Omit<MistWorkItem, 'sourceLabel' | 'module'> & { module?: string }) => items.push({ ...item, sourceLabel: uiText(MIST_WORK_SOURCE_LABEL[item.source]), when: uiText(item.when), module: item.module ?? mistWorkModule(item.target.view) });
  for (const review of reviews.filter(row => row.status === 'pending' && row.canDecide)) {
    const local = !!workspaceId && review.workspaceId === workspaceId, module = mistWorkModule(review.target?.view);
    push({ id: `review:${review.workspaceId}|${review.id}`, source: 'review', title: localizedPageTitle(review.title), meta: [review.workspaceName, businessDate(review.submittedAt)].filter(Boolean).join(' · '), when: '待审批', urgent: true, at: review.submittedAt,
      target: { view: 'approvals', id: `${review.workspaceId}|${review.id}`, section: 'mine' } as MistTarget, module: local && canRead(module) ? module : 'approvals' });
  }
  if (!state) return items;
  const f = state.fulfillment;
  if (me && canRead('procurement') && can('orders:write') && f.stock && f.stockMovements && f.receipts && f.purchases) {
    // Receiving authority follows the same current-owner rule as the server; no manual task completion.
    for (const row of materialDeliveryRows(state)) {
      if (row.outstanding === '0' || row.delivery.confirmation || !materialReceiverIds(state, row).includes(me)) continue;
      const branch = state.productions.find(item => item.id === row.delivery.productionId && !item.closed);
      const contract = f.purchases.find(item => item.id === branch?.sourcePurchaseId && item.kind === 'processing' && item.state === 'approved');
      const source = f.purchases.find(item => item.id === row.purchaseId);
      if (!contract || !source) continue;
      push({ id: `material:${row.kind}:${row.id}`, source: 'material', title: `${contract.code} · ${uiText('物料接收')}`,
        meta: [source.code, `${row.outstanding} ${uiText(row.unit)}`, row.delivery.supplier].join(' · '), when: '待接收', urgent: false, at: row.at,
        target: { view: 'procurement', id: contract.id, detail: 'full', section: 'order:' + row.delivery.orderId, orderLineId: row.delivery.lineId } });
    }
  }
  if (canRead('qc-workbench')) for (const task of state.fulfillment.qcTasks) {
    // 待认领/检验中只给专业 QC（qc:inspect，且有该业务线登记权）；业务主管虽有登记权但不是检验岗。
    const qcRole = can('qc:inspect') && can(`qc:${task.domain}_chain:write`), business = can('orders:write');
    const open = qcRole && task.state === 'pending', working = qcRole && task.state === 'working' && !!me && task.assigneeId === me;
    const sampleBack = business && task.kind === 'sample' && task.state === 'reported' && !sampleBusinessFinished(state, task)
      && (task.source.kind !== 'version' || canRead('development'));
    const productionBack = business && task.kind === 'production' && (task.state === 'awaiting_business' || task.state === 'blocked');
    if (!open && !working && !sampleBack && !productionBack) continue;
    const what = open ? '待认领' : working ? '检验中' : task.kind === 'sample' ? task.source.kind === 'orderLine' && task.businessConfirmation?.result === 'approved' ? '待业务确认' : '待需求方确认' : task.state === 'blocked' ? '检验不通过，待业务决定' : '检验结果待业务确认';
    push({ id: 'qc:' + task.id, source: 'qc', title: `${task.code} · ${uiText(what)}`, meta: [task.factory, task.requestedBy && uiText('发起人') + ' ' + task.requestedBy].filter(Boolean).join(' · '),
      when: task.state === 'blocked' ? '已阻断' : open ? '待认领' : working ? '处理中' : '待确认', urgent: task.state === 'blocked' || (!!task.due && task.due <= today), at: task.due || task.createdAt, due: task.due || undefined,
      target: sampleBack && task.source.kind === 'version' ? { view: 'development/detail', id: task.source.devId, versionId: task.source.versionId } : { view: 'qc-workbench', id: task.id } });
  }
  if (canRead('shipments')) for (const shipment of state.fulfillment.shipments) {
    const stage = shipmentStage(state, shipment), logisticsDuty = can(MIST_LOGISTICS_DUTY);
    const intake = stage === 'intake' && logisticsDuty, preparing = stage === 'logistics' && logisticsDuty, departure = stage === 'departure' && logisticsDuty;
    const business = stage === 'business' && can('orders:write'), unsent = stage === 'departed' && !shipment.documentsSentAt && can('orders:write');
    if (!intake && !preparing && !departure && !business && !unsent) continue;
    const action = intake ? '待物流接手' : preparing ? '单证准备' : departure ? shipment.mode === 'air' ? '待起飞' : '待离港' : business ? '待对客交单' : '单据待补交';
    const when = intake ? '待接手' : preparing ? '处理中' : departure ? shipment.mode === 'air' ? '待起飞' : '待离港' : '待交单';
    push({ id: 'shipping:' + shipment.id, source: 'shipping', title: `${shipment.code} · ${uiText(action)}`, meta: [shipment.customer, (unsent ? shipment.departedAt : shipment.plannedDate)?.slice(0, 10)].filter(Boolean).join(' · '),
      when, urgent: !unsent && !!shipment.plannedDate && shipment.plannedDate <= today, at: (unsent ? shipment.departedAt : shipment.plannedDate) || '', due: unsent ? undefined : shipment.plannedDate || undefined,
      target: { view: 'shipments', id: shipment.id, detail: 'full' } });
  }
  if (canRead('payment-vouchers')) {
    const requests = state.payables?.requests ?? [], since = new Date(Date.parse(today + 'T00:00:00Z') - FINANCE_RETURN_DAYS * 86400000).toISOString().slice(0, 10);
    if(me&&canRead('procurement')&&can(PAYMENT_REQUEST_SCOPES.create)&&Array.isArray(state.payables?.bills)&&Array.isArray(f.purchases)){
      const contracts=new Map(f.purchases.map(purchase=>[purchase.id,purchase]));
      for(const bill of payableBills(state,today)){
        if(bill.status==='void'||bill.held||bill.open<=0||!bill.lines.length)continue;
        // Only unambiguous source ownership yields a personal work item. This
        // reminder never assigns a mixed invoice, creates a request or pays it.
        if(bill.lines.some(line=>{const purchase=contracts.get(line.purchaseId);return !purchase||purchase.requesterId!==me||purchase.supplierId!==bill.supplierId||purchase.currency!==bill.currency;}))continue;
        if(requests.some(request=>request.purpose==='bill'&&request.requesterId===me&&request.state==='rejected'&&(request.decision?.at.slice(0,10)||'')>=since&&request.lines.some(line=>line.billId===bill.id)))continue;
        const available=Math.max(0,Math.round(bill.open*100)-billRequestedUnpaidMinor(state,bill.id));if(!available)continue;
        const linkedAt=bill.lines.flatMap(line=>[line.linkedAt,state.payables?.settlements?.find(row=>row.id===line.settlementId)?.confirmation?.at]);
        const cancelledAt=requests.filter(request=>request.state==='cancelled'&&request.lines.some(line=>line.billId===bill.id)).map(request=>request.cancelled?.at);
        const readyAt=[bill.registeredAt,...linkedAt,...cancelledAt].filter((value):value is string=>!!value).sort().at(-1)||bill.invoiceDate||today;
        push({id:'bill-request:'+bill.id,source:'finance',title:`${bill.code} · ${uiText('待申请付款')}`,meta:[bill.supplier,`${bill.currency} ${(available/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`].join(' · '),when:bill.overdue?'已逾期':'待申请',urgent:bill.overdue,at:readyAt,due:bill.due,target:{view:'payment-vouchers',id:bill.id,section:'payables'}});
      }
    }
    const settlementFacts = state.payables?.settlements;
    if (me && canRead('procurement') && can(SETTLEMENT_SCOPES.submit) && Array.isArray(settlementFacts) && f.purchases && f.receipts) {
      for (const purchase of f.purchases) {
        if (purchase.state !== 'approved' || purchase.requesterId !== me) continue;
        const heldInvoice=state.payables?.bills.some(bill=>bill.state==='open'&&bill.lines.some(line=>line.purchaseId===purchase.id&&line.awaitingSettlement&&!line.settlementId));
        const formalFollowup=settlementFacts.some(row=>row.purchaseId===purchase.id&&['returned','reversed'].includes(row.state));
        if(!purchaseRequiresSettlementLink(state,purchase.id)&&!heldInvoice&&!formalFollowup)continue;
        if (settlementFacts.some(row => row.purchaseId === purchase.id && (row.state === 'pending' || row.state === 'confirmed' && row.final))) continue;
        const receipts = settlementReceipts(state, purchase.id).filter(row => !row.settled && row.receipt.quantity > 0);
        if (!receipts.length) continue;
        const quantity = receipts.reduce((sum, row) => sum + row.receipt.quantity, 0);
        // Reuse the current receipt/settlement facts; this reminder never marks
        // goods accepted, creates a settlement or changes the contract due date.
        push({ id: 'settlement-submit:' + purchase.id, source: 'finance', title: `${purchase.code} · ${uiText('待结算')}`,
          meta: [purchase.supplier, `${quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${uiText(purchase.unit)}`].join(' · '),
          when: '待结算', urgent: false, at: receipts.map(row => row.receipt.date).sort().at(-1) || '',
          target: { view: 'payment-vouchers', id: purchase.id, section: 'payables' } });
      }
    }
    if (can(SETTLEMENT_SCOPES.confirm)) for (const settlement of state.payables?.settlements ?? []) {
      if (settlement.state !== 'pending') continue;
      push({ id: 'settlement:' + settlement.id, source: 'finance', title: `${settlement.code} · ${uiText('待财务复核')}`,
        meta: [settlement.supplier, settlement.purchaseCode, `${settlement.currency} ${settlement.amount.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2})}`].filter(Boolean).join(' · '),
        when: '待复核', urgent: false, at: settlement.submittedAt, target: {view:'payment-vouchers',id:settlement.id,section:'payables'} });
    }
    if (can('invoices:reconcile')) for (const receipt of state.receipts ?? []) {
      const display = financeReceiptDisplay(receipt, state.orderFunding?.assignments ?? [], state.allocations ?? []);
      if (receipt.remaining <= 0 || (display.label !== '未认领' && display.label !== '匹配建议')) continue;
      push({ id: 'receipt:' + receipt.id, source: 'finance', title: `${receipt.payer || '到账'} · ${uiText(display.label === '未认领' ? '到账未认领' : '匹配建议待确认')}`, meta: [`${receipt.currency} ${receipt.remaining.toLocaleString('en-US')}`, receipt.date].filter(Boolean).join(' · '),
        when: display.label, urgent: display.label === '未认领', at: receipt.date || '', target: { view: 'payment-vouchers', id: receipt.id } });
    }
    if (can('invoices:write')) for (const invoice of (state.invoices ?? []).filter(isPendingFinanceMistInvoice))
      push({ id: 'invoice:' + invoice.id, source: 'finance', title: ui`${invoice.code} · 发票待财务确认`, meta: [invoice.customer, invoice.order].filter(Boolean).join(' · '), when: '待确认', urgent: false, at: invoice.due || '',
        due: invoice.due || undefined, target: { view: 'invoices', section: 'pending', id: invoice.id } as MistTarget });
    if (can(MIST_FINANCE_SCOPES.voucher)) for (const request of requests) {
      if (request.state !== 'approved' || !(request.amount > 0) || request.purpose === 'bill' && !can(MIST_FINANCE_SCOPES.reconcile)) continue;
      // Approval returns to the original full request after a reversal; historical payment IDs are not a live balance.
      push({id:'payment-request:'+request.id,source:'finance',title:`${request.code} · ${uiText('待付款')}`,
        meta:[request.supplier,`${request.currency} ${request.amount.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`].filter(Boolean).join(' · '),
        when:'待付款',urgent:false,at:request.decision?.at||request.submittedAt,target:{view:'payment-vouchers',id:request.id,section:'payables'}});
    }
    for (const request of requests.filter(item => item.state === 'rejected' && item.requesterId === me && (item.decision?.at ?? '').slice(0, 10) >= since)) {
      const resubmitted = requests.some(other => other.id !== request.id && other.submittedAt > request.submittedAt && other.state !== 'cancelled' && other.supplierId === request.supplierId && other.purpose === request.purpose
        && (other.purchaseId ?? other.settlementId ?? other.planId ?? '') === (request.purchaseId ?? request.settlementId ?? request.planId ?? ''));
      if (resubmitted) continue;
      push({ id: 'finance:' + request.id, source: 'finance', title: ui`${request.code} · 付款申请被退回`, meta: [request.supplier, request.decision?.actor && '退回人 ' + request.decision.actor, request.decision?.note].filter(Boolean).join(' · '), when: '被退回', urgent: true, at: request.decision?.at || request.submittedAt, target: { view: 'payment-vouchers', id: request.id, section: 'payables' } });
    }
  }
  // 每周一起：主管把上周团队周报生成并存档（服务端冻结此刻数据）；存档后自动消失。
  const weekly = canRead('dashboard') && can('relations:admin') ? pendingWeeklyArchive(state, me, today) : null;
  if (weekly) push({ id: 'report:' + weekly, source: 'report', title: ui`生成上周团队周报（${weekly.slice(5)} 至 ${addBusinessDays(weekly, 6).slice(5)}）`, meta: uiText('冻结上周数据存档，可复制或导出后自行发送'), when: '本周', urgent: false, at: addBusinessDays(weekly, 7),
    target: { view: 'dashboard', section: 'team-weekly' } as MistTarget });
  return items;
}

/** 我的全部待处理：派生事项 + 指定给我或我岗位的工作事项。侧栏、首页、模块页「待我处理」共用这一份。 */
export function mistMyWork(state: MistState | null | undefined, options: MistWorkOptions): MistWorkItem[] {
  const today = options.today;
  return [...mistWorkQueue(state, options), ...mistMyTasks(state, options).map(task => ({ id: 'task:' + task.id, source: 'task' as const, sourceLabel: MIST_WORK_SOURCE_LABEL.task, title: task.title, meta: task.due ? '期限 ' + task.due : '未定期限',
    when: !task.due ? '未定期限' : task.due < today ? '已逾期' : task.due === today ? '今天' : task.due.slice(5), urgent: !!task.due && task.due <= today, at: task.due, due: task.due || undefined, target: task.target, module: mistWorkModule(task.target?.view) }))];
}

/** 由邮件生成的跟进事项（任务本身已保存在公司）。 */
export function mistEmailFollowUpTaskIds(state: MistState | null | undefined) {
  return new Set((state?.email?.messages ?? []).flatMap(message => message.followUpTaskIds ?? []));
}

/**
 * 侧栏数字 = 各模块等我处理的条数（与模块页「待我处理」一致）；「我的工作」= 全部合计（含其他公司的审批）。
 * 存量、总数不计入；没有待办不显示。
 */
export function mistNavCounts(state: MistState | null | undefined, options: MistWorkOptions): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of mistMyWork(state, options)) { if (item.module !== 'cockpit') counts[item.module] = (counts[item.module] || 0) + 1; counts.cockpit = (counts.cockpit || 0) + 1; }
  return counts;
}
