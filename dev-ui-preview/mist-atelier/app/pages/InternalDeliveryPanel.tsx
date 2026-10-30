import React from 'react';
import { BackLink, Banner, Button, Card, CardBody, CardHeader, DataTable, Drawer, EmptyState, Facts, MistPage, Mono, PageHeader, Pill, type Column } from '../../../../components/mist';
import type { MistOrder } from '../../../../server/src/shared/mistWorkspace';
import { internalDeliveryRevision, internalDeliverySources, internalDeliveryTotals, type InternalDelivery } from '../../../../server/src/shared/mistInternalDelivery';
import { uiText } from '../../../../services/interfaceLanguage';
import { useMistWorkspace } from '../runtime/workspace';
import { useOptionalMistSession } from '../runtime/auth';
import { workspaceMembers, memberSelectOptions } from '../runtime/members';
import { businessToday } from '../runtime/businessClock';
import { useNav } from '../nav';
import { orderLocked } from './OrderTermination';
import { ModuleEditorDialog, ModuleEditorPage, type ModuleEditorSpec } from './modules/ModuleWorkbench';
import { field, text } from './modules/fulfillmentKit';
import { RecordDisclosure, shortWhen } from './modules/pageKit';

function statusOf(row: InternalDelivery) {
  const total = internalDeliveryTotals(row);
  if (row.cancelled) return { label: '已撤回', tone: 'neutral' as const };
  if (total.pending > 0) return { label: total.accepted || total.rejected ? '部分点收' : '待点收', tone: 'warn' as const };
  if (total.rejected > total.returned) return { label: '有拒收', tone: 'warn' as const };
  if (total.returned > 0) return { label: total.accepted ? '部分接收' : '已退回', tone: 'neutral' as const };
  return { label: '已接收', tone: 'ok' as const };
}
const quantity = (value: number, unit: string) => `${value} ${uiText(unit)}`;

/** A handover references physical evidence; the recipient's commercial source can remain hidden. */
function InternalDeliveryRecords({ rows, selectedId, onSelect, onClose }: { rows: InternalDelivery[]; selectedId?: string; onSelect: (id: string) => void; onClose: () => void }) {
  const workspace = useMistWorkspace(), session = useOptionalMistSession(), { go } = useNav();
  const [editor, setEditor] = React.useState<ModuleEditorSpec | null>(null);
  const scope = `${workspace.workspace?.id || ''}:${session?.sessionKey || ''}:${session?.user?.id || ''}:${selectedId || ''}`;
  React.useEffect(() => { setEditor(null); }, [scope]);
  const row = rows.find(item => item.id === selectedId), total = row ? internalDeliveryTotals(row) : undefined;
  const sourceOrder = workspace.state?.orders.find(order => order.id === row?.orderId);
  const receiver = !!row && row.receiverId === session?.user?.id && !!session?.hasPermission('orders:read') && !!session?.hasPermission('orders:write');
  const sender = !!sourceOrder && !!session?.hasPermission('orders:write') && sourceOrder.governance?.status === 'approved' && !orderLocked(sourceOrder) && sourceOrder.governance.changeDraft?.status !== 'pending';
  const locked = workspace.loading || workspace.saving || !!workspace.pending || !!workspace.pendingCreate;
  const open = (spec: ModuleEditorSpec) => setEditor(spec);
  const columns: Column<InternalDelivery>[] = [
    { key: 'source', header: '订单 / 款式', width: 'minmax(180px,2fr)', render: item => <><Mono>{item.orderCode}</Mono><span className="mist-cell-sub">{item.style} · {item.lineName}</span></> },
    { key: 'quantity', header: '交付数量', align: 'right', width: '110px', render: item => quantity(item.quantity, item.unit) },
    { key: 'received', header: '已接收', align: 'right', width: '110px', render: item => quantity(internalDeliveryTotals(item).accepted, item.unit) },
    { key: 'pending', header: '待接收', align: 'right', width: '110px', render: item => quantity(internalDeliveryTotals(item).pending, item.unit) },
    { key: 'receiver', header: '接收人', width: '100px', hideOnMobile: true, render: item => item.receiver },
    { key: 'state', header: '状态', width: '100px', render: item => { const status = statusOf(item); return <Pill tone={status.tone}>{uiText(status.label)}</Pill>; } },
  ];
  const revision = row ? internalDeliveryRevision(row) : 0;
  return <>
    <DataTable ariaLabel={uiText('内部交付记录')} columns={columns} rows={rows.slice().reverse()} rowKey={item => item.id} selectedKey={selectedId} onRowClick={item => onSelect(item.id)} loading={workspace.loading} empty={<EmptyState compact title={uiText('暂无内部交付记录')} />} />
    <Drawer open={!!row} title={uiText('内部交付')} sub={row?.orderCode} size="lg" onClose={() => { setEditor(null); onClose(); }}>
      {row && total && <div className="mist-col" data-internal-delivery={row.id}>
        <Facts cols={2} items={[{ label: '品名', value: row.lineName }, { label: '款号', value: <Mono>{row.style}</Mono> }, { label: '生产单', value: <Mono>{row.productionCode}</Mono> }, { label: '交付来源', value: uiText(row.source.kind === 'receipt' ? '工厂直接回交' : '成品出库') }, { label: '约定接收方', value: row.intendedReceiver }, { label: '本次接收账号', value: row.receiver }, { label: '交付地点', value: row.location }, { label: '实际交付日期', value: row.date }, { label: '交付数量', value: quantity(row.quantity, row.unit) }, { label: '已接收', value: quantity(total.accepted, row.unit) }, { label: '待接收', value: quantity(total.pending, row.unit) }, { label: '已拒收', value: quantity(total.rejected, row.unit) }, { label: '拒收已退回', value: quantity(total.returned, row.unit) }]} />
        <RecordDisclosure title="交接依据"><p>{row.created.evidence}</p><span className="mist-muted">{row.created.actor} · {shortWhen(row.created.at)}</span></RecordDisclosure>
        {!row.cancelled && <div className="mist-row mist-module-actions">
          {receiver && total.pending > 0 && <Button disabled={locked} onClick={() => open({ title: '登记内部点收', submitLabel: '保存点收', initialValues: { accepted: '', rejected: 0, evidence: '' }, fields: [field('accepted', '接收数量', 'number'), field('rejected', '拒收数量', 'number'), field('evidence', '点收依据', 'textarea')], submit: values => {
            const accepted = Number(values.accepted), rejected = Number(values.rejected);
            if (accepted + rejected <= 0 || accepted + rejected > total.pending) throw new Error('本次点收须大于零且不超过待接收数量');
            return workspace.run({ type: 'order.internal.receive', payload: { id: row.id, accepted, rejected, expectedRevision: revision, evidence: text(values, 'evidence') } });
          } })}>{uiText('登记点收')}</Button>}
          {receiver && row.checks.some(check => !check.reversed) && <Button disabled={locked} onClick={() => open({ title: '更正内部点收', submitLabel: '确认更正', initialValues: { checkId: '', reason: '' }, fields: [field('checkId', '原点收记录', 'select', true, row.checks.filter(check => !check.reversed).map(check => ({ value: check.id, label: `${row.checks.indexOf(check)+1}. ${shortWhen(check.at)} · ${check.actor} · ${uiText('接收')} ${check.accepted} / ${uiText('拒收')} ${check.rejected}` }))), field('reason', '更正原因', 'textarea')], submit: values => workspace.run({ type: 'order.internal.reverseCheck', payload: { id: row.id, checkId: text(values, 'checkId'), expectedRevision: revision, reason: text(values, 'reason') } }) })}>{uiText('更正点收')}</Button>}
          {sender && total.rejected > total.returned && <Button disabled={locked} onClick={() => open({ title: '登记拒收退回', submitLabel: '保存退回', initialValues: { quantity: '', date: businessToday(), evidence: '' }, fields: [field('quantity', '实际退回数量', 'number'), field('date', '实际退回日期', 'date'), field('evidence', '实际退回依据', 'textarea')], submit: values => workspace.run({ type: 'order.internal.returnRejected', payload: { id: row.id, quantity: Number(values.quantity), date: text(values, 'date'), evidence: text(values, 'evidence'), expectedRevision: revision } }) })}>{uiText('登记拒收退回')}</Button>}
          {sender && total.accepted === 0 && <Button disabled={locked} variant="quiet" onClick={() => open({ title: '撤回内部交付', submitLabel: '确认撤回', submitVariant: 'danger', initialValues: { reason: '' }, fields: [field('reason', '撤回原因与实物去向', 'textarea')], submit: values => workspace.run({ type: 'order.internal.cancel', payload: { id: row.id, expectedRevision: revision, reason: text(values, 'reason') } }) })}>{uiText('撤回交付')}</Button>}
        </div>}
        <RecordDisclosure title="点收与更正记录">
          {!row.checks.length && <span className="mist-muted">{uiText('尚未点收')}</span>}
          {row.checks.map(check => <div className="mist-col" key={check.id}><div>{check.actor} · {shortWhen(check.at)}{check.reversed && <Pill tone="neutral">{uiText('已更正')}</Pill>}</div><Facts cols={2} items={[{ label: '接收数量', value: quantity(check.accepted, row.unit) }, { label: '拒收数量', value: quantity(check.rejected, row.unit) }]} /><p>{check.evidence}</p>{check.reversed && <p>{check.reversed.actor} · {shortWhen(check.reversed.at)} · {check.reversed.evidence}</p>}</div>)}
          {row.returns.map(item => <div className="mist-col" key={item.id}><div>{uiText('拒收退回')} · {quantity(item.quantity, row.unit)} · {item.date}</div><p>{item.evidence}</p><span className="mist-muted">{item.actor} · {shortWhen(item.at)}</span></div>)}
          {row.cancelled && <p>{uiText('已撤回')} · {row.cancelled.actor} · {shortWhen(row.cancelled.at)} · {row.cancelled.evidence}</p>}
        </RecordDisclosure>
        {sourceOrder && <Button onClick={() => go('orders/detail', sourceOrder.id, { section: sourceOrder.type })}>{uiText('打开来源订单')}</Button>}
      </div>}
    </Drawer>
    <ModuleEditorDialog spec={editor} onClose={() => setEditor(null)} />
  </>;
}

export function InternalDeliveryPanel({ order }: { order: MistOrder }) {
  const workspace = useMistWorkspace(), session = useOptionalMistSession(), { go } = useNav();
  const [selected, setSelected] = React.useState<string>();
  if (!workspace.state || order.governance?.contract.kind !== 'internal' || order.governance.contract.internalSupply) return null;
  const rows = (workspace.state.internalDeliveries || []).filter(row => row.orderId === order.id);
  const writable = !!session?.hasPermission('orders:write') && ['orders:read', 'production:read', 'procurement:read'].every(permission => session?.hasPermission(permission));
  const ready = order.governance.status === 'approved' && !orderLocked(order) && order.governance.changeDraft?.status !== 'pending';
  return <Card data-internal-delivery-panel>
    <CardHeader title={uiText('内部交付')} tools={writable && ready ? <Button disabled={workspace.saving || !!workspace.pending} onClick={() => go('orders/detail', order.id, { section: 'internal-delivery-new' })}>{uiText('登记内部交付')}</Button> : undefined} />
    <InternalDeliveryRecords rows={rows} selectedId={selected} onSelect={setSelected} onClose={() => setSelected(undefined)} />
  </Card>;
}

export function InternalDeliveryInbox() {
  const workspace = useMistWorkspace(), session = useOptionalMistSession(), { route, go } = useNav();
  const rows = (workspace.state?.internalDeliveries || []).filter(row => row.receiverId === session?.user?.id);
  return <MistPage>
    <BackLink onClick={() => go('orders')}>{uiText('订单管理')}</BackLink>
    <PageHeader title={uiText('内部接收')} />
    {workspace.error && <Banner tone="bad" title={uiText('内部交付读取失败')} actions={<Button onClick={() => void workspace.refresh()}>{uiText('重试')}</Button>}>{workspace.error}</Banner>}
    {route.id && !workspace.loading && !rows.some(row => row.id === route.id) && <Banner tone="warn" title={uiText('未找到指定的内部交付')} />}
    <Card><InternalDeliveryRecords key={`${workspace.workspace?.id}:${session?.sessionKey}`} rows={rows} selectedId={route.id} onSelect={id => go('orders', id, { section: 'internal-deliveries' })} onClose={() => go('orders', undefined, { section: 'internal-deliveries' })} /></Card>
  </MistPage>;
}

export function InternalDeliveryCreate({ order, onClose }: { order: MistOrder; onClose: () => void }) {
  const workspace = useMistWorkspace(), session = useOptionalMistSession();
  const [expectedRevision] = React.useState(() => (workspace.state?.internalDeliveries || []).filter(row => row.orderId === order.id).length);
  const members = workspaceMembers(workspace.workspace, workspace.state, session?.user);
  // Keep the opening evidence and revision stable while awaiting the acknowledgement.
  // The service rechecks current quantities and membership; a stale form never silently adopts a new source.
  const [sources] = React.useState(() => workspace.state ? internalDeliverySources(workspace.state, order.id).filter(source => source.source.kind !== 'stockIssue' || session?.hasPermission('inventory:read')) : []);
  const allowed = order.governance?.contract.kind === 'internal' && !order.governance.contract.internalSupply && order.governance.status === 'approved' && !orderLocked(order) && order.governance.changeDraft?.status !== 'pending' && ['orders:write', 'orders:read', 'production:read', 'procurement:read'].every(permission => session?.hasPermission(permission));
  const [spec] = React.useState<ModuleEditorSpec>(() => ({
    title: '登记内部交付', submitLabel: '确认交付', initialValues: { source: '', quantity: '', receiverId: '', location: '', date: businessToday(), evidence: '' },
    sections: [{ id: 'handover', label: '实物与接收', fields: ['source', 'quantity', 'receiverId'] }, { id: 'evidence', label: '交付依据', fields: ['location', 'date', 'evidence'] }],
    fields: [field('source', '交付来源', 'select', true, sources.map(source => ({ value: source.key, label: `${source.style} · ${source.productionCode} · ${uiText(source.source.kind === 'receipt' ? '工厂直接回交' : '成品出库')} · ${source.date} · ${source.location} · ${source.evidence.slice(0,60)} · ${uiText('可交')} ${quantity(source.remaining, source.unit)}` }))), field('quantity', '本次交付数量', 'number'), field('receiverId', '本次接收账号', 'select', true, memberSelectOptions(members)), field('location', '交付地点'), field('date', '实际交付日期', 'date'), field('evidence', '交接依据', 'textarea')],
    submit: values => {
      if (!allowed) throw new Error('当前不能登记内部交付');
      const source = sources.find(item => item.key === values.source);
      if (!source) throw new Error('交付来源已变化，请重新核对');
      const amount = Number(values.quantity);
      if (amount <= 0 || amount > source.remaining) throw new Error('交付数量须大于零且不超过来源可交数量');
      return workspace.run({ type: 'order.internal.send', payload: { orderId: order.id, productionId: source.productionId, source: source.source, quantity: amount, receiverId: text(values, 'receiverId'), location: text(values, 'location'), date: text(values, 'date'), evidence: text(values, 'evidence'), expectedRevision } });
    },
  }));
  if (!allowed || !sources.length) return <MistPage><BackLink onClick={onClose}>{uiText('返回订单')}</BackLink><Card><CardBody><EmptyState title={uiText(!allowed ? '当前不能登记内部交付' : '暂无可交付的成品')} description={uiText(!allowed ? '请核对订单状态与来源读取权限' : '需有最终完工、有效 QC 及实际回交或成品出库')} /></CardBody></Card></MistPage>;
  return <ModuleEditorPage spec={spec} onClose={onClose} />;
}
