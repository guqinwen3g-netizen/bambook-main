import { MaterialDeliveryPanel } from './MaterialDeliveryPanel';
import React from 'react';
import { Banner, Button, CardHeader, Dialog, EmptyState, Facts, Field, FormGrid, Mono, Select, TextInput, useToast } from '../../../../components/mist';
import type { MistOrder, MistOrderLine } from '../../../../server/src/shared/mistWorkspace';
import { garmentMaterialBlocker, materialDeliveryRows, internalFabricCandidates, internalFabricRemaining, normalizeInternalMetres, type InternalFabricCandidate } from '../../../../server/src/shared/mistInternalFabric';
import { uiText } from '../../../../services/interfaceLanguage';
import { useMistWorkspace } from '../runtime/workspace';
import { useOptionalMistSession } from '../runtime/auth';
import { workspaceMembers } from '../runtime/members';
import { orderLocked } from './OrderTermination';
import type { ClosableLine } from '../../../../server/src/shared/mistOrderClosure';

type Props = { order: MistOrder; line: MistOrderLine; go: (view: string, id?: string, target?: Record<string, string | undefined>) => void };
function sumMetres(values: string[]): string {
  const value = values.reduce((sum, text) => { const [whole, fraction = ''] = text.split('.'); return sum + BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0')); }, 0n);
  const fraction = String(value % 10000n).padStart(4, '0').replace(/0+$/, '');
  return String(value / 10000n) + (fraction ? '.' + fraction : '');
}

export function InternalFabricPanel({ order, line, go }: Props) {
  const workspace = useMistWorkspace(), session = useOptionalMistSession(), toast = useToast(), state = workspace.state;
  const members = workspaceMembers(workspace.workspace, state, session?.user);
  // This projected directory is only for local choices. Each command rechecks current account status on the server.
  const context = { actorId: session?.user?.id, actorName: session?.user?.displayName || '', members: members.map(member => ({ ...member, active: true })) };
  const scope = `${workspace.workspace?.id || ''}:${session?.sessionKey || ''}:${session?.user?.id || ''}:${order.id}:${line.id}`;
  const live = React.useRef(true), lock = React.useRef(false), currentScope = React.useRef(scope); currentScope.current = scope;
  const [editing, setEditing] = React.useState(false), [cancelling, setCancelling] = React.useState(false), [fabricLineId, setFabricLineId] = React.useState(''), [metres, setMetres] = React.useState(''), [failure, setFailure] = React.useState(''), [busy, setBusy] = React.useState(false);
  React.useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  React.useEffect(() => { lock.current = false; setBusy(false); setEditing(false); setCancelling(false); setFailure(''); setFabricLineId(''); setMetres(''); }, [scope]);
  const allocation = state?.internalFabricAllocations?.find(row => row.orderId === order.id && row.lineId === line.id), activeAllocation = allocation?.status === 'active' ? allocation : undefined;
  const isGarment = order.type === 'garment' && (line.fulfillmentMode === 'full_package' || !!activeAllocation);
  const isSource = order.type === 'fabric' && !!order.governance?.contract.internalSupply;
  const rows = state?.internalFabricAllocations?.filter(row => row.fabricOrderId === order.id && row.fabricLineId === line.id && row.status === 'active') || [];
  const blocked = busy || workspace.loading || workspace.saving || !!workspace.pending || !!workspace.pendingCreate || orderLocked(order) || order.governance?.status === 'pending' || order.governance?.changeDraft?.status === 'pending' || (line as ClosableLine).closure?.status === 'closed' || (line as ClosableLine).closure?.status === 'pending';
  const canWrite = !!session?.hasPermission('orders:write') && members.some(member => member.id === session?.user?.id && member.groups.includes('garment'));
  let candidates: InternalFabricCandidate[] = [], candidateError = '', materialBlocker = '', remaining = '', sourceError = '';
  if (state && isGarment) {
    materialBlocker = garmentMaterialBlocker(state, order.id, line.id, context);
    if (canWrite) try { candidates = internalFabricCandidates(state, order.id, line.id, context); } catch (error) { candidateError = error instanceof Error ? error.message : '来源暂不可用'; }
  }
  if (state && isSource) try { remaining = internalFabricRemaining(state, line.id); } catch (error) { sourceError = error instanceof Error ? error.message : '余量暂不可用'; }
  if (!state || (!isGarment && !isSource)) return null;
  const deliveries = materialDeliveryRows(state).filter(row => isSource ? state.fulfillment.purchases.find(p => p.id === row.purchaseId)?.lineId === line.id : row.delivery.lineId === line.id);
  const physicallyCommitted = deliveries.some(row => row.outstanding !== '0');
  const selected = candidates.find(row => row.fabricLineId === fabricLineId), sourceOrder = state.orders.find(row => row.id === activeAllocation?.fabricOrderId), sourceLine = state.orderLines.find(row => row.id === activeAllocation?.fabricLineId);
  const startEdit = () => { setFailure(''); setFabricLineId(activeAllocation?.fabricLineId || ''); setMetres(activeAllocation?.metres || ''); setEditing(true); };
  const apply = async (cancel: boolean) => {
    if (blocked || lock.current || !canWrite) return;
    let amount = '';
    if (!cancel) {
      if (!selected) { setFailure('请选择内部面料'); return; }
      try { amount = normalizeInternalMetres(metres); } catch (error) { setFailure(error instanceof Error ? error.message : '请填写有效米数'); return; }
    }
    if (cancel && !activeAllocation) return;
    const bound = scope; lock.current = true; setBusy(true); setFailure('');
    try {
      await workspace.run(cancel ? { type: 'order.fabric.cancel', payload: { id: activeAllocation!.id, expectedRevision: activeAllocation!.revision } } : { type: 'order.fabric.allocate', payload: { orderId: order.id, lineId: line.id, fabricOrderId: selected!.fabricOrderId, fabricLineId: selected!.fabricLineId, metres: amount, expectedRevision: allocation?.revision || 0 } });
      if (live.current && currentScope.current === bound) { setEditing(false); setCancelling(false); toast(cancel ? '面料分配已取消' : '面料分配已保存'); }
    } catch (error) { if (live.current && currentScope.current === bound) setFailure(error instanceof Error ? error.message : '分配未保存'); }
    finally { if (live.current && currentScope.current === bound) { lock.current = false; setBusy(false); } }
  };
  return <section className="mist-col" data-internal-fabric={line.id}>
    <CardHeader title={uiText(isSource ? '成衣分配' : '内部面料')} />
    {(failure || candidateError || sourceError) && <Banner tone="bad" title={uiText('面料分配未完成')}>{failure || candidateError || sourceError}</Banner>}
    {isSource ? <>
      <Facts cols={2} items={[{ label: '接收负责人', value: order.governance?.contract.receiver || '待确认' }, { label: '已分配', value: `${sumMetres(rows.map(row => row.metres))} 米` }, { label: '剩余', value: sourceError ? '待核对' : `${remaining} 米` }]} />
      {rows.length ? rows.map(row => { const targetOrder = state.orders.find(item => item.id === row.orderId), targetLine = state.orderLines.find(item => item.id === row.lineId); return <div className="mist-row" key={row.id} style={{ gap: 8, flexWrap: 'wrap' }}><span>{targetOrder?.code || '成衣订单'} · {targetLine?.style || targetLine?.name || '条目'}</span><span className="mist-spacer" /><span>{row.metres} {uiText('米')}</span><Button variant="quiet" onClick={() => go('orders/detail', row.orderId, { orderLineId: row.lineId, section: 'garment' })}>{uiText('查看成衣条目')}</Button></div>; }) : <EmptyState compact title={uiText('暂无成衣分配')} />}
    </> : <>
      {activeAllocation && <><Facts cols={2} items={[{ label: '面料订单', value: sourceOrder ? <Mono>{sourceOrder.code}</Mono> : '来源不可用' }, { label: '面料条目', value: sourceLine ? `${sourceLine.style} · ${sourceLine.name}` : '来源不可用' }, { label: '本单分配', value: `${activeAllocation.metres} 米` }, { label: '来源剩余', value: (() => { try { return `${internalFabricRemaining(state, activeAllocation.fabricLineId)} 米`; } catch { return '待核对'; } })() }]} /><Button variant="quiet" onClick={() => go('orders/detail', activeAllocation.fabricOrderId, { orderLineId: activeAllocation.fabricLineId, section: 'fabric' })}>{uiText('查看面料来源')}</Button></>}
      {materialBlocker && <Banner tone="warn" title={uiText('用料待落实')}>{materialBlocker}</Banner>}
      {canWrite && !editing && <div className="mist-row" style={{ gap: 8 }}><Button disabled={blocked || physicallyCommitted || !!candidateError} title={physicallyCommitted ? uiText('已发料，须先退回') : undefined} onClick={startEdit}>{uiText(activeAllocation ? '调整分配' : '分配面料')}</Button>{activeAllocation && <Button variant="quiet" disabled={blocked || physicallyCommitted} title={physicallyCommitted ? uiText('已发料，须先退回') : undefined} onClick={() => { setFailure(''); setCancelling(true); }}>{uiText('取消分配')}</Button>}</div>}
      {editing && <>
        {candidates.length ? <FormGrid><Field label={uiText('内部面料')} required><Select aria-label={uiText('内部面料')} value={fabricLineId} disabled={blocked} placeholder={uiText('选择内部面料')} options={candidates.map(row => ({ value: row.fabricLineId, label: `${row.orderCode} · ${row.lineName}` }))} onChange={event => setFabricLineId(event.target.value)} /></Field><Field label={uiText('分配米数')} required><TextInput aria-label={uiText('分配米数')} type="number" min="0.0001" step="0.0001" value={metres} disabled={blocked} onChange={event => setMetres(event.target.value)} /></Field></FormGrid> : <EmptyState compact title={uiText('暂无可用内部面料')} />}
        {selected && <Facts cols={2} items={[{ label: '面料数量', value: `${selected.quantity} 米` }, { label: '可分配', value: `${selected.remaining} 米` }]} />}
        <div className="mist-row" style={{ gap: 8 }}><Button disabled={blocked || !selected} loading={busy} onClick={() => void apply(false)}>{uiText('保存分配')}</Button><Button variant="quiet" disabled={busy} onClick={() => { setEditing(false); setFailure(''); }}>{uiText('收起')}</Button></div>
      </>}
      <Dialog open={cancelling} title={uiText('取消面料分配')} onClose={() => { if (!busy) setCancelling(false); }} footer={<><Button disabled={busy} onClick={() => setCancelling(false)}>{uiText('返回')}</Button><Button variant="danger" disabled={blocked} loading={busy} onClick={() => void apply(true)}>{uiText('确认取消分配')}</Button></>}>
        {failure && <Banner tone="bad" title={uiText('取消未完成')}>{failure}</Banner>}{activeAllocation && <Facts items={[{ label: '面料', value: `${sourceOrder?.code || ''} · ${sourceLine?.style || ''}` }, { label: '释放米数', value: `${activeAllocation.metres} 米` }]} />}
      </Dialog>
    </>}
    <MaterialDeliveryPanel rows={deliveries} />
  </section>;
}
