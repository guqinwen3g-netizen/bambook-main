import { uiText } from '../../../../../services/interfaceLanguage';
/** 公司管理 · 印章：管理员登记电子印章并指定用印人；所有成员可查看印章与用印记录，印章图片只给管理员和该章用印人。
 *  用印本身在签发单据时发生（单据中心「签发」），这里只登记、停用和查记录。 */
import React from 'react';
import { Ban, Plus, Stamp } from 'lucide-react';
import type { MistFile, MistState } from '../../../../../server/src/shared/mistWorkspace';
import { Banner, Button, Checkbox, DataTable, Dialog, EmptyState, Field, FormGrid, FormSection, Mono, Pill, Select, TextArea, TextInput, UploadZone, useToast, type Column } from '../../../../../components/mist';
import { useMistWorkspace } from '../../runtime/workspace';
import { useOptionalMistSession } from '../../runtime/auth';
import { workspaceMembers } from '../../runtime/members';
import { businessWhen } from './pageKit';

export type SealKind = 'company' | 'contract' | 'finance' | 'customs' | 'other';
/** fileId 只下发给公司管理员和该章用印人；其他成员看到的行没有 fileId。 */
export type MistSealView = { id: string; name: string; kind: SealKind; fileId?: string; userIds: string[]; status: 'active' | 'disabled'; createdAt: string; createdBy: string; updatedAt: string; disabledAt?: string; disabledBy?: string; disabledReason?: string };
export type MistSealUseView = { id: string; sealId: string; sealName: string; documentKind: string; documentId: string; documentNumber: string; fileId?: string; actorId: string; actor: string; at: string; reason: string };
type SealState = MistState & { seals?: MistSealView[]; sealUses?: MistSealUseView[] };
export const SEAL_KIND_LABEL: Record<SealKind, string> = { company: '公章', contract: '合同专用章', finance: '财务专用章', customs: '报关专用章', other: '其他印章' };
export const sealsOf = (state: MistState | null | undefined) => ((state as SealState | null | undefined)?.seals ?? []);
export const sealUsesOf = (state: MistState | null | undefined) => ((state as SealState | null | undefined)?.sealUses ?? []);
/** 当前账号可用于签发的印章：启用中且本人在用印人名单内。 */
export const usableSeals = (state: MistState | null | undefined, userId: string | undefined) => sealsOf(state).filter(seal => seal.status === 'active' && !!userId && seal.userIds.includes(userId));

// 只收 PNG：SVG 可携带脚本，印章会进入对外 PDF。
const ACCEPT = 'image/png';
type Draft = { id?: string; name: string; kind: SealKind; fileId: string; userIds: string[] };

function SealImage({ fileId, state }: { fileId?: string; state: MistState }) {
  const { readFile } = useMistWorkspace(), file = fileId ? state.files.find(f => f.id === fileId) : undefined;
  const [url, setUrl] = React.useState('');
  React.useEffect(() => {
    if (!file) return; let live = true, made = '';
    void readFile(file as MistFile).then(blob => { if (!live) return; made = URL.createObjectURL(blob); setUrl(made); }).catch(() => undefined);
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [file?.id]);
  return <span className="mist-seal-image" data-empty={!url || undefined}>{url ? <img src={url} alt={uiText('印章图片')} /> : <Stamp size={22} aria-hidden="true" />}</span>;
}

export function CompanySealsSection({ canManage }: { canManage: boolean }) {
  const workspace = useMistWorkspace(), { state, run, uploadFile, saving, pending } = workspace, toast = useToast(), session = useOptionalMistSession();
  const [draft, setDraft] = React.useState<Draft | null>(null), [disable, setDisable] = React.useState<MistSealView | null>(null), [reason, setReason] = React.useState('');
  const [failure, setFailure] = React.useState(''), [uploading, setUploading] = React.useState(false);
  if (!state) return null;
  // 与负责人选择同一份公司名册（含公司库创建人），只能从在册成员中指定用印人。
  const seals = sealsOf(state), uses = sealUsesOf(state), members = workspaceMembers(workspace.workspace, state, session?.user);
  const busy = saving || !!pending || uploading;
  const nameOf = (id: string) => members.find(m => m.id === id)?.name ?? id;
  const upload = async (files: File[]) => {
    const file = files[0]; if (!file || !draft) return;
    if (file.type !== 'image/png') { setFailure('印章图片须为透明底 PNG'); return; }
    setUploading(true); setFailure('');
    try { const stored = await uploadFile(file); setDraft(d => d && { ...d, fileId: stored.id }); }
    catch (e) { setFailure(e instanceof Error ? e.message : '印章图片上传失败'); }
    finally { setUploading(false); }
  };
  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) return setFailure('请填写印章名称');
    if (!draft.fileId) return setFailure('请上传印章图片');
    if (!draft.userIds.length) return setFailure('请至少指定一名用印人');
    setFailure('');
    try { await run({ type: 'seal.save', payload: { ...(draft.id ? { id: draft.id } : {}), name: draft.name.trim(), kind: draft.kind, fileId: draft.fileId, userIds: draft.userIds } } as never); setDraft(null); toast('印章已保存'); }
    catch (e) { setFailure(e instanceof Error ? e.message : '印章保存失败'); }
  };
  const confirmDisable = async () => {
    if (!disable) return;
    if (!reason.trim()) return setFailure('请填写停用原因');
    setFailure('');
    try { await run({ type: 'seal.disable', payload: { id: disable.id, reason: reason.trim() } } as never); setDisable(null); setReason(''); toast('印章已停用'); }
    catch (e) { setFailure(e instanceof Error ? e.message : '印章停用失败'); }
  };
  const columns: Column<MistSealView>[] = [
    { key: 'seal', header: '印章', width: 'minmax(220px,2fr)', render: s => <span className="mist-row" style={{ gap: 12 }}><SealImage fileId={s.fileId} state={state} /><span className="mist-col" style={{ gap: 2 }}><span>{s.name}</span><span className="mist-note">{uiText(SEAL_KIND_LABEL[s.kind])}</span></span></span> },
    { key: 'users', header: '用印人', width: 'minmax(160px,1.4fr)', render: s => s.userIds.map(nameOf).join('、') },
    { key: 'status', header: '状态', width: '96px', render: s => <Pill tone={s.status === 'active' ? 'ok' : 'neutral'}>{uiText(s.status === 'active' ? '启用' : '已停用')}</Pill> },
    ...(canManage ? [{ key: 'act', header: '', width: '150px', render: (s: MistSealView) => s.status === 'active' ? <span className="mist-row" style={{ gap: 4, justifyContent: 'flex-end' }}>
      <Button size="sm" variant="quiet" disabled={busy} onClick={() => { setFailure(''); setDraft({ id: s.id, name: s.name, kind: s.kind, fileId: s.fileId ?? '', userIds: [...s.userIds] }); }}>{uiText('编辑')}</Button>
      <Button size="sm" variant="quiet" icon={Ban} disabled={busy} onClick={() => { setFailure(''); setReason(''); setDisable(s); }}>{uiText('停用')}</Button></span> : null }] : []),
  ];
  const useColumns: Column<MistSealUseView>[] = [
    { key: 'at', header: '时间', width: '150px', render: u => <span className="mist-num">{businessWhen(u.at)}</span> },
    { key: 'seal', header: '印章', width: 'minmax(120px,1fr)', render: u => u.sealName },
    { key: 'doc', header: '单据', width: 'minmax(140px,1.2fr)', render: u => <Mono>{u.documentNumber}</Mono> },
    { key: 'actor', header: '用印人', width: '96px', render: u => u.actor },
    { key: 'reason', header: '事由', width: 'minmax(160px,2fr)', render: u => u.reason },
  ];
  return <>
    <FormSection title={uiText('印章')}>
      {canManage && <div className="mist-row" style={{ justifyContent: 'flex-end' }}><Button icon={Plus} disabled={busy} onClick={() => { setFailure(''); setDraft({ name: '', kind: 'company', fileId: '', userIds: [] }); }}>{uiText('登记印章')}</Button></div>}
      <DataTable ariaLabel={uiText('印章')} rows={[...seals].sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1))} rowKey={s => s.id} columns={columns}
        empty={<EmptyState title={uiText(canManage ? '还没有登记印章' : '公司还没有登记印章')} />} />
    </FormSection>
    <FormSection title={uiText('用印记录')}>
      <DataTable ariaLabel={uiText('用印记录')} rows={[...uses].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200)} rowKey={u => u.id} columns={useColumns} empty={<EmptyState compact title={uiText('暂无用印记录')} />} />
    </FormSection>
    <Dialog open={!!draft} onClose={() => { if (!busy) setDraft(null); }} title={uiText(draft?.id ? '编辑印章' : '登记印章')} icon={Stamp} width={620}
      footer={<><Button disabled={busy} onClick={() => setDraft(null)}>{uiText('取消')}</Button><Button variant="primary" loading={saving} disabled={busy} onClick={() => void save()}>{uiText('保存')}</Button></>}>
      {draft && <div className="mist-col">
        {failure && <Banner tone="bad" title={uiText('未能保存')}>{uiText(failure)}</Banner>}
        <FormGrid>
          <Field label={uiText('印章名称')} required><TextInput aria-label={uiText('印章名称')} value={draft.name} maxLength={60} disabled={busy} onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field>
          <Field label={uiText('类型')} required><Select aria-label={uiText('印章类型')} value={draft.kind} disabled={busy} options={(Object.keys(SEAL_KIND_LABEL) as SealKind[]).map(k => ({ value: k, label: uiText(SEAL_KIND_LABEL[k]) }))} onChange={e => setDraft({ ...draft, kind: e.target.value as SealKind })} /></Field>
          <Field label={uiText('印章图片')} required full hint={uiText('透明底 PNG')}>{draft.fileId
            ? <div className="mist-row" style={{ gap: 12 }}><SealImage fileId={draft.fileId} state={state} /><Button size="sm" variant="quiet" disabled={busy} onClick={() => setDraft({ ...draft, fileId: '' })}>{uiText('更换')}</Button></div>
            : <UploadZone title={uiText(uploading ? '上传中…' : '上传印章图片')} accept={ACCEPT} multiple={false} onFiles={files => void upload(files)} />}</Field>
          <Field label={uiText('用印人')} required full>
            <div className="mist-col" style={{ gap: 6 }}>{members.map(m => <Checkbox key={m.id} label={m.name} checked={draft.userIds.includes(m.id)} disabled={busy}
              onChange={on => setDraft({ ...draft, userIds: on ? [...draft.userIds, m.id] : draft.userIds.filter(id => id !== m.id) })} />)}</div>
          </Field>
        </FormGrid>
      </div>}
    </Dialog>
    <Dialog open={!!disable} onClose={() => { if (!busy) setDisable(null); }} title={uiText('停用印章')} tone="bad" width={520}
      footer={<><Button disabled={busy} onClick={() => setDisable(null)}>{uiText('取消')}</Button><Button variant="danger" loading={saving} disabled={busy} onClick={() => void confirmDisable()}>{uiText('停用')}</Button></>}>
      {disable && <div className="mist-col">
        {failure && <Banner tone="bad" title={uiText('未能停用')}>{uiText(failure)}</Banner>}
        <Field label={uiText('停用原因')} required><TextArea aria-label={uiText('停用原因')} rows={3} maxLength={200} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></Field>
      </div>}
    </Dialog>
  </>;
}
