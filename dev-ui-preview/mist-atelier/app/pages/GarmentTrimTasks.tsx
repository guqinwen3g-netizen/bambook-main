import React from 'react';
import { Button, Card, CardHeader, Facts, Pill, TextLink } from '../../../../components/mist';
import { trimNoticeCurrent, trimTaskChangeBlocker, type GarmentTrimTask, type TrimNotice } from '../../../../server/src/shared/mistGarmentTrimTasks';
import type { MistDev } from '../../../../server/src/shared/mistWorkspace';
import { uiText } from '../../../../services/interfaceLanguage';
import { useOptionalMistSession } from '../runtime/auth';
import { FailureNotice } from '../runtime/FailureNotice';
import { FileName } from '../runtime/files';
import { useMistWorkspace } from '../runtime/workspace';
import { useNav } from '../nav';
import { developmentNoticeBundle } from './developmentNoticeBundle';
import { ModuleEditorDialog, moduleFileIds, type ModuleEditorSpec } from './modules/ModuleWorkbench';
import { useRouteScope } from './modules/useRouteDraft';

export function GarmentTrimTasks({ dev }: { dev: MistDev }) {
  const w = useMistWorkspace(), session = useOptionalMistSession(), { go } = useNav(), scope = useRouteScope();
  const [editor, setEditor] = React.useState<ModuleEditorSpec | null>(null);
  const [packaging, setPackaging] = React.useState(''), [failure, setFailure] = React.useState('');
  const lock = React.useRef(false);
  const suppliers = (w.state?.market?.suppliers ?? []).filter(row => row.status === 'active');
  const tasks = dev.trimTasks ?? [], canWrite = session?.hasPermission('products:write') && !trimTaskChangeBlocker(dev);
  const canEditRequest = canWrite && session?.hasPermission('suppliers:read');
  const getFile = (id: string) => w.state?.files.find(file => file.id === id);
  const originals = (ids: string[]) => ids.map(id => {
    const file = getFile(id);
    return file ? <FileName key={id} file={file}/> : null;
  });
  const request = (task?: GarmentTrimTask) => {
    const revision = w.workspace?.revision;
    setEditor({
      title: task ? '修改辅料任务' : '安排辅料任务', submitLabel: '保存任务',
      fields: [
        { key: 'requirements', label: '开发要求', type: 'textarea', required: true },
        { key: 'supplierId', label: '供应商', type: 'select', required: true, options: suppliers.map(row => ({ value: row.id, label: row.name })) },
        { key: 'contact', label: '联系人' },
        { key: 'quantity', label: '数量', required: true },
        { key: 'unit', label: '单位', required: true },
        { key: 'dueDate', label: '交期', type: 'date', required: true },
        { key: 'fileIds', label: '任务附件', type: 'files' },
      ],
      initialValues: {
        requirements: task?.requirements ?? '', supplierId: task?.supplierId ?? '', contact: task?.contact ?? '',
        quantity: task?.quantity ?? '', unit: task?.unit ?? '', dueDate: task?.dueDate ?? '', fileIds: task?.fileIds.join(',') ?? '',
      },
      derive: (key, value) => {
        if (key !== 'supplierId') return {};
        const supplier = suppliers.find(row => row.id === value);
        const contact = supplier?.contacts?.find(row => row.primary) ?? supplier?.contacts?.[0];
        return { contact: contact?.name ?? '' };
      },
      submit: values => w.run({
        type: 'development.trimTask.save', payload: {
          devId: dev.id, ...(task ? { taskId: task.id } : {}), requirements: String(values.requirements ?? ''),
          supplierId: String(values.supplierId ?? ''), contact: String(values.contact ?? ''), quantity: String(values.quantity ?? ''),
          unit: String(values.unit ?? ''), dueDate: String(values.dueDate ?? ''), fileIds: moduleFileIds(values.fileIds),
        },
      }, revision === undefined ? undefined : { expectedRevision: revision }),
    });
  };
  const openConfirmation = (task: GarmentTrimTask) => {
    const revision = w.workspace?.revision;
    setEditor({
      title: '确认辅料', submitLabel: '确认', description: task.code + ' · ' + task.supplierName,
      fields: [
        { key: 'name', label: '辅料名称', required: true }, { key: 'specification', label: '最终规格', type: 'textarea', required: true },
        { key: 'color', label: '颜色' }, { key: 'fileIds', label: '最终原件', type: 'files' },
      ],
      initialValues: { name: '', specification: '', color: '', fileIds: '' },
      submit: values => w.run({
        type: 'development.trimTask.confirm', payload: {
          devId: dev.id, taskId: task.id, name: String(values.name ?? ''), specification: String(values.specification ?? ''),
          color: String(values.color ?? ''), fileIds: moduleFileIds(values.fileIds),
        },
      }, revision === undefined ? undefined : { expectedRevision: revision }),
    });
  };
  const catalog = (task: GarmentTrimTask) => {
    const revision = w.workspace?.revision;
    setEditor({
      title: '转为辅料档案', submitLabel: '建立档案', fields: [{ key: 'sku', label: '公司产品编码', required: true }],
      initialValues: { sku: '' }, description: task.confirmed?.name,
      submit: values => w.run({
        type: 'development.trimTask.catalog', payload: { devId: dev.id, taskId: task.id, sku: String(values.sku ?? '') },
      }, revision === undefined ? undefined : { expectedRevision: revision }),
    });
  };
  const generate = (task: GarmentTrimTask) => {
    setFailure('');
    void w.run({ type: 'development.trimTask.notice', payload: { devId: dev.id, taskId: task.id } })
      .catch(error => { if (scope.isCurrent()) setFailure(error instanceof Error ? error.message : String(error)); });
  };
  const download = (notice: TrimNotice) => {
    const file = getFile(notice.fileId);
    if (!file) return;
    setFailure('');
    void w.downloadFile(file).catch(error => { if (scope.isCurrent()) setFailure(error instanceof Error ? error.message : String(error)); });
  };
  const bundle = async (notice: TrimNotice) => {
    if (lock.current || !w.state) return;
    lock.current = true;
    setFailure('');
    setPackaging(notice.fileId);
    try {
      const result = await developmentNoticeBundle(notice, w.state.files, w.readFile, scope.isCurrent);
      if (!scope.isCurrent()) return;
      const url = URL.createObjectURL(new Blob([new Uint8Array(result.bytes).buffer], { type: 'application/zip' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) {
      if (scope.isCurrent()) setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      lock.current = false;
      if (scope.isCurrent()) setPackaging('');
    }
  };
  if (!tasks.length && !canEditRequest) return null;
  return <Card aria-label={uiText('辅料任务')}>
    <CardHeader title={uiText('辅料任务')} tools={canEditRequest ?
      <Button size="sm" onClick={() => request()} disabled={!suppliers.length}>{uiText('安排辅料任务')}</Button> : undefined}/>
    {failure && <FailureNotice title="辅料操作未完成" detail={failure}/>}
    {tasks.map(task => {
      const current = !!w.state && trimNoticeCurrent(w.state, dev, task);
      const product = w.state?.market.products.find(row => row.id === task.catalogProductId);
      return <div key={task.id} className="mist-section" data-trim-task={task.id}>
        <div className="mist-row" style={{ flexWrap: 'wrap' }}>
          <strong>{task.code} · {task.supplierName}</strong>
          <Pill tone={task.confirmed ? 'ok' : 'neutral'}>{uiText(task.confirmed ? '已确认' : '待确认')}</Pill>
        </div>
        <Facts items={[
          { label: '开发要求', value: task.requirements }, { label: '数量', value: task.quantity + ' ' + task.unit },
          { label: '交期', value: task.dueDate }, ...(task.contact ? [{ label: '联系人', value: task.contact }] : []),
          ...(task.confirmed ? [
            { label: '辅料名称', value: task.confirmed.name }, { label: '最终规格', value: task.confirmed.specification },
            { label: '颜色', value: task.confirmed.color || '—' }, { label: '确认人', value: task.confirmed.by },
          ] : []),
        ]}/>
        <div className="mist-col">{originals(task.fileIds)}{task.confirmed && originals(task.confirmed.fileIds)}</div>
        {task.notices.map((notice, index) => <div key={notice.fileId} className="mist-row" style={{ flexWrap: 'wrap' }}>
          <span>{notice.noticeNo}</span>
          {index === task.notices.length - 1 && current && <Pill tone="ok">{uiText('当前')}</Pill>}
          <Button size="sm" variant="quiet" disabled={!getFile(notice.fileId)} onClick={() => download(notice)}>{uiText('通知单')}</Button>
          <Button size="sm" variant="quiet" loading={packaging === notice.fileId} disabled={!!packaging || !notice.snapshot.attachments.length}
            onClick={() => void bundle(notice)}>{uiText('附件包 (zip)')}</Button>
        </div>)}
        <div className="mist-row" style={{ flexWrap: 'wrap' }}>
          {canEditRequest && !task.confirmed && <Button size="sm" onClick={() => request(task)}>{uiText('修改要求')}</Button>}
          {canWrite && !task.confirmed && !current && <Button size="sm" disabled={w.saving || !!w.pending} onClick={() => generate(task)}>{uiText('生成辅料通知单')}</Button>}
          {canWrite && !task.confirmed && current && <Button size="sm" onClick={() => openConfirmation(task)}>{uiText('确认辅料')}</Button>}
          {canEditRequest && task.confirmed && !task.catalogProductId && <Button size="sm" onClick={() => catalog(task)}>{uiText('转为辅料档案')}</Button>}
          {product && <TextLink onClick={() => go('products', product.id, { detail: 'full' })}>{product.sku} · {product.name}</TextLink>}
        </div>
      </div>;
    })}
    <ModuleEditorDialog spec={editor} onClose={() => setEditor(null)}/>
  </Card>;
}
