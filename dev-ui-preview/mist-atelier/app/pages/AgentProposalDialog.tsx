import React from 'react';
import { uiText } from '../../../../services/interfaceLanguage';
import { businessDate } from '../runtime/businessClock';
import { Banner, Button, Dialog, Field, KeyValue, TextArea } from '../../../../components/mist';
import type { AgentProposal } from '../../../../server/src/shared/mistAgentProposals';
import type { MistCommand } from '../../../../server/src/shared/mistWorkspace';

/**
 * 本人确认 Agent 提议：确认后由服务端按本人身份执行提议里的原命令（完整权限与业务校验），失败时提议保持待确认。
 * 拒绝只记录结论，不改业务。
 */
export function AgentProposalDialog({ proposal, onClose, run, onDone }: {
  proposal: AgentProposal | undefined; onClose: () => void; run: (command: MistCommand) => Promise<unknown>; onDone: (message: string) => void;
}) {
  const [note, setNote] = React.useState(''), [busy, setBusy] = React.useState(false), [failure, setFailure] = React.useState('');
  React.useEffect(() => { setNote(''); setFailure(''); }, [proposal?.id]);
  if (!proposal) return null;
  const decide = async (command: MistCommand, message: string) => {
    if (busy) return; setBusy(true); setFailure('');
    try { await run(command); onDone(message); onClose(); }
    catch (error) { setFailure(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <Dialog open onClose={() => { if (!busy) onClose(); }} width={560} title={uiText('确认 Agent 提议')}
    footer={<><Button disabled={busy} onClick={onClose}>{uiText('稍后')}</Button>
      <Button disabled={busy} onClick={() => void decide({ type: 'agent.proposal.reject', payload: { id: proposal.id, ...(note.trim() ? { note: note.trim() } : {}) } }, '已拒绝提议')}>{uiText('拒绝')}</Button>
      <Button variant="primary" loading={busy} disabled={busy} onClick={() => void decide({ type: 'agent.proposal.confirm', payload: { id: proposal.id } }, '已确认并执行')}>{uiText('确认执行')}</Button></>}>
    <div className="mist-col">
      {failure && <Banner tone="bad" title={uiText('没有执行')}>{failure}</Banner>}
      <div className="mist-col" data-agent-proposal-summary>{proposal.summary.map((line, i) => <span key={i}>{line}</span>)}</div>
      <KeyValue items={[{ label: uiText('提出'), value: `Agent · ${businessDate(proposal.createdAt)}` }, { label: uiText('执行身份'), value: proposal.owner }]} />
      <Field label={uiText('拒绝原因')}><TextArea aria-label={uiText('拒绝原因')} rows={2} value={note} onChange={event => setNote(event.target.value)} /></Field>
    </div>
  </Dialog>;
}
