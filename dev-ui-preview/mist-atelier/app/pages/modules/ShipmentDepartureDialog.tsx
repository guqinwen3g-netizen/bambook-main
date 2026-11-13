import { businessInputInstant } from '../../runtime/businessClock';
import React from 'react';
import { Banner, Button, Dialog, Field, FormGrid, TextArea, TextInput } from '../../../../../components/mist';
import type { FulfillmentShipment } from '../../../../../server/src/shared/mistFulfillment';
import { uiText } from '../../../../../services/interfaceLanguage';
import { useMistWorkspace } from '../../runtime/workspace';
import { DraftFiles, localNow } from './fulfillmentKit';

export function ShipmentDepartureDialog({ shipment, onClose }: { shipment: FulfillmentShipment; onClose: () => void }) {
  const workspace = useMistWorkspace();
  const sourceWorkspace = React.useRef(workspace.workspace?.id);
  const current = workspace.state?.fulfillment.shipments.find(row => row.id === shipment.id);
  const invalidSource = sourceWorkspace.current !== workspace.workspace?.id || (!!workspace.state && !current) || !!current?.hiddenCount || current?.state === 'departed' || current?.state === 'cancelled';
  // Receipt recovery or another operator can advance this record while the form still holds its opening snapshot.
  React.useEffect(() => { if (invalidSource) onClose(); }, [invalidSource, onClose]);
  const [at, setAt] = React.useState(localNow), [evidence, setEvidence] = React.useState('');
  const [fileIds, setFileIds] = React.useState([...shipment.fileIds]);
  const [busy, setBusy] = React.useState(false), [uploading, setUploading] = React.useState(false), [failure, setFailure] = React.useState('');
  const live = React.useRef(true), lock = React.useRef(false);
  React.useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const blocked = invalidSource || busy || uploading || workspace.saving || !!workspace.pending;
  const pending = workspace.pending;
  const unconfirmed = pending?.kind === 'command' && pending.workspaceId === sourceWorkspace.current && pending.command?.type === 'fulfillment.shipments.depart' && pending.command.payload.id === shipment.id;
  const submit = async () => {
    if (blocked || lock.current || !at || !evidence.trim()) return;
    lock.current = true; setBusy(true); setFailure('');
    try {
      await workspace.run({ type: 'fulfillment.shipments.depart', payload: { id: shipment.id, at: businessInputInstant(at), evidence: evidence.trim(), fileIds } });
      if (live.current) onClose();
    } catch (error) { if (live.current) setFailure(error instanceof Error ? error.message : '离港记录未保存'); }
    finally { lock.current = false; if (live.current) setBusy(false); }
  };
  return <Dialog open title={uiText(shipment.mode === 'air' ? '登记实际起飞' : '登记实际离港')} onClose={() => { if (!blocked) onClose(); }} footer={<><Button disabled={blocked} onClick={onClose}>{uiText('取消')}</Button><Button variant="primary" loading={busy} disabled={blocked || !at || !evidence.trim()} onClick={() => void submit()}>{uiText(shipment.mode === 'air' ? '登记起飞' : '登记离港')}</Button></>}>
    {failure && <Banner tone={unconfirmed ? 'warn' : 'bad'} title={uiText(unconfirmed ? '离港结果待核对' : '离港记录未保存')}>{failure}</Banner>}
    <FormGrid>
      <Field label={uiText(shipment.mode === 'air' ? '实际起飞时间（ATD）' : '实际离港时间（ATD）')} required><TextInput aria-label={uiText(shipment.mode === 'air' ? '实际起飞时间（ATD）' : '实际离港时间（ATD）')} type="datetime-local" value={at} disabled={blocked} onChange={event => setAt(event.target.value)} /></Field>
      <Field label={uiText('实际离港 / 起飞依据')} required full><TextArea aria-label={uiText('实际离港 / 起飞依据')} value={evidence} disabled={blocked} onChange={event => setEvidence(event.target.value)} /></Field>
      <Field label={uiText('出运凭据')} full><DraftFiles ids={fileIds} onChange={setFileIds} onBusyChange={setUploading} disabled={busy || workspace.saving || !!workspace.pending} hint={shipment.mode === 'air' ? '上传起飞通知或承运人凭据' : '上传离港通知或承运人凭据'} /></Field>
    </FormGrid>
  </Dialog>;
}
