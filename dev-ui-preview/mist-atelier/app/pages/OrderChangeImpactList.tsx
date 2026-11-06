import { uiText, ui } from '../../../../services/interfaceLanguage';
/** BB-ORD-4：变更草稿的影响清单——按条目列出受影响的采购、生产分支、出运批次与发票，可点开到原模块核对。只读。 */
import React from 'react';
import { Banner, Button, Mono, Pill } from '../../../../components/mist';
import type { MistOrder, MistState } from '../../../../server/src/shared/mistWorkspace';
import { impactStateLabel, orderChangeImpact } from '../../../../server/src/shared/mistOrderChangeImpact';
import type { OrderGovernanceLine } from '../../../../server/src/shared/mistOrderGovernance';
import { formatOrderQuantity as q } from './orderAmounts';

type Go = (view: string, id?: string, target?: Record<string, string | undefined>) => void;

export function OrderChangeImpactList({ state, order, lines, go, note, due }: { state: MistState; order: MistOrder; lines: OrderGovernanceLine[]; go: Go; note?: string; /** 拟议交期；与当前交期不同时提示交期核对 */ due?: string }) {
  const impact = orderChangeImpact(state, order, lines);
  if (!impact.hasFacts) return null;
  // 与 createOrderChangeTasks 一致：数量 / 分码变化通知采购与生产；交期变化通知未关闭的采购、生产与未离港出运。
  const qtyChanged = impact.lines.some(line => line.removed || line.added || line.before !== line.after), dueChanged = !!due && due !== order.due;
  const defaultNote = [qtyChanged && '新数量生效后，给受影响的采购、生产各生成一条核对待办', dueChanged && `交期 ${order.due} → ${due} 生效后，给该单未关闭的采购、生产与未离港出运各生成一条核对待办`].filter(Boolean).join('；') || '审批通过后给下列相关记录生成核对待办';
  const shown = impact.lines.filter(line => line.purchases.length || line.productions.length || line.shipments.length);
  const link = (label: React.ReactNode, onClick: () => void) => <Button size="sm" variant="quiet" onClick={onClick}>{uiText(label)}</Button>;
  return <section className="mist-col" style={{ gap: 8 }} aria-label={uiText("影响清单")} data-change-impact>
    <b className="mist-h3">{uiText("影响清单")}</b>
    <span className="mist-note">{note || `${defaultNote}；不会自动改采购、生产或出运数据。`}</span>
    {shown.map(line => <div key={line.lineId} className="mist-col" style={{ gap: 4 }} data-impact-line={line.lineId}>
      <div className="mist-row" style={{ gap: 8, flexWrap: 'wrap' }}><b>{uiText(line.label)}</b><span className="mist-muted">{uiText(line.removed ? '拟删除' : line.before !== null && line.before === line.after ? `${q(line.before)} ${line.unit} · 数量不变` : `${line.before === null ? '新增' : q(line.before)} → ${line.after === null ? '—' : q(line.after)} ${line.unit}`)}</span><span className="mist-spacer" /><Pill tone="neutral">{uiText("下限 ")}{q(line.floor)} {uiText(line.unit)}{uiText("（已完工 ")}{q(line.completed)}{uiText(" · 已排出运 ")}{q(line.shipped)}）</Pill></div>
      {line.warning && <Banner variant="notice" tone="warn" title={uiText("需同步调整生产分配")}>{line.warning}</Banner>}
      <div className="mist-row" style={{ gap: 4, flexWrap: 'wrap' }}>
        {line.purchases.map(p => <React.Fragment key={p.id}>{link(<>{uiText("采购 ")}<Mono>{p.code}</Mono> · {impactStateLabel(p.state)} · {q(p.quantity)} {uiText(p.unit)}</>, () => go('procurement', p.id, { orderLineId: line.lineId }))}</React.Fragment>)}
        {line.productions.map(p => <React.Fragment key={p.id}>{link(<>{uiText("生产 ")}<Mono>{p.code}</Mono> · {p.factory} · {impactStateLabel(p.col)}{uiText(" · 分配 ")}{q(p.qty)}{uiText(" · 已完工 ")}{q(p.completed)}</>, () => go('production-board', undefined, { productionId: p.id, orderLineId: line.lineId }))}</React.Fragment>)}
        {line.shipments.map(s => <React.Fragment key={s.id}>{link(<>{uiText("出运 ")}<Mono>{s.code}</Mono> · {impactStateLabel(s.state)} · {q(s.quantity)} {uiText(line.unit)}</>, () => go('shipments', s.id))}</React.Fragment>)}
      </div>
    </div>)}
    {impact.invoices.length > 0 && <div className="mist-row" style={{ gap: 4, flexWrap: 'wrap' }} data-impact-invoices><b>{uiText("发票")}</b>{impact.invoices.map(i => <React.Fragment key={i.id}>{link(<>{uiText("发票 ")}<Mono>{i.code}</Mono> · {uiText(i.voided ? '已作废' : '有效')} · {i.amount} {i.currency}{uiText(" · 未收 ")}{i.open}</>, () => go('invoices', i.id))}</React.Fragment>)}</div>}
  </section>;
}
