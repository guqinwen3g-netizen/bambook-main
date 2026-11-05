import React from 'react';
import { ui, uiText } from '../../../../services/interfaceLanguage';
import { businessDate } from '../runtime/businessClock';
import { Banner, Button, Dialog, Field, KeyValue, PasswordInput, Pill, SignaturePad, TextArea, type SignatureValue } from '../../../../components/mist';
import { commandRequiresSignature } from '../runtime/signatureRules';
import { agentCommandRisk, AGENT_RISK_LABEL, type AgentProposal } from '../../../../server/src/shared/mistAgentProposals';
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
 * 确认时列出将要执行的内容：按提议命令的 payload 逐项展开（嵌套对象按路径，数组逐项）。
 * 中风险超长值截断；高风险不截断——本人输入密码确认的必须是完整内容。超出显示上限时返回 omitted，调用方须禁用确认。
 */
export function proposalFieldChanges(command: AgentProposal['command'], full = false): { rows: Array<{ field: string; value: string }>; omitted: number } {
  const rows: Array<{ field: string; value: string }> = [], limit = full ? 200 : 40;
  let omitted = 0;
  const walk = (value: unknown, path: string) => {
    if (value && typeof value === 'object') {
      const entries = Array.isArray(value) ? value.map((child, i) => [String(i + 1), child] as const) : Object.entries(value);
      if (entries.length) { for (const [key, child] of entries) walk(child, path ? path + '.' + key : key); return; }
    }
    if (rows.length >= limit) { omitted++; return; }
    const text = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
    rows.push({ field: path || '内容', value: !full && text.length > 200 ? text.slice(0, 200) + '…' : text });
  };
  walk(command.payload, '');
  return { rows, omitted };
}

export type ProposalAccountRow = { label: string; after: string; before?: string; mono?: boolean };

/**
 * 收款账户类提议逐项对照原值与新值。账号必须完整显示：摘要只有“修改银行账户”或尾号，本人无法据此核对收款去向。
 * 原记录不在本人可见范围时只列新值，不猜测原值。
 */
export function proposalAccountRows(command: AgentProposal['command'], state?: MistState | null): ProposalAccountRow[] | null {
  const p = command.payload as Record<string, unknown>, s = (v: unknown) => v === undefined || v === null ? '' : String(v).trim();
  const row = (label: string, after: unknown, before?: unknown, mono = false): ProposalAccountRow => ({ label, after: s(after), ...(before === undefined ? {} : { before: s(before) }), ...(mono ? { mono } : {}) });
  if (command.type === 'finance.account.save') {
    const old = p.id ? state?.bankAccounts?.find(a => a.id === p.id) : undefined;
    return [row('账户名称', p.name, old?.name), row('开户行', p.bankName, old?.bankName), row('银行账号', s(p.accountNo).replace(/\s+/g, ''), old?.accountNo, true),
      row('币种', s(p.currency).toUpperCase(), old?.currency), row('期初日期', p.openingDate, old?.openingDate), row('期初余额', p.openingBalance, old?.openingBalance)];
  }
  const profile = (p.companyProfile && typeof p.companyProfile === 'object' ? p.companyProfile : undefined) as Record<string, unknown> | undefined;
  if (command.type === 'settings.update' && profile && ['bankName', 'bankAccount', 'swift', 'bankAddress'].some(k => profile[k] !== undefined)) {
    const old = state?.settings?.companyProfile;
    return [row('开户行', profile.bankName ?? old?.bankName, old?.bankName), row('银行账号', s(profile.bankAccount ?? old?.bankAccount).replace(/\s+/g, ''), old?.bankAccount, true),
      row('SWIFT', s(profile.swift ?? old?.swift).toUpperCase(), old?.swift, true), ...(profile.bankAddress !== undefined || old?.bankAddress ? [row('开户行地址', profile.bankAddress ?? old?.bankAddress, old?.bankAddress)] : [])];
  }
  if (command.type === 'market.supplier.bank.save') {
    const supplier = state?.market?.suppliers?.find(x => x.id === p.supplierId), currency = s(p.currency).toUpperCase();
    const old = supplier?.bankAccounts?.find(a => a.state === 'active' && a.currency === currency);
    return [row('供应商', supplier?.name || p.supplierId), row('币种', currency), row('账户名称', p.accountName, old?.accountName), row('开户行', p.bankName, old?.bankName),
      row('银行账号', s(p.accountNo).replace(/\s+/g, ''), old?.accountNo, true), ...(p.swift || old?.swift ? [row('SWIFT', s(p.swift).toUpperCase(), old?.swift, true)] : []), row('核实记录', p.verification)];
  }
  return null;
}

/**
 * 本人确认 Agent 提议：确认后由服务端按本人身份执行提议里的原命令（完整权限与业务校验），失败时提议保持待确认。
 * 中、高风险都列出将要执行的具体内容；高风险另须本人密码。拒绝只记录结论，不改业务。
 */
export function AgentProposalDialog({ proposal, state, onClose, run, onDone }: {
  proposal: AgentProposal | undefined; state?: MistState | null; onClose: () => void; run: (command: MistCommand, options?: { reauth?: { password: string }; signature?: { svg: string } }) => Promise<unknown>; onDone: (message: string) => void;
}) {
  const [note, setNote] = React.useState(''), [busy, setBusy] = React.useState(false), [failure, setFailure] = React.useState(''), [password, setPassword] = React.useState(''), [signature, setSignature] = React.useState<SignatureValue | null>(null);
  React.useEffect(() => { setNote(''); setFailure(''); setPassword(''); setSignature(null); }, [proposal?.id]);
  if (!proposal) return null;
  const mail = mailProposalDetails(proposal, state);
  // 风险等级与服务端共用 agentCommandRisk：未登记的普通写入按中风险，付款、核销、审批等按高风险须输入密码。服务端仍会独立校验档位、密码与原业务权限。
  const risk = agentCommandRisk(proposal.command.type), detailed = risk !== 'low' && !mail;
  const account = detailed ? proposalAccountRows(proposal.command, state) : null;
  const fields = detailed ? proposalFieldChanges(proposal.command, risk === 'high') : { rows: [], omitted: 0 };
  // 公司收款账户只对照银行字段；同一命令里的其他设置仍逐项列出。
  const changes = account && proposal.command.type !== 'settings.update' ? [] : account ? fields.rows.filter(r => !/^companyProfile\.(bankName|bankAccount|swift|bankAddress)$/.test(r.field)) : fields.rows;
  const incomplete = risk === 'high' && fields.omitted > 0;
  // Agent 起草的合同与资金类批准，由确认人本人当场签字；Agent 不能代签。
  const signing = commandRequiresSignature(proposal.command);
  const decide = async (command: MistCommand, message: string, reauth?: { password: string }, signed?: { svg: string }) => {
    if (busy) return; setBusy(true); setFailure('');
    try { await run(command, reauth || signed ? { ...(reauth ? { reauth } : {}), ...(signed ? { signature: signed } : {}) } : undefined); setPassword(''); setSignature(null); onDone(message); onClose(); }
    catch (error) { setPassword(''); setFailure(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <Dialog open onClose={() => { if (!busy) onClose(); }} width={560} title={uiText('确认 Agent 提议')}
    footer={<><Button disabled={busy} onClick={onClose}>{uiText('稍后')}</Button>
      <Button disabled={busy} onClick={() => void decide({ type: 'agent.proposal.reject', payload: { id: proposal.id, ...(note.trim() ? { note: note.trim() } : {}) } }, '已拒绝提议')}>{uiText('拒绝')}</Button>
      <Button variant="primary" loading={busy} disabled={busy || !!mail?.reason || !!proposal.taskBlocked || proposal.unavailable || incomplete || (risk === 'high' && !password) || (signing && !signature)} onClick={() => void decide({ type: 'agent.proposal.confirm', payload: { id: proposal.id } }, '已确认并执行', risk === 'high' ? { password } : undefined, signing && signature ? { svg: signature.svg } : undefined)}>{uiText('确认执行')}</Button></>}>
    <div className="mist-col">
      {failure && <Banner tone="bad" title={uiText('没有执行')}>{failure}</Banner>}
      {proposal.taskBlocked && <Banner tone="warn" title={uiText(proposal.taskBlocked)} />}
      <div className="mist-col" data-agent-proposal-summary>{proposal.summary.map((line, i) => <span key={i}>{line}</span>)}</div>
      <KeyValue items={[{ label: uiText('提出'), value: `${proposal.agentIdentity?.name || 'Agent'} · ${businessDate(proposal.createdAt)}` }, { label: uiText('执行身份'), value: proposal.owner }]} />
      <div className="mist-row" data-agent-proposal-risk={risk}><Pill tone={risk === 'high' ? 'bad' : risk === 'medium' ? 'warn' : 'neutral'}>{uiText(AGENT_RISK_LABEL[risk])}</Pill></div>
      {account && <div className="mist-col" data-agent-proposal-account><span className="mist-cell-strong">{uiText('收款账户')}</span>
        <KeyValue items={account.map(r => {
          const show = (v: string) => r.mono && v ? <span className="mist-mono">{v}</span> : v || '—';
          return { label: r.label, value: r.before !== undefined && r.before !== r.after
            ? <span className="mist-col" data-changed><span>{show(r.after)}</span><span className="mist-sub">{uiText('原')} · {show(r.before)}</span></span>
            : show(r.after) };
        })} />
      </div>}
      {changes.length > 0 && <div className="mist-col" data-agent-proposal-changes><span className="mist-cell-strong">{uiText('将要改动的字段')}</span>{changes.map((c, i) => <span key={i}>{c.field} · {c.value}</span>)}{fields.omitted > 0 && <span className="mist-sub">{ui`另有 ${fields.omitted} 项未显示`}</span>}</div>}
      {incomplete && <Banner tone="warn" title={uiText('内容过多，无法在此完整核对')}>{uiText('请拒绝后让 Agent 拆成较小的操作重新提交')}</Banner>}
      {mail && <div className="mist-col">
        {mail.reason ? <Banner tone="warn" title={uiText(mail.reason)} /> : <>
          <span className="mist-cell-strong">{mail.subject}</span>
          {mail.fields.map((f, i) => <div className="mist-col" key={i}><span>{uiText(f.label)} · {uiText(f.value)}</span>{f.quote && <span className="mist-sub">{uiText('原文依据')} · {f.quote}</span>}</div>)}
          {mail.note && <span className="mist-sub">{mail.note}</span>}
        </>}
      </div>}
      {risk === 'high' && <Field label={uiText('本人登录密码')} required hint={uiText('付款、核销、审批、作废等资金或不可逆操作，确认前须重新验证本人密码')}><PasswordInput aria-label={uiText('本人登录密码')} autoComplete="current-password" value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></Field>}
      {signing && <Field label={uiText('确认签字')} required><SignaturePad key={proposal.id} ariaLabel="确认签字" disabled={busy} onChange={setSignature} /></Field>}
      <Field label={uiText('拒绝原因')}><TextArea aria-label={uiText('拒绝原因')} rows={2} value={note} onChange={event => setNote(event.target.value)} /></Field>
    </div>
  </Dialog>;
}
