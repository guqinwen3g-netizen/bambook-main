import { interfaceLocale } from '../../../../../services/interfaceLanguage';
import { uiText, ui } from '../../../../../services/interfaceLanguage';
import {businessNow} from '../../runtime/businessClock';
import {businessWhen} from './pageKit';
/** 售后索赔协同：通知相关人员 → 质检核实（工厂参与）→ 客户处置（原审批）→ 两笔账（客户 / 工厂追偿）→ 两边都落实才结束。 */
import React from 'react';
import { Banner, Button, Card, CardHeader, Checklist, DataTable, Facts, Pill, type Tone } from '../../../../../components/mist';
import type { MistState } from '../../../../../server/src/shared/mistWorkspace';
import { platformCreditRemaining, type PlatformClaim, type PlatformCommand } from '../../../../../server/src/shared/mistPlatform';
import { CLAIM_LOCATION_LABEL, CLAIM_METHOD_LABEL, CLAIM_RECOVERY_LABEL, CLAIM_RESULT_LABEL, claimLedger, currentClaimVerification, type ClaimGoodsLocation, type ClaimRecovery, type ClaimRecoveryMethod, type ClaimVerifyResult } from '../../../../../server/src/shared/mistClaimCoordination';
import { billRequestedUnpaidMinor, payableBills, recoveryDeductedMinor, supplierDeductions } from '../../../../../server/src/shared/mistPayables';
import type { ModuleEditorSpec, ModuleField, ModuleValues } from './ModuleWorkbench';

const RECOVERY_TONE: Record<ClaimRecovery['state'], Tone> = { Negotiating: 'warn', Agreed: 'accent', Settled: 'ok', Waived: 'neutral', Withdrawn: 'neutral' };
const RESULT_TONE: Record<ClaimVerifyResult, Tone> = { confirmed: 'bad', partial: 'warn', notConfirmed: 'ok' };
const f = (key: string, label: string, type: ModuleField['type'] = 'text', extra: Partial<ModuleField> = {}): ModuleField => ({ key, label, type, required: true, ...extra });
const s = (v: ModuleValues, k: string) => String(v[k] ?? '').trim();
const n = (v: ModuleValues, k: string) => Number(v[k]);
const money = (value: number | null, currency: string) => value === null ? '币种不同，不自动换算' : new Intl.NumberFormat(interfaceLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + ' ' + currency;
const when = businessWhen;

type Props = {
  claim: PlatformClaim; state: MistState; actorId?: string; busy: boolean;
  can: { write: boolean; qc: boolean; finance: boolean; approve: boolean };
  command: (command: PlatformCommand) => Promise<unknown>; openEditor: (spec: ModuleEditorSpec) => void;
  /** 打开应付（“从货款中扣”由财务在应付里按票据登记扣款）。 */
  onPayables?: () => void;
};

/** 默认工厂：订单生产分支上登记的工厂，名称在供应商档案中唯一时才预选。 */
export function claimDefaultSupplierId(state: MistState, claim: PlatformClaim) {
  const suppliers = state.market?.suppliers ?? [], names = [...new Set(state.productions.filter(p => p.orderId === claim.orderId && !p.closed).map(p => p.factory))];
  const matches = suppliers.filter(row => names.includes(row.name));
  return matches.length === 1 ? matches[0].id : '';
}

export function ClaimCoordinationPanel({ claim, state, actorId, busy, can, command, openEditor, onPayables }: Props) {
  const open = !['Closed', 'Cancelled'].includes(claim.state);
  const co = claim.coordination, notice = co?.notices.at(-1), check = currentClaimVerification(claim), ledger = claimLedger(state, claim, { creditsOpen: (state.platform?.credits ?? []).some(note => note.claimId === claim.id && platformCreditRemaining(state, note.id) > 0) });
  const recoveries = co?.recoveries ?? [], suppliers = (state.market?.suppliers ?? []).map(row => ({ value: row.id, label: row.name + (row.status === 'active' ? '' : '（' + (row.status === 'paused' ? '已暂停' : '已停用') + '）') }));
  const defaultSupplier = claimDefaultSupplierId(state, claim);
  const approved = claim.dispositions.filter(d => ['approved', 'Executed'].includes(d.state) && !d.supersededById).length;
  const executed = claim.dispositions.some(d => d.state === 'Executed' && !d.supersededById);
  const steps = [
    { label: '通知相关人员：质检、负责人、跟单、工厂', done: !!notice, note: notice ? notice.by + ' · ' + when(notice.at) + ' · 工厂 ' + notice.supplierName + '（' + notice.factoryChannel + '）' : '尚未通知' },
    { label: '内部质检核实事实（工厂配合）', done: !!check, note: check ? CLAIM_RESULT_LABEL[check.result] + ' · ' + check.by : '尚未核实', noteTone: !check && claim.dispositions.length ? 'bad' as const : undefined },
    { label: '对客户的处理方案经负责人批准', done: approved > 0, note: approved ? approved + ' 条已批准' : '尚无已批准方案' },
    { label: '客户这边处理完（款项 / 货物）', done: ledger.customerSettled, note: ledger.customerSettled ? (executed ? '已执行并结清' : '处置未采用') : ledger.customerMoneyOpen ? '方案已执行，贷项款项待抵扣 / 退款' : claim.dispositions.length ? '还有方案待审批或待执行' : '—' },
    { label: '工厂补偿落实', done: ledger.hasRecovery && !ledger.recoveryOpen, note: !ledger.hasRecovery ? '尚未向工厂提出' : ledger.recoveryOpen ? '还在等工厂' : '已落实或已批准放弃' },
  ];

  const notify = () => openEditor({
    title: '通知相关人员',
    fields: [f('supplierId', '相关工厂', 'select', { options: suppliers }), f('factoryChannel', '联系渠道', 'text', {}), f('note', '备注', 'textarea', { required: false })],
    initialValues: { supplierId: notice?.supplierId ?? defaultSupplier, factoryChannel: '', note: '' }, submitLabel: '记录并通知',
    submit: v => command({ type: 'platform.claim.notify', payload: { id: claim.id, supplierId: s(v, 'supplierId'), factoryChannel: s(v, 'factoryChannel'), note: s(v, 'note') } }),
  });
  const verify = () => openEditor({
    title: '记录质检核实',
    fields: [
      f('result', '核实结论', 'select', { options: (Object.keys(CLAIM_RESULT_LABEL) as ClaimVerifyResult[]).map(k => ({ value: k, label: CLAIM_RESULT_LABEL[k] })) }),
      f('scope', '影响范围', 'textarea'), f('affectedQuantity', '影响数量', 'number', { min: 0, step: '1' }), f('unit', '单位', 'text', { required: false }),
      f('goodsLocation', '货物位置', 'select', { options: (Object.keys(CLAIM_LOCATION_LABEL) as ClaimGoodsLocation[]).map(k => ({ value: k, label: CLAIM_LOCATION_LABEL[k] })) }),
      f('mitigation', '减损措施', 'textarea', { required: false }), f('factoryResponse', '工厂回复', 'textarea', { required: false }),
      f('safety', '涉及安全隐患（需评估停售或召回）', 'checkbox', { required: false }),
    ],
    initialValues: { result: check?.result ?? '', scope: check?.scope ?? '', affectedQuantity: check?.affectedQuantity ?? '', unit: check?.unit ?? '件', goodsLocation: check?.goodsLocation ?? '', mitigation: check?.mitigation ?? '', factoryResponse: check?.factoryResponse ?? '', safety: check?.safety ?? false },
    submitLabel: '保存核实结论',
    submit: v => command({ type: 'platform.claim.verify', payload: { id: claim.id, result: s(v, 'result') as ClaimVerifyResult, scope: s(v, 'scope'), affectedQuantity: n(v, 'affectedQuantity'), unit: s(v, 'unit'), goodsLocation: s(v, 'goodsLocation') as ClaimGoodsLocation, mitigation: s(v, 'mitigation'), factoryResponse: s(v, 'factoryResponse'), safety: v.safety === true || v.safety === 'true', fileIds: [] } }),
  });
  const openRecovery = () => openEditor({
    title: '向工厂追偿',
    fields: [f('supplierId', '追偿工厂', 'select', { options: suppliers }), f('currency', '币种', 'text'), f('requested', '追偿金额', 'number', { min: 0.01, step: '0.01' }), f('basis', '追偿依据', 'textarea')],
    initialValues: { supplierId: notice?.supplierId ?? defaultSupplier, currency: ledger.currency || 'USD', requested: '', basis: check ? '质检核实：' + CLAIM_RESULT_LABEL[check.result] + ' · ' + check.scope : '' }, submitLabel: '提出追偿',
    submit: v => command({ type: 'platform.claim.recovery.open', payload: { claimId: claim.id, supplierId: s(v, 'supplierId'), currency: s(v, 'currency'), requested: n(v, 'requested'), basis: s(v, 'basis') } }),
  });
  const agree = (r: ClaimRecovery) => openEditor({
    title: '工厂确认', fields: [f('agreed', '工厂同意承担的金额（' + r.currency + '）', 'number', { min: 0.01, step: '0.01' }), f('method', '补偿方式', 'select', { options: (Object.keys(CLAIM_METHOD_LABEL) as ClaimRecoveryMethod[]).map(k => ({ value: k, label: CLAIM_METHOD_LABEL[k] })) }), f('note', '确认依据', 'textarea')],
    initialValues: { agreed: '', method: '', note: '' }, submitLabel: '保存',
    submit: v => command({ type: 'platform.claim.recovery.agree', payload: { id: r.id, agreed: n(v, 'agreed'), method: s(v, 'method') as ClaimRecoveryMethod, note: s(v, 'note') } }),
  });
  /** 已在应付中从货款扣的金额（未冲回）。 */
  const deducted = (r: ClaimRecovery) => recoveryDeductedMinor(state, r.id) / 100;
  /** 这家工厂同币种还有可扣的未付票据吗（未作废、未暂挂、未付扣除待付申请后仍有余额）。 */
  const deductRoom = (r: ClaimRecovery) => payableBills(state, '').some(b => b.supplierId === r.supplierId && b.currency === r.currency && b.status !== 'void' && !b.held && Math.round(b.open * 100) - billRequestedUnpaidMinor(state, b.id) > 0);
  const switchToPayment = (r: ClaimRecovery) => openEditor({
    title: '改为工厂付款', description: `已扣 ${money(deducted(r), r.currency)} · 待收 ${money(Math.max(0, (r.agreed ?? 0) - deducted(r)), r.currency)}`,
    fields: [f('reason', '改方式原因与确认依据', 'textarea')], initialValues: { reason: '' }, submitLabel: '确认改为工厂付款',
    submit: v => command({ type: 'platform.claim.recovery.method', payload: { id: r.id, method: 'payment', reason: s(v, 'reason') } } as PlatformCommand),
  });
  const settle = (r: ClaimRecovery) => openEditor({
    title: '落实补偿', description: deducted(r) > 0 ? `已扣 ${money(deducted(r), r.currency)}` : undefined,
    fields: [f('amount', (deducted(r) > 0 ? '其他方式落实金额（' : '实际落实金额（') + r.currency + '）', 'number', { min: 0.01, step: '0.01' }), f('date', '落实日期', 'date'), f('reference', '实际扣款 / 收款凭据', 'text')],
    initialValues: { amount: r.agreed === undefined ? '' : Math.max(0, Math.round((r.agreed - deducted(r)) * 100) / 100), date: businessNow().toISOString().slice(0, 10), reference: '' }, submitLabel: '确认已落实',
    submit: v => command({ type: 'platform.claim.recovery.settle', payload: { id: r.id, amount: n(v, 'amount'), date: s(v, 'date'), reference: s(v, 'reference') } }),
  });
  const waive = (r: ClaimRecovery) => openEditor({
    title: '放弃追偿', fields: [f('reason', '放弃的原因', 'textarea')], initialValues: { reason: '' }, submitLabel: '批准放弃',
    submit: v => command({ type: 'platform.claim.recovery.waive', payload: { id: r.id, reason: s(v, 'reason') } }),
  });

  return <>
    {check?.safety && <Banner tone="bad" title={uiText("涉及安全隐患")}>{uiText("不能只谈折扣；需负责人单独评估停售或召回。")}</Banner>}
    {open && !check && claim.dispositions.length > 0 && <Banner tone="warn" title={uiText("质检尚未核实")}>{uiText("紧急情况可以先采取保护措施，但责任和金额要等事实核实后再定。")}</Banner>}
    {open && ledger.customerSettled && ledger.recoveryOpen && <Banner tone="warn" title={uiText("客户这边已解决，但还在等工厂补偿")}>{uiText("工厂补偿落实或经负责人批准放弃后，案件才能关闭。")}</Banner>}
    <Card>
      <CardHeader title={uiText("处理进度")} tools={<div className="mist-row">
        {can.write && open && <Button disabled={busy} onClick={notify}>{uiText(notice ? '再次通知' : '通知相关人员')}</Button>}
        {can.qc && open && <Button disabled={busy} onClick={verify}>{uiText(check ? '更新质检核实' : '记录质检核实')}</Button>}
      </div>} />
      <div className="mist-card-body"><Checklist items={steps} /></div>
    </Card>
    {(notice || check) && <Card>
      <CardHeader title={uiText("通知与核实")} />
      <div className="mist-card-body">
        <Facts cols={3} items={[
          ...(notice ? [{ label: '相关工厂', value: notice.supplierName }, { label: '通知方式', value: notice.factoryChannel + ' · ' + notice.by }, { label: '备注', value: notice.note ?? notice.internalNote ?? '—' }] : []),
          ...(!check ? [] : [
          { label: '质检结论', value: <Pill tone={RESULT_TONE[check.result]}>{CLAIM_RESULT_LABEL[check.result]}</Pill> },
          { label: '影响范围', value: check.scope + (check.affectedQuantity ? ' · ' + check.affectedQuantity + ' ' + check.unit : '') },
          { label: '货物位置', value: CLAIM_LOCATION_LABEL[check.goodsLocation] },
          { label: '减损办法', value: check.mitigation || '—' }, { label: '工厂回复', value: check.factoryResponse || '—' }, { label: '核实人', value: check.by + ' · ' + when(check.at) },
          ]),
        ]} />
      </div>
    </Card>}
    <Card>
      <CardHeader title={uiText("两笔账")} tools={can.write && open ? <Button disabled={busy} onClick={openRecovery}>{uiText("向工厂追偿")}</Button> : undefined} />
      <div className="mist-card-body">
        <Facts cols={3} items={[
          { label: '对客户（已批准）', value: money(ledger.customer, ledger.currency) + (ledger.customerPending ? ' · 另有 ' + money(ledger.customerPending, ledger.currency) + ' 待批' : '') },
          { label: '工厂同意承担', value: ledger.hasRecovery ? money(ledger.recoveryAgreed, ledger.currency) + (ledger.recoverySettled ? ' · 已落实 ' + money(ledger.recoverySettled, ledger.currency) : '') : '尚未提出' },
          { label: '公司自担', value: money(ledger.companyLoss, ledger.currency) },
        ]} />
        {recoveries.length > 0 && <DataTable rows={recoveries} rowKey={r => r.id} columns={[
          { key: 'supplier', header: '工厂', render: r => r.supplierName },
          { key: 'requested', header: '提出', align: 'right', render: r => money(r.requested, r.currency) },
          { key: 'agreed', header: '工厂同意', align: 'right', render: r => r.agreed === undefined ? '—' : money(r.agreed, r.currency) + (r.method ? ' · ' + CLAIM_METHOD_LABEL[r.method] : '') },
          { key: 'state', header: '状态', render: r => <Pill tone={RECOVERY_TONE[r.state]}>{CLAIM_RECOVERY_LABEL[r.state]}</Pill> },
          { key: 'note', header: '依据 / 凭据', render: r => <span className="mist-col"><span>{r.settledRef || r.waiveReason || r.agreedNote || r.basis}</span>{(r.method === 'deduction' || r.method === 'mixed' || deducted(r) > 0) && r.state === 'Agreed' && <span className="mist-note">{uiText("已从货款扣 ")}{money(deducted(r), r.currency)}{uiText(" / 同意 ")}{money(r.agreed ?? 0, r.currency)}{uiText(supplierDeductions(state).some(d => d.recoveryId === r.id && !d.reversed) ? ' · ' + supplierDeductions(state).filter(d => d.recoveryId === r.id && !d.reversed).map(d => d.code + ' ' + d.billCode).join('、') : '')}</span>}</span> },
          { key: 'actions', header: '操作', render: r => <div className="mist-row">
            {can.write && open && r.state === 'Negotiating' && <Button variant="quiet" disabled={busy} onClick={() => agree(r)}>{uiText("记录工厂同意")}</Button>}
            {can.finance && open && r.state === 'Agreed' && r.method !== 'deduction' && <Button variant="quiet" disabled={busy} onClick={() => settle(r)}>{uiText("登记实际落实")}</Button>}
            {open && r.state === 'Agreed' && r.method === 'deduction' && <span className="mist-note">{uiText("由财务在应付里按工厂票据扣款，扣满自动落实")}</span>}
            {open && r.state === 'Agreed' && (r.method === 'deduction' || r.method === 'mixed') && onPayables && deductRoom(r) && <Button variant="quiet" disabled={busy} onClick={onPayables}>{uiText("去应付扣款")}</Button>}
            {open && r.state === 'Agreed' && (r.method === 'deduction' || r.method === 'mixed') && !deductRoom(r) && <span className="mist-note">{uiText("这家工厂暂无可扣的未付票据（货款可能已付清），可改为工厂直接付款")}</span>}
            {can.write && open && r.state === 'Agreed' && (r.method === 'deduction' || r.method === 'mixed') && (r.agreed ?? 0) - deducted(r) > 0 && <Button variant="quiet" disabled={busy} onClick={() => switchToPayment(r)}>{uiText("改为工厂付款")}</Button>}
            {can.approve && open && ['Negotiating', 'Agreed'].includes(r.state) && r.createdById !== actorId && <Button variant="quiet" disabled={busy} onClick={() => waive(r)}>{uiText("批准放弃")}</Button>}
          </div> },
        ]} />}
      </div>
    </Card>
  </>;
}
