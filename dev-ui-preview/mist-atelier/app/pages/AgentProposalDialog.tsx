import React from 'react';
import { uiText } from '../../../../services/interfaceLanguage';
import { businessDate } from '../runtime/businessClock';
import { Banner, Button, Dialog, Field, KeyValue, TextArea } from '../../../../components/mist';
import type { AgentProposal } from '../../../../server/src/shared/mistAgentProposals';
import type { MistCommand, MistState } from '../../../../server/src/shared/mistWorkspace';
import { reviewEmailAnalysis } from '../../../../server/src/shared/mistEmailReview';
import { emailLinkTarget } from '../../../../server/src/shared/mistEmail';

export function mailProposalDetails(proposal: AgentProposal, state?: MistState | null) {
  const { type, payload: p } = proposal.command;
  if (!type.startsWith('email.extraction.')) return null;
  const m = state?.email.messages.find(m => m.id === p.id);
  const missing = { reason: '邮件或整理版本已变化，请重新核对', subject: '', fields: [] as Array<{ label: string; value: string; quote?: string }>, note: '' };
  if (!m) return missing;
  if (type === 'email.extraction.review') {
    if (!m.analysis) return missing;
    try {
      const reviewed = reviewEmailAnalysis(m.analysis, p as any);
      return { subject: m.subject, reason: '', fields: [{ label: '分类', value: reviewed.category }, ...reviewed.fields.map(f => ({ label: f.field, value: f.value, quote: f.quote }))], note: reviewed.note };
    } catch { return missing; }
  }
  const submission = m.submissions.find(s => s.taskId === p.taskId);
  if (!submission || submission.resolution) return missing;
  return { subject: m.subject, reason: '', fields: [{ label: '业务对象', value: emailLinkTarget(state!, submission.link)?.label || '对象已不可用' }, { label: '处理结果', value: p.outcome === 'handled' ? '已处理' : '不适用' }], note: String(p.note || '') };
}

/**
 * 本人确认 Agent 提议：确认后由服务端按本人身份执行提议里的原命令（完整权限与业务校验），失败时提议保持待确认。
 * 拒绝只记录结论，不改业务。
 */
export function AgentProposalDialog({ proposal, state, onClose, run, onDone }: {
  proposal: AgentProposal | undefined; state?: MistState | null; onClose: () => void; run: (command: MistCommand) => Promise<unknown>; onDone: (message: string) => void;
}) {
  const [note, setNote] = React.useState(''), [busy, setBusy] = React.useState(false), [failure, setFailure] = React.useState('');
  React.useEffect(() => { setNote(''); setFailure(''); }, [proposal?.id]);
  if (!proposal) return null;
  const mail = mailProposalDetails(proposal, state);
  const decide = async (command: MistCommand, message: string) => {
    if (busy) return; setBusy(true); setFailure('');
    try { await run(command); onDone(message); onClose(); }
    catch (error) { setFailure(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <Dialog open onClose={() => { if (!busy) onClose(); }} width={560} title={uiText('确认 Agent 提议')}
    footer={<><Button disabled={busy} onClick={onClose}>{uiText('稍后')}</Button>
      <Button disabled={busy} onClick={() => void decide({ type: 'agent.proposal.reject', payload: { id: proposal.id, ...(note.trim() ? { note: note.trim() } : {}) } }, '已拒绝提议')}>{uiText('拒绝')}</Button>
      <Button variant="primary" loading={busy} disabled={busy || !!mail?.reason || !!proposal.taskBlocked || proposal.unavailable} onClick={() => void decide({ type: 'agent.proposal.confirm', payload: { id: proposal.id } }, '已确认并执行')}>{uiText('确认执行')}</Button></>}>
    <div className="mist-col">
      {failure && <Banner tone="bad" title={uiText('没有执行')}>{failure}</Banner>}
      {proposal.taskBlocked && <Banner tone="warn" title={uiText(proposal.taskBlocked)} />}
      <div className="mist-col" data-agent-proposal-summary>{proposal.summary.map((line, i) => <span key={i}>{line}</span>)}</div>
      <KeyValue items={[{ label: uiText('提出'), value: `${proposal.agentIdentity?.name || 'Agent'} · ${businessDate(proposal.createdAt)}` }, { label: uiText('执行身份'), value: proposal.owner }]} />
      {mail && <div className="mist-col">
        {mail.reason ? <Banner tone="warn" title={uiText(mail.reason)} /> : <>
          <span className="mist-cell-strong">{mail.subject}</span>
          {mail.fields.map((f, i) => <div className="mist-col" key={i}><span>{uiText(f.label)} · {uiText(f.value)}</span>{f.quote && <span className="mist-sub">{uiText('原文依据')} · {f.quote}</span>}</div>)}
          {mail.note && <span className="mist-sub">{mail.note}</span>}
        </>}
      </div>}
      <Field label={uiText('拒绝原因')}><TextArea aria-label={uiText('拒绝原因')} rows={2} value={note} onChange={event => setNote(event.target.value)} /></Field>
    </div>
  </Dialog>;
}
