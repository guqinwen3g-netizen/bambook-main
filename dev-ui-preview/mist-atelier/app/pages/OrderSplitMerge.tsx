/** ord30：订单拆分与合并入口。订单还没有任何后续业务时才显示；已批准订单办理后回到草稿，重新提交主单审批。 */
import React from 'react';
import type { MistCommand, MistOrder, MistState } from '../../../../server/src/shared/mistWorkspace';
import { orderDownstreamFacts } from '../../../../server/src/shared/mistOrderSplit';
import type { OrderGovernanceFields } from '../../../../server/src/shared/mistOrderGovernance';
import { Button } from '../../../../components/mist';
import { ModuleEditorDialog, type ModuleEditorSpec } from './modules/ModuleWorkbench';
import { uiText } from '../../../../services/interfaceLanguage';

type Governed = MistOrder & { governance?: OrderGovernanceFields };
const open = (o: Governed) => { const g = o.governance; return !!g && !o.replacementSource && g.contract.kind !== 'internal' && ['draft', 'rejected', 'approved'].includes(g.status) && g.changeDraft?.status !== 'pending' && g.cancellation?.status !== 'pending'; };

export function OrderSplitMerge({ state, order, busy, run, go }: { state: MistState; order: Governed; busy: boolean; run: (command: MistCommand) => Promise<{ result: { id?: unknown } }>; go: (view: string, id?: string) => void }) {
  const [spec, setSpec] = React.useState<ModuleEditorSpec | null>(null);
  if (!open(order) || orderDownstreamFacts(state as never, order.id).length) return null;
  const lines = state.orderLines.filter(l => l.orderId === order.id);
  const partners = (state.orders as Governed[]).filter(o => o.id !== order.id && o.customerId === order.customerId && o.type === order.type && o.currency === order.currency && open(o) && !orderDownstreamFacts(state as never, o.id).length);
  const approved = order.governance?.status === 'approved';
  const split = (): ModuleEditorSpec => ({ title: `拆分 ${order.code}`, submitLabel: '拆分', description: approved ? '原订单与新订单都需重新提交主单审批。' : undefined,
    sections: [{ id: 'lines', label: '移出的条目', fields: lines.map(l => 'q:' + l.id) }, { id: 'new', label: '新订单', fields: ['due', 'reason'] }],
    fields: [...lines.map(l => ({ key: 'q:' + l.id, label: `${l.style} · ${l.name}（共 ${l.qty} ${l.unit}）`, type: 'number' as const, min: 0, ...((l as { breakdown?: unknown }).breakdown ? { hint: '分色分码条目只能整条移出' } : {}) })),
      { key: 'due', label: '新订单交期', type: 'date', required: true }, { key: 'reason', label: '拆分原因', type: 'textarea', required: true }],
    initialValues: { ...Object.fromEntries(lines.map(l => ['q:' + l.id, ''])), due: order.due, reason: '' },
    submit: async v => { const picks = lines.flatMap(l => { const q = Number(v['q:' + l.id]); return q > 0 ? [{ lineId: l.id, qty: q }] : []; }); if (!picks.length) throw new Error('请填写至少一个条目的移出数量');
      const r = await run({ type: 'order.split', payload: { orderId: order.id, lines: picks, due: String(v.due ?? ''), reason: String(v.reason ?? '') } } as MistCommand); const id = String(r.result.id || ''); if (id) go('orders/detail', id); } });
  const merge = (): ModuleEditorSpec => ({ title: `合并到 ${order.code}`, submitLabel: '合并', submitVariant: 'danger', description: `来源订单的条目并入本单，来源订单作废。${approved ? '本单需重新提交主单审批。' : ''}`,
    fields: [{ key: 'sourceOrderId', label: '并入的订单', type: 'select', required: true, options: [{ value: '', label: '请选择' }, ...partners.map(o => ({ value: o.id, label: `${o.code} · ${o.lines} 个条目 · 交期 ${o.due}` }))] }, { key: 'reason', label: '合并原因', type: 'textarea', required: true }],
    initialValues: { sourceOrderId: '', reason: '' },
    submit: v => run({ type: 'order.merge', payload: { orderId: order.id, sourceOrderId: String(v.sourceOrderId ?? ''), reason: String(v.reason ?? '') } } as MistCommand) });
  return <>
    <Button disabled={busy || lines.length === 0} onClick={() => setSpec(split())}>{uiText('拆分订单')}</Button>
    {partners.length > 0 && <Button disabled={busy} onClick={() => setSpec(merge())}>{uiText('合并订单')}</Button>}
    <ModuleEditorDialog spec={spec} onClose={() => setSpec(null)} />
  </>;
}
