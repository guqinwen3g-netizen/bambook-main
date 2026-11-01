import { uiText, ui } from '../../../../services/interfaceLanguage';
/** 设置 · 公司：成员离职 / 调岗时按账号整体交接名下业务（所有者办理）。 */
import React from 'react';
import { Banner, Button, Field, FormSection, Select, TextArea } from '../../../../components/mist';
import { accountOwnedObjects } from '../../../../server/src/shared/mistAccounts';
import { MIST_OWNED_KIND_LABEL, accountHandoverBlockers, accountHandovers, accountOwners } from '../../../../server/src/shared/mistHandover';
import { internalDeliveryTotals } from '../../../../server/src/shared/mistInternalDelivery';
import type { MistState } from '../../../../server/src/shared/mistWorkspace';
import type { MistMemberOption } from '../runtime/members';
import { useMistWorkspace } from '../runtime/workspace';

const when = (at: string) => new Date(at).toLocaleString();
export function MemberHandover({ state, directory, busy: outerBusy }: { state: MistState; directory: MistMemberOption[]; busy: boolean }) {
  const workspace = useMistWorkspace();
  const [fromId, setFromId] = React.useState(''), [toId, setToId] = React.useState(''), [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [done, setDone] = React.useState('');
  const owners = accountOwners(state), taskOwners = new Set(state.tasks.filter(t => !t.done).flatMap(t => t.assigneeIds));
  const fromOptions = [...owners.filter(o => o.count > 0), ...directory.filter(m => taskOwners.has(m.id) && !owners.some(o => o.id === m.id && o.count > 0)).map(m => ({ id: m.id, name: m.name, count: 0 }))];
  const member = (id: string) => directory.find(m => m.id === id);
  const owned = fromId ? accountOwnedObjects(state, fromId) : [];
  const tasks = fromId ? state.tasks.filter(t => !t.done && t.assigneeIds.includes(fromId)).length : 0;
  const deliveries = fromId ? (state.internalDeliveries || []).filter(row => row.receiverId === fromId && !row.cancelled && internalDeliveryTotals(row).pending > 0).length : 0;
  const to = member(toId);
  const blockers = fromId ? accountHandoverBlockers(state, fromId, to ? { id: to.id, name: to.name, groups: to.groups } : undefined) : [];
  const counts = owned.reduce<Record<string, number>>((m, o) => { m[o.kind] = (m[o.kind] || 0) + 1; return m; }, {});
  const blocked = !fromId ? '请选择原负责人' : !toId ? '请选择新负责人' : toId === fromId ? '新负责人不能与原负责人相同' : !owned.length && !tasks ? '该账号名下没有负责对象或未完成待办' : blockers.length ? '先处理下列阻断项' : !reason.trim() ? '请填写交接原因' : outerBusy || busy || workspace.pending ? '正在处理，请稍候' : '';
  const submit = async () => {
    if (blocked) return; setBusy(true); setError(''); setDone('');
    try { await workspace.run({ type: 'handover.account', payload: { fromUserId: fromId, toUserId: toId, reason: reason.trim() } }); setDone(`已交给 ${to?.name || toId}，并生成接手待办`); setFromId(''); setReason(''); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '交接未完成'); }
    finally { setBusy(false); }
  };
  const records = [...accountHandovers(state)].reverse().slice(0, 10);
  return <FormSection title={uiText("成员交接")} description={uiText("成员离职或调岗时，把其名下的客户、订单、开发案、面料寻样、商机、供应商经手与未完成待办一次交给新负责人。只交接负责关系，不改单据内容；审批中的订单须审批后再交接。")}>
    {error && <Banner tone="bad" title={uiText("交接未完成")}>{uiText(error)}</Banner>}
    {done && <Banner tone="ok" title={uiText("交接完成")}>{done}</Banner>}
    <div className="mist-row" data-member-handover>
      <Field label={uiText("原负责人")} hint={uiText("含已撤销授权的前成员")}><Select aria-label={uiText("交接原负责人")} value={fromId} disabled={busy} placeholder={uiText(fromOptions.length ? '选择账号' : '没有需要交接的账号')} options={fromOptions.map(o => ({ value: o.id, label: `${o.name}（${o.count} 项${member(o.id) ? '' : '，已不在本公司'}）` }))} onChange={e => { setFromId(e.target.value); setDone(''); }} /></Field>
      <Field label={uiText("新负责人")} hint={uiText("须为在用成员")}><Select aria-label={uiText("交接新负责人")} value={toId} disabled={busy} placeholder={uiText("选择成员")} options={directory.filter(m => m.id !== fromId).map(m => ({ value: m.id, label: m.name }))} onChange={e => setToId(e.target.value)} /></Field>
    </div>
    {fromId && <div className="mist-col" data-handover-preview>
      <span className="mist-note">{uiText("将交接：")}{Object.entries(counts).map(([k, n]) => `${MIST_OWNED_KIND_LABEL[k as keyof typeof MIST_OWNED_KIND_LABEL]} ${n}`).join('、') || '无负责对象'}{uiText("；未完成待办 ")}{tasks}{uiText(" 条")}{deliveries > 0 && ui`；待接收内部交付 ${deliveries} 笔`}</span>
      {owned.slice(0, 12).map(o => <small key={o.kind + o.id + o.role}>{o.role} · {uiText(o.label)}</small>)}
      {owned.length > 12 && <small>{uiText("…另有 ")}{uiText(owned.length - 12)}{uiText(" 项")}</small>}
      {blockers.length > 0 && <Banner tone="warn" title={uiText("须先处理")}>{blockers.join("；")}</Banner>}
    </div>}
    <Field label={uiText("交接原因")} full><TextArea aria-label={uiText("成员交接原因")} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></Field>
    <div className="mist-row"><span className="mist-note" data-handover-reason>{blocked || '交接后新负责人收到“接手业务”待办'}</span><span className="mist-spacer" /><Button variant="primary" loading={busy} disabled={!!blocked} title={uiText(blocked || undefined)} onClick={() => void submit()}>{uiText("整体交接")}</Button></div>
    {records.length > 0 && <div className="mist-col"><b>{uiText("交接记录")}</b>{records.map(r => <small key={r.id}>{when(r.at)} · {r.actor}：{r.from} → {r.to}，{r.objects.length}{uiText(" 项、待办 ")}{r.tasks}{uiText(" 条 · ")}{r.reason}</small>)}</div>}
  </FormSection>;
}
