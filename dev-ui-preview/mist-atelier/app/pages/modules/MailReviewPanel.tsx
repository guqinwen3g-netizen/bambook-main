import React from 'react';
import { Sparkles } from 'lucide-react';
import { Banner, Button, Checkbox, Dialog, Drawer, Field, FormGrid, Pill, Select, TextArea, TextInput, TextLink } from '../../../../../components/mist';
import { EMAIL_CATEGORIES, type EmailAnalysis } from '../../../../../server/src/shared/mistEmailReview';
import { EMAIL_LINK_LABEL, emailLinkTarget, type EmailMessage, type EmailLink } from '../../../../../server/src/shared/mistEmail';
import type { MistCommand, MistState } from '../../../../../server/src/shared/mistWorkspace';
import { useMistWorkspace } from '../../runtime/workspace';
import { useMistSession } from '../../runtime/auth';
import { uiText } from '../../../../../services/interfaceLanguage';
import { DetailBlock, shortWhen } from './pageKit';

type Exec = (command: MistCommand, done?: string) => Promise<unknown>;
const keyOf = (l: EmailLink) => l.kind + ':' + l.id;
export function MailReviewPanel({ message: m, state, can, locked, exec, onOpen }: { message: EmailMessage; state: MistState; can: boolean; locked: boolean; exec: Exec; onOpen: (view: string, id: string) => void }) {
  const { mail } = useMistWorkspace(), session = useMistSession();
  const [consent, setConsent] = React.useState(false), [editing, setEditing] = React.useState(false), [busy, setBusy] = React.useState(false), [failure, setFailure] = React.useState('');
  const [editingAnalysis, setEditingAnalysis] = React.useState<EmailAnalysis | null>(null);
  const [category, setCategory] = React.useState('其他'), [values, setValues] = React.useState<Record<string, string>>({}), [picked, setPicked] = React.useState<string[]>([]), [note, setNote] = React.useState(''), [target, setTarget] = React.useState('');
  const [handling, setHandling] = React.useState<string | null>(null), [outcome, setOutcome] = React.useState<'handled' | 'not_applicable'>('handled'), [handlingNote, setHandlingNote] = React.useState('');
  const generation = React.useRef(0);
  React.useEffect(() => { generation.current++; setConsent(false); setEditing(false); setFailure(''); setBusy(false); setTarget(''); setHandling(null); return () => { generation.current++; }; }, [m.id, session.user?.id]);
  const analysis = m.analysis, review = m.extractionReview, reviewed = !!review && review.analysisId === analysis?.id;
  const disabled = locked || busy || !can || m.folder === 'trash';
  const analyze = async () => {
    const epoch = generation.current; setConsent(false); setBusy(true); setFailure('');
    try { if (!mail) throw new Error('邮件服务不可用'); await mail({ kind: 'analyze', messageId: m.id, consent: true }); }
    catch (e) { if (epoch === generation.current) setFailure(e instanceof Error ? e.message : '整理失败，请重试'); }
    finally { if (epoch === generation.current) setBusy(false); }
  };
  const openReview = () => { if (!analysis) return; setEditingAnalysis(analysis); const fields = reviewed ? review!.fields : analysis.fields; setCategory(reviewed ? review!.category : analysis.category); setValues(Object.fromEntries(analysis.fields.map(f => [f.id, fields.find(v => v.id === f.id)?.value ?? f.value]))); setPicked(fields.map(f => f.id)); setNote(reviewed ? review!.note : ''); setEditing(true); };
  const save = async () => {
    if (!editingAnalysis) return;
    const result = await exec({ type: 'email.extraction.review', payload: { id: m.id, analysisId: editingAnalysis.id, category, fields: picked.map(id => ({ id, value: values[id] })), note } }, '已保存复核结果');
    if (result) setEditing(false);
  };
  const options = m.links.filter(l => emailLinkTarget(state, l) && !m.submissions.some(s => keyOf(s.link) === keyOf(l) && (!review || s.review?.id === review.id)));
  const submit = async () => { const link = options.find(l => keyOf(l) === target); if (link && await exec({ type: 'email.submitExtraction', payload: { id: m.id, link } }, '已交业务负责人处理')) setTarget(''); };
  const resolve = async () => { if (handling && await exec({ type: 'email.extraction.resolve', payload: { id: m.id, taskId: handling, outcome, note: handlingNote } }, '已记录处理结果')) setHandling(null); };
  return <DetailBlock title={uiText('分类与抽取')} aside={<Pill tone={reviewed ? 'ok' : analysis ? 'ai' : 'neutral'}>{uiText(reviewed ? '已复核' : analysis ? '待复核' : '未整理')}</Pill>}>
    {failure && <Banner tone="bad" title={failure} />}
    {analysis ? <>
      <p className="mist-sub">{analysis.summary}</p>
      {(analysis.attachmentCount > 0 || analysis.truncated) && <Banner tone="warn" title={uiText(analysis.truncated ? '仅整理了部分正文' : '附件未参与整理')}>{uiText(analysis.truncated ? '请核对完整原文及附件。' : `请另行核对 ${analysis.attachmentCount} 份附件。`)}</Banner>}
      {reviewed ? <>
        <div className="mist-row"><Pill>{uiText(review!.category)}</Pill></div>
        {review!.fields.map(f => <div className="mist-col" key={f.id}><strong className="mist-cell-strong">{f.field} · {f.value}</strong><span className="mist-sub">{f.quote}</span>{f.corrected && <Pill>{uiText('人工修订')}</Pill>}</div>)}
        {review!.note && <span className="mist-sub">{review!.note}</span>}<span className="mist-note">{review!.actor} · {shortWhen(review!.at)}</span>
      </> : <>{analysis.fields.map(f => <div className="mist-col" key={f.id}><span>{f.field} · {f.value}</span><span className="mist-sub">{f.quote}</span></div>)}{!analysis.fields.length && <span className="mist-sub">{uiText('未找到可提取的明确字段')}</span>}</>}
      {analysis.warnings.map((warning, i) => <Banner key={i} tone="warn" title={warning} />)}
    </> : m.example ? <>{m.extracted.map((f, i) => <span className="mist-sub" key={i}>{f.field} · {f.value}</span>)}<span className="mist-note">{uiText('示例整理结果')}</span></> : <span className="mist-sub">{uiText('尚未整理此邮件')}</span>}
    {can && <div className="mist-row" style={{ flexWrap: 'wrap' }}>
      {session.hasPermission('ai:chat') && <Button variant="ai" icon={Sparkles} disabled={disabled} onClick={() => setConsent(true)}>{uiText(busy ? '正在整理…' : analysis ? '重新整理' : 'AI 整理')}</Button>}
      {analysis && <Button disabled={disabled} onClick={openReview}>{uiText(reviewed ? '修改复核' : '复核资料')}</Button>}
    </div>}
    {(reviewed || m.example) && m.extracted.length > 0 && can && <div className="mist-row mist-mail-picker">
      <Select aria-label={uiText('提交到业务对象')} value={target} onChange={e => setTarget(e.target.value)} placeholder={uiText(options.length ? '选择已关联对象' : m.links.length ? '已全部提交' : '请先关联业务对象')} options={options.map(l => ({ value: keyOf(l), label: `${EMAIL_LINK_LABEL[l.kind]} · ${emailLinkTarget(state, l)!.label}` }))} />
      <Button disabled={disabled || !target} onClick={() => void submit()}>{uiText('提交到业务对象')}</Button>
    </div>}
    {m.submissions.map(s => { const business = emailLinkTarget(state, s.link), task = state.tasks.find(t => t.id === s.taskId), mine = task?.assigneeIds.includes(String(session.user?.id)); return <div className="mist-col" key={s.taskId}>
      <div className="mist-row"><Pill tone={s.resolution ? 'ok' : 'warn'}>{uiText(s.resolution ? s.resolution.outcome === 'handled' ? '已处理' : '不适用' : '待处理')}</Pill>{business && <TextLink onClick={() => onOpen(business.view, business.id)}>{business.label}</TextLink>}</div>
      <span className="mist-note">{s.actor} · {shortWhen(s.at)}</span>{s.review?.fields.map(f => <span key={f.id} className="mist-sub">{f.field} · {f.value}</span>)}{s.review?.note && <span className="mist-sub">{s.review.note}</span>}
      {s.resolution ? <span className="mist-sub">{s.resolution.note} · {s.resolution.actor}</span> : mine && can && <Button disabled={disabled} onClick={() => { setHandling(s.taskId); setOutcome('handled'); setHandlingNote(''); }}>{uiText('记录处理结果')}</Button>}
    </div>; })}
    <Dialog open={consent} title={uiText('使用平台 AI 整理？')} onClose={() => setConsent(false)} footer={<><Button onClick={() => setConsent(false)}>{uiText('取消')}</Button><Button variant="ai" disabled={disabled} onClick={() => void analyze()}>{uiText('开始整理')}</Button></>}>
      <p className="mist-sub">{uiText('将此邮件的主题和正文交给平台配置的模型。附件不参与；结果须复核后才能提交业务。')}</p>
    </Dialog>
    <Drawer open={editing} title={uiText('复核邮件资料')} onClose={() => setEditing(false)} footer={<><Button onClick={() => setEditing(false)}>{uiText('取消')}</Button><Button variant="primary" disabled={disabled || picked.some(id => !values[id]?.trim())} onClick={() => void save()}>{uiText('保存复核')}</Button></>}>
      <FormGrid><Field label={uiText('分类')} full><Select value={category} onChange={e => setCategory(e.target.value)} options={EMAIL_CATEGORIES.map(c => ({ value: c, label: uiText(c) }))} /></Field></FormGrid>
      {editingAnalysis?.fields.map(f => <div className="mist-col" key={f.id}>
        <Checkbox label={f.field} checked={picked.includes(f.id)} onChange={checked => setPicked(ids => checked ? [...ids, f.id] : ids.filter(id => id !== f.id))} />
        <TextInput aria-label={f.field} value={values[f.id] || ''} disabled={!picked.includes(f.id)} onChange={e => setValues(v => ({ ...v, [f.id]: e.target.value }))} />
        <span className="mist-sub">{uiText('原文依据')} · {f.quote}</span>
      </div>)}
      <Field label={uiText('复核备注')}><TextArea value={note} onChange={e => setNote(e.target.value)} maxLength={1000} /></Field>
    </Drawer>
    <Dialog open={!!handling} title={uiText('记录处理结果')} onClose={() => setHandling(null)} footer={<><Button onClick={() => setHandling(null)}>{uiText('取消')}</Button><Button disabled={disabled || !handlingNote.trim()} onClick={() => void resolve()}>{uiText('保存结果')}</Button></>}>
      <FormGrid><Field label={uiText('处理结果')} full><Select value={outcome} onChange={e => setOutcome(e.target.value as typeof outcome)} options={[{ value: 'handled', label: uiText('已处理') }, { value: 'not_applicable', label: uiText('不适用') }]} /></Field><Field label={uiText('处理说明')} required full><TextArea value={handlingNote} onChange={e => setHandlingNote(e.target.value)} maxLength={1000} /></Field></FormGrid>
    </Dialog>
  </DetailBlock>;
}
