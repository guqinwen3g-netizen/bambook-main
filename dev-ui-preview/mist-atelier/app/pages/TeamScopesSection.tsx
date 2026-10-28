/**
 * 公司管理 · 小组范围（规格 §3.2，P5）。为人事小组设置协作范围：若干条条件（客户 × 业务线 × 季节 × 供应商/工厂）取并集，
 * 加手选业务与排除；编辑时即时预览匹配结果，保存写调整记录。小组本身（名称、成员）在人事中维护。
 */
import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Banner, Button, Field, FormGrid, FormSection, Pill, Select, SettingRow, Skeleton, TextInput } from '../../../../components/mist';
import { uiText } from '../../../../services/interfaceLanguage';
import type { MistTeamScope, TeamScopeNodeKind, TeamScopePreview, TeamScopeRef } from '../../../../server/src/shared/mistTeamScope';
import { mistApiRequest, useMistWorkspace } from '../runtime/workspace';

type Row = { id: string; name: string; scope: MistTeamScope | null; counts: Record<TeamScopeNodeKind, number> | null };
type Condition = { customerId: string; line: string; season: string; supplierId: string };
const KIND_LABEL: Record<TeamScopeNodeKind, string> = { order: '订单', quotation: '报价', development: '开发', opportunity: '商机' };
const KINDS: TeamScopeNodeKind[] = ['order', 'quotation', 'development', 'opportunity'];
export const countText = (counts: Record<TeamScopeNodeKind, number> | null | undefined) => counts ? KINDS.map(kind => `${KIND_LABEL[kind]} ${counts[kind] ?? 0}`).join('、') : '未设置范围';
const blank = (): Condition => ({ customerId: '', line: '', season: '', supplierId: '' });
const compact = (c: Condition) => Object.fromEntries(Object.entries(c).filter(([, value]) => value.trim())) as Partial<Condition>;

export function TeamScopesSection({ canEdit, initialTeamId, onReturnToTeam }: { canEdit: boolean; initialTeamId?: string; onReturnToTeam?: (teamId: string) => void }) {
  const workspace = useMistWorkspace(), state = workspace.state, id = workspace.workspace?.id;
  const [rows, setRows] = React.useState<Row[] | null>(null), [error, setError] = React.useState(''), [teamId, setTeamId] = React.useState('');
  const [conditions, setConditions] = React.useState<Condition[]>([]), [picks, setPicks] = React.useState<TeamScopeRef[]>([]), [exclusions, setExclusions] = React.useState<TeamScopeRef[]>([]), [note, setNote] = React.useState('');
  const [preview, setPreview] = React.useState<TeamScopePreview | null>(null), [previewError, setPreviewError] = React.useState(''), [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => {
    if (!id) return; setError('');
    try { const data = await mistApiRequest(`/api/mist/workspaces/${encodeURIComponent(id)}/team-scopes`); setRows(Array.isArray(data?.teams) ? data.teams : []); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '小组范围读取失败'); setRows([]); }
  }, [id]);
  React.useEffect(() => { void load(); }, [load, workspace.workspace?.revision]);
  const team = rows?.find(row => row.id === teamId);
  const edit = (row: Row) => {
    setTeamId(row.id); setNote(''); setPreview(null); setPreviewError('');
    setConditions((row.scope?.conditions ?? []).map(c => ({ customerId: c.customerId ?? '', line: c.line ?? '', season: c.season ?? '', supplierId: c.supplierId ?? '' })));
    setPicks(row.scope?.picks ?? []); setExclusions(row.scope?.exclusions ?? []);
  };
  const linkedTeam = React.useRef('');
  React.useEffect(() => {
    const key = initialTeamId && id ? `${id}:${initialTeamId}` : '';
    if (!key) { linkedTeam.current = ''; return; }
    if (linkedTeam.current === key || !rows) return;
    const row = rows.find(item => item.id === initialTeamId);
    if (row) { linkedTeam.current = key; edit(row); }
  }, [initialTeamId, id, rows]);
  const input = React.useMemo(() => ({ teamId, conditions: conditions.map(compact), picks, exclusions }), [teamId, conditions, picks, exclusions]);
  // 即时预览：停顿 300ms 后在服务端最新完整数据上匹配（不写库）。
  React.useEffect(() => {
    if (!id || !teamId) return; let live = true; setPreview(null); setPreviewError('');
    const timer = setTimeout(() => { void mistApiRequest(`/api/mist/workspaces/${encodeURIComponent(id)}/team-scopes/preview`, { method: 'POST', body: JSON.stringify(input) })
      .then(data => { if (live) { setPreview(data.preview); setPreviewError(''); } }).catch(failure => { if (live) { setPreview(null); setPreviewError(failure instanceof Error ? failure.message : '预览失败'); } }); }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [id, input, workspace.workspace?.revision]);
  if (!state) return null;
  const customers = [{ value: '', label: '不限客户' }, ...state.customers.map(c => ({ value: c.id, label: `${c.code ? c.code + ' · ' : ''}${c.name}` }))];
  const suppliers = [{ value: '', label: '不限供应商/工厂' }, ...(state.market?.suppliers ?? []).map(s => ({ value: s.id, label: `${s.code} · ${s.name}` }))];
  const records: Array<TeamScopeRef & { label: string }> = [
    ...state.orders.map(o => ({ kind: 'order' as const, id: o.id, label: `订单 ${o.code} · ${o.customer}` })),
    ...(state.market?.quotations ?? []).map(q => ({ kind: 'quotation' as const, id: q.id, label: `报价 ${q.code || q.id}` })),
    ...(state.devs ?? []).map(d => ({ kind: 'development' as const, id: d.id, label: `开发 ${d.code} · ${d.name}` })),
    ...(state.crm?.opportunities ?? []).map(o => ({ kind: 'opportunity' as const, id: o.id, label: `商机 ${o.title}` })),
  ];
  const refKey = (r: TeamScopeRef) => `${r.kind}:${r.id}`, labelOf = (r: TeamScopeRef) => records.find(x => refKey(x) === refKey(r))?.label ?? `${KIND_LABEL[r.kind]} ${r.id}`;
  const refPicker = (label: string, list: TeamScopeRef[], set: (next: TeamScopeRef[]) => void) => <Field label={uiText(label)}>
    <div className="mist-col" style={{ gap: 6 }}>
      {list.map(r => <span key={refKey(r)} className="mist-row"><span>{uiText(labelOf(r))}</span>{canEdit && <Button size="sm" variant="quiet" icon={Trash2} aria-label={uiText(`移出 ${labelOf(r)}`)} onClick={() => set(list.filter(x => refKey(x) !== refKey(r)))} />}</span>)}
      {canEdit && <Select aria-label={uiText(`添加${label}`)} value="" placeholder={uiText(`添加${label}`)} options={records.filter(r => !list.some(x => refKey(x) === refKey(r))).map(r => ({ value: refKey(r), label: r.label }))}
        onChange={event => { const r = records.find(x => refKey(x) === event.target.value); if (r) set([...list, { kind: r.kind, id: r.id }]); }} />}
    </div>
  </Field>;
  const save = async () => {
    if (!canEdit || busy) return; setBusy(true); setPreviewError('');
    try { await workspace.run({ type: 'teamScope.save', payload: { ...input, ...(note.trim() ? { note: note.trim() } : {}) } } as any); setNote(''); await load(); }
    catch (failure) { setPreviewError(failure instanceof Error ? failure.message : '小组范围未保存'); }
    finally { setBusy(false); }
  };
  return <>
    {onReturnToTeam && team && <Button variant="quiet" size="sm" onClick={() => onReturnToTeam(team.id)}>{uiText('返回小组')}</Button>}
    <FormSection title={uiText('小组范围')}>
      {rows === null && <Skeleton height={64} />}
      {error && <Banner tone="bad" title={uiText(error)} actions={<Button size="sm" onClick={() => void load()}>{uiText('重新读取')}</Button>} />}
      {rows && !rows.length && !error && <p className="mist-note">{uiText('本公司还没有在用的小组。')}</p>}
      {rows?.map(row => <SettingRow key={row.id} title={uiText(row.name)} description={uiText(countText(row.counts))}
        control={<Button size="sm" aria-pressed={row.id === teamId} variant={row.id === teamId ? 'secondary' : 'quiet'} onClick={() => edit(row)}>{uiText(canEdit ? '调整范围' : '查看范围')}</Button>} />)}
    </FormSection>
    {team && <FormSection title={uiText(`${team.name} · 范围条件`)}>
      <div className="mist-col" style={{gap:20}}>
      {conditions.map((c, index) => <FormGrid key={index} cols={3}>
        <Field label={uiText('客户')}><Select aria-label={uiText(`条件 ${index + 1} 客户`)} value={c.customerId} disabled={!canEdit} options={customers} onChange={event => setConditions(list => list.map((x, i) => i === index ? { ...x, customerId: event.target.value } : x))} /></Field>
        <Field label={uiText('业务线')}><Select aria-label={uiText(`条件 ${index + 1} 业务线`)} value={c.line} disabled={!canEdit} options={[{ value: '', label: '不限' }, { value: 'fabric', label: '面料' }, { value: 'garment', label: '成衣' }]} onChange={event => setConditions(list => list.map((x, i) => i === index ? { ...x, line: event.target.value } : x))} /></Field>
        <Field label={uiText('季节')}><TextInput aria-label={uiText(`条件 ${index + 1} 季节`)} value={c.season} placeholder="SS27" disabled={!canEdit} onChange={event => setConditions(list => list.map((x, i) => i === index ? { ...x, season: event.target.value } : x))} /></Field>
        <Field label={uiText('供应商 / 工厂')}><Select aria-label={uiText(`条件 ${index + 1} 供应商`)} value={c.supplierId} disabled={!canEdit} options={suppliers} onChange={event => setConditions(list => list.map((x, i) => i === index ? { ...x, supplierId: event.target.value } : x))} /></Field>
        {canEdit && <Field label={uiText('操作')}><Button size="sm" variant="quiet" icon={Trash2} onClick={() => setConditions(list => list.filter((_, i) => i !== index))}>{uiText('删除条件')}</Button></Field>}
      </FormGrid>)}
      {canEdit && <Button size="sm" style={{alignSelf:"flex-start"}} icon={Plus} onClick={() => setConditions(list => [...list, blank()])}>{uiText('添加条件')}</Button>}
      {refPicker('手选业务', picks, setPicks)}
      {refPicker('排除', exclusions, setExclusions)}
      <div className="mist-col" aria-live="polite" style={{ gap: 6 }}>
        <b>{uiText('当前匹配')}</b>
        {preview ? <><span>{uiText(countText(preview.counts))}</span>
          {KINDS.some(kind => preview.readonlyCounts[kind]) && <small className="mist-muted">{uiText(`只读带出：${countText(preview.readonlyCounts)}`)}</small>}
          {preview.warnings.map(text => <Banner key={text} tone="warn" title={uiText(text)} />)}
          <span className="mist-row" style={{ flexWrap: 'wrap', gap: 6 }}>{preview.items.slice(0, 30).map(item => <Pill key={item.kind + item.id} tone={item.access === 'readonly' ? 'neutral' : 'accent'}>{uiText(`${KIND_LABEL[item.kind]} ${item.code || item.name}`)}</Pill>)}{preview.items.length > 30 && <small className="mist-muted">{uiText(`等 ${preview.items.length} 项`)}</small>}</span>
        </> : <small className="mist-muted">{uiText(previewError || '正在匹配')}</small>}
      </div>
      {canEdit && <div className="mist-row" style={{alignItems:'end'}}>
        <Field label={uiText('调整说明')}><TextInput aria-label={uiText('调整说明')} value={note} onChange={event => setNote(event.target.value)} /></Field>
        <Button variant="primary" loading={busy} disabled={busy || !!workspace.pending} onClick={() => void save()}>{uiText('保存范围')}</Button>
      </div>}
      {!!team.scope?.history.length && <div className="mist-col"><b>{uiText('调整记录')}</b>{team.scope.history.slice(0, 20).map(h => <small key={h.at + h.summary}>{new Date(h.at).toLocaleString()} · {h.actorName} · {uiText(h.summary)}{h.note ? ' · ' + h.note : ''}</small>)}</div>}
      </div>
    </FormSection>}
  </>;
}
