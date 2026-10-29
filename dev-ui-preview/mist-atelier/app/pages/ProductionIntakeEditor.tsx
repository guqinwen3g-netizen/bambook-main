import React from 'react';
import { BackLink, Banner, Button, Card, Checkbox, Field, FormFooter, FormGrid, FormSection, KeyValue, MistPage, PageHeader, Select, TextArea, TextInput, VerticalSteps, useToast } from '../../../../components/mist';
import { OBSERVED_PRODUCTION_STAGES, observedProductionStages, productionIntake, productionObservation, type ProductionObservationInput } from '../../../../server/src/shared/mistProductionIntake';
import { uiText } from '../../../../services/interfaceLanguage';
import { businessToday } from '../runtime/businessClock';
import { useMistWorkspace } from '../runtime/workspace';
import { useMistSession } from '../runtime/auth';
import { DraftFiles, RecordFiles } from './modules/fulfillmentKit';
import { MistPresentedErrorContext } from '../runtime/errorPresentation';

export function ProductionIntakeEditor({ productionId, initial, onClose }: { productionId: string; initial: boolean; onClose: () => void }) {
  const workspace = useMistWorkspace(), session = useMistSession(), toast = useToast();
  const presentedError=React.useContext(MistPresentedErrorContext);
  const previous = workspace.state && (productionObservation(workspace.state, productionId) || productionIntake(workspace.state, productionId)?.snapshot);
  const branch=workspace.state?.productions.find(p=>p.id===productionId),order=workspace.state?.orders.find(o=>o.id===branch?.orderId);
  const unit=workspace.state?.orderLines.find(line=>line.id===branch?.lineId&&line.orderId===branch?.orderId)?.unit||'';
  const labels=observedProductionStages(order?.type);
  const existingFiles=(order?.fileIds||[]).flatMap(id=>{const file=workspace.state?.files.find(f=>f.id===id);return file?[file]:[];});
  const [values, setValues] = React.useState({ asOf: businessToday(), startedOn: previous?.startedOn || '', stage: '', percent: '', quantity: '', sourceName: '', evidence: '' });
  const [fileIds, setFileIds] = React.useState<string[]>([]), [step, setStep] = React.useState(0), [busy, setBusy] = React.useState(false), [uploading, setUploading] = React.useState(false), [failure, setFailure] = React.useState('');
  const alive = React.useRef(true), lock = React.useRef(false);
  const scope = `${workspace.workspace?.id}|${session.user?.id}|${productionId}`, origin = React.useRef(scope), currentScope = React.useRef(scope); currentScope.current = scope;
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const current = () => alive.current && currentScope.current === origin.current;
  const blocked = busy || uploading || workspace.saving || !!workspace.pending || !!workspace.pendingCreate || scope !== origin.current;
  const change = (key: keyof typeof values, value: string) => { setValues(v => ({ ...v, [key]: value })); setFailure(''); };
  const validateProgress = () => {
    if (!values.asOf) return '请填写进度截至日';
    if (values.percent !== '' && (!Number.isFinite(Number(values.percent)) || Number(values.percent) < 0 || Number(values.percent) > 100)) return '工厂进度须在0至100之间';
    return '';
  };
  const save = async () => {
    if (blocked || lock.current || !current()) return;
    const error = validateProgress() || (!values.sourceName.trim() ? '请填写资料来源' : !values.evidence.trim() ? '请填写事实依据' : '');
    if (error) { setFailure(error); return; }
    lock.current = true; setBusy(true); setFailure('');
    const payload: ProductionObservationInput = { productionId, asOf: values.asOf, ...(values.startedOn ? { startedOn: values.startedOn } : {}), stage: values.stage ? values.stage as ProductionObservationInput['stage'] : null, percent: values.percent === '' ? null : Number(values.percent), quantity: values.quantity === '' ? null : Number(values.quantity), sourceName: values.sourceName, evidence: values.evidence, fileIds };
    try { await workspace.run({ type: initial ? 'fulfillment.production.intake' : 'fulfillment.production.observe', payload }); if (current()) { toast(initial ? '承接已提交' : '实际进度已登记'); onClose(); } }
    catch (problem) { if (current()) setFailure(problem instanceof Error ? problem.message : '未能保存'); }
    finally { lock.current = false; if (current()) setBusy(false); }
  };
  const recover=async()=>{
    if(lock.current||busy||!current())return;
    const command=workspace.pending?.command;
    const mine=(command?.type==='fulfillment.production.intake'||command?.type==='fulfillment.production.observe')&&command.payload.productionId===productionId;
    lock.current=true;setBusy(true);
    try{const saved=await workspace.recover();if(saved&&mine&&current())onClose();}
    catch(e){if(current())setFailure(e instanceof Error?e.message:'核对失败');}
    finally{lock.current=false;if(current())setBusy(false);}
  };
  return <MistPage><BackLink onClick={() => { if (!busy) onClose(); }}>{uiText('返回生产单')}</BackLink>
    <PageHeader title={uiText(initial ? '登记线下在制' : '登记实际进度')} />
    {failure && presentedError!==failure && <Banner tone="bad" title={uiText('未能保存')}>{failure}</Banner>}
    {(workspace.pending || workspace.pendingCreate) && <Banner tone="warn" title={uiText('请先核对上次操作')} actions={<Button disabled={busy || workspace.saving} onClick={()=>void recover()}>{uiText('核对原请求')}</Button>} />}
    <div className="mist-wizard"><VerticalSteps current={String(step)} onSelect={id => { if (!blocked && Number(id) < step) setStep(Number(id)); }} steps={[{ id: '0', label: '生产事实', done: step > 0 }, { id: '1', label: '来源依据', done: step > 1 }, { id: '2', label: '确认' }]} /><Card>
      <FormSection title={uiText(['生产事实','来源依据','确认'][step])}>{step === 2 ? <><KeyValue items={[{label:'生产单',value:branch?.code||''},{label:'工厂',value:branch?.factory||''},{label:'计划数量',value:branch?`${branch.qty} ${unit}`:''},{label:'进度截至日',value:values.asOf},{label:'实际开产日',value:values.startedOn||'待核'},{label:'实际工序',value:values.stage?labels[values.stage as keyof typeof OBSERVED_PRODUCTION_STAGES]:'待核'},{label:'工厂进度',value:values.percent===''?'待核':values.percent+'%'},{label:'本工序已完成数量',value:values.quantity?`${values.quantity} ${unit}`:'待核'},{label:'资料来源',value:values.sourceName},{label:'事实依据',value:values.evidence}]}/><RecordFiles ids={fileIds}/></> : step === 0 ? <FormGrid>
        <Field label={uiText('进度截至日')} required><TextInput aria-label={uiText('进度截至日')} type="date" value={values.asOf} disabled={blocked} onChange={e => change('asOf', e.target.value)} /></Field>
        <Field label={uiText('实际开产日')}><TextInput aria-label={uiText('实际开产日')} type="date" value={values.startedOn} disabled={blocked} onChange={e => change('startedOn', e.target.value)} /></Field>
        <Field label={uiText('实际工序')}><Select aria-label={uiText('实际工序')} value={values.stage} disabled={blocked} options={[{ value: '', label: '待核' }, ...Object.entries(labels).map(([value, label]) => ({ value, label }))]} onChange={e => change('stage', e.target.value)} /></Field>
        <Field label={uiText('工厂进度（%）')}><TextInput aria-label={uiText('工厂进度（%）')} type="number" min={0} max={100} value={values.percent} placeholder={uiText('待核')} disabled={blocked} onChange={e => change('percent', e.target.value)} /></Field>
        <Field label={uiText('本工序已完成数量')}><TextInput aria-label={uiText('本工序已完成数量')} type="number" min={0} step="0.0001" value={values.quantity} placeholder={uiText('待核')} disabled={blocked} onChange={e => change('quantity', e.target.value)} /></Field>
      </FormGrid> : <FormGrid>
        <Field label={uiText('资料来源')} required full><TextInput aria-label={uiText('资料来源')} value={values.sourceName} disabled={blocked} onChange={e => change('sourceName', e.target.value)} /></Field>
        <Field label={uiText('事实依据')} required full><TextArea aria-label={uiText('事实依据')} value={values.evidence} disabled={blocked} onChange={e => change('evidence', e.target.value)} /></Field>
        {!!existingFiles.length&&<div className="mist-field" data-full role="group" aria-label={uiText('订单已有资料')}><span className="mist-field-label">{uiText('订单已有资料')}</span><div className="mist-col">{existingFiles.map(file=><Checkbox key={file.id} label={file.name} checked={fileIds.includes(file.id)} disabled={blocked} onChange={checked=>setFileIds(ids=>checked?[...new Set([...ids,file.id])]:ids.filter(id=>id!==file.id))}/>)}</div></div>}
        <div className="mist-field" data-full role="group" aria-label={uiText('原始凭据')}><span className="mist-field-label">{uiText('原始凭据')}</span><DraftFiles ids={fileIds} onChange={ids => { if (current()) setFileIds(ids); }} disabled={blocked} onBusyChange={setUploading} hint="上传原始凭据" /></div>
      </FormGrid>}</FormSection>
      <FormFooter><Button disabled={blocked} onClick={onClose}>{uiText('取消')}</Button><span className="mist-spacer" />{step > 0 && <Button disabled={blocked} onClick={() => setStep(step-1)}>{uiText('上一步')}</Button>}{step < 2 ? <Button variant="primary" disabled={blocked} onClick={() => { const error = validateProgress()||(step===1&&(!values.sourceName.trim()||!values.evidence.trim())?'请填写资料来源和事实依据':''); if (error) setFailure(error); else setStep(step+1); }}>{uiText('下一步')}</Button> : <Button variant="primary" disabled={blocked} loading={busy} onClick={() => void save()}>{uiText(initial ? '提交承接' : '保存实际进度')}</Button>}</FormFooter>
    </Card></div>
  </MistPage>;
}
