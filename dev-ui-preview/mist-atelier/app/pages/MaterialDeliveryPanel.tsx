import React from 'react';
import { Button, CardHeader, Facts, Mono, Pill } from '../../../../components/mist';
import { materialReceiverIds, type MaterialDeliveryRow } from '../../../../server/src/shared/mistInternalFabric';
import { uiText } from '../../../../services/interfaceLanguage';
import { useMistWorkspace } from '../runtime/workspace';
import { useOptionalMistSession } from '../runtime/auth';
import { ModuleEditorDialog, type ModuleEditorSpec } from './modules/ModuleWorkbench';
import { field, text } from './modules/fulfillmentKit';
import { RecordDisclosure, shortWhen } from './modules/pageKit';

export function MaterialDeliveryPanel({ rows }: { rows: MaterialDeliveryRow[] }) {
  const workspace = useMistWorkspace(), session = useOptionalMistSession();
  const [dialog, setDialog] = React.useState<ModuleEditorSpec | null>(null);
  React.useEffect(() => { setDialog(null); }, [workspace.workspace?.id, session?.sessionKey]);
  if (!rows.length) return null;
  const locked = workspace.saving || !!workspace.pending;
  return <section className="mist-col" data-material-deliveries>
    <CardHeader title={uiText('物料交接')} />
    {rows.slice().reverse().map(row => {
      const purchase = workspace.state?.fulfillment.purchases.find(p => p.id === row.purchaseId);
      const production = workspace.state?.productions.find(p => p.id === row.delivery.productionId);
      const contract = workspace.state?.fulfillment.purchases.find(p => p.id === production?.sourcePurchaseId);
      const currentOwner = workspace.state?.orders.find(o => o.id === row.delivery.orderId);
      const receiver = row.delivery.receivingChecks?.at(-1)?.actor || row.delivery.confirmation?.actor || currentOwner?.owner || row.delivery.receiver;
      const canReceive = row.pending !== '0' && !row.delivery.confirmation && !!workspace.state && materialReceiverIds(workspace.state, row).includes(session?.user?.id || '') && !!session?.hasPermission('orders:write');
      const status = row.outstanding === '0' ? '已退回' : row.pending !== '0' ? row.accepted !== '0' || row.rejected !== '0' ? '部分点收' : '待接收' : row.rejected !== '0' ? row.accepted !== '0' ? '部分接收' : '已拒收' : '已接收';
      const receive = () => setDialog(row.kind === 'direct' ? {
        title: '物料点收', submitLabel: '保存点收', fields: [field('acceptedQuantity', '接收数量', 'number'), field('rejectedQuantity', '拒收数量', 'number'), field('evidence', '工厂点收依据', 'textarea')],
        initialValues: { acceptedQuantity: '', rejectedQuantity: 0, evidence: '' },
        submit: values => {
          const acceptedQuantity = Number(values.acceptedQuantity), rejectedQuantity = Number(values.rejectedQuantity);
          if (acceptedQuantity + rejectedQuantity <= 0) throw new Error('接收与拒收数量至少有一项大于零');
          if (acceptedQuantity + rejectedQuantity > Number(row.pending)) throw new Error('本次点收超过待接收数量');
          return workspace.run({ type: 'fulfillment.materials.confirm', payload: { id: row.id, kind: row.kind, acceptedQuantity, rejectedQuantity, expectedReceivingRevision: row.delivery.receivingChecks?.length || 0, evidence: text(values, 'evidence') } });
        },
      } : { title: '确认物料接收', submitLabel: '确认接收', fields: [field('evidence', '工厂点收依据', 'textarea')], initialValues: { evidence: '' }, submit: values => workspace.run({ type: 'fulfillment.materials.confirm', payload: { id: row.id, kind: row.kind, evidence: text(values, 'evidence') } }) });
      return <div className="mist-col" key={row.kind + row.id} data-material-delivery={row.id}>
        <div className="mist-row" style={{ gap: 8, flexWrap: 'wrap' }}><Mono>{purchase?.code || uiText('来源采购')}</Mono><span>{row.kind === 'direct' ? row.quantity : row.outstanding} {uiText(row.unit)}</span><Pill tone={row.outstanding === '0' ? 'neutral' : row.pending !== '0' || row.rejected !== '0' ? 'warn' : 'ok'}>{uiText(status)}</Pill></div>
        <Facts cols={2} items={[{ label: '加工单', value: contract?.code || '来源不可用' }, { label: '加工厂', value: row.delivery.supplier }, { label: '接收负责人', value: receiver }, ...(row.kind === 'direct' ? [{ label: '已接收', value: `${row.accepted} ${row.unit}` }, { label: '已拒收', value: `${row.rejected} ${row.unit}` }, { label: '待接收', value: `${row.pending} ${row.unit}` }] : []), ...(row.returned !== '0' ? [{ label: '已退回', value: `${row.returned} ${row.unit}` }] : [])]} />
        <RecordDisclosure title="交接记录"><Facts cols={2} items={[{ label: '路径', value: row.kind === 'issue' ? '仓库发料' : '供应商直送' }, { label: '交接地点', value: row.location }, { label: '发料日期', value: shortWhen(row.at) }]} /><p>{row.evidence}</p>{row.delivery.confirmation && <><div>{row.delivery.confirmation.actor} · {shortWhen(row.delivery.confirmation.at)}</div><p>{row.delivery.confirmation.evidence}</p></>}{row.delivery.receivingChecks?.map(check => <div className="mist-col" key={check.id}><div>{check.actor} · {shortWhen(check.at)}</div><Facts cols={2} items={[{ label: '接收数量', value: `${check.acceptedQuantity} ${row.unit}` }, { label: '拒收数量', value: `${check.rejectedQuantity} ${row.unit}` }]} /><p>{check.evidence}</p></div>)}</RecordDisclosure>
        {canReceive && <Button disabled={locked} onClick={receive}>{uiText(row.kind === 'direct' ? '登记点收' : '确认接收')}</Button>}
      </div>;
    })}
    <ModuleEditorDialog spec={dialog} onClose={() => setDialog(null)} />
  </section>;
}
