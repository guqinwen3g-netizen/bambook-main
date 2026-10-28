import { uiText, ui } from '../../../../services/interfaceLanguage';
/** 设置 · 公司：授权访问。只管“谁能进公司”，不授予任何业务权限。 */
import React from 'react';
import { UserPlus } from 'lucide-react';
import { Banner, Button, Checkbox, Field, FormSection, Select, SettingRow, TextInput } from '../../../../components/mist';
import { MIST_BUSINESS_GROUPS, MIST_BUSINESS_GROUP_LABEL, type MistBusinessGroup } from '../../../../server/src/shared/mistAccounts';
import { accountOwnedObjects, workspaceMembers } from '../runtime/members';
import { useMistSession } from '../runtime/auth';
import { useMistWorkspace } from '../runtime/workspace';
import { MemberHandover } from './MemberHandover';

const when = (at: string) => new Date(at).toLocaleString();
export function WorkspaceMembers({ busy: outerBusy }: { busy: boolean }) {
  const workspace = useMistWorkspace(), session = useMistSession();
  const envelope = workspace.workspace, state = workspace.state, owner = envelope?.access?.canManageMembers === true, company = envelope?.access?.companyLibrary === true, manager = envelope?.access?.canManageCompany ?? owner;
  const [account, setAccount] = React.useState(''), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const scope = `${session.sessionKey}:${envelope?.id ?? ''}`;
  const liveScope = React.useRef(scope), mounted = React.useRef(true), inFlight = React.useRef(false);
  liveScope.current = scope;
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  React.useEffect(() => { inFlight.current = false; setAccount(''); setError(''); setBusy(false); }, [scope]);
  if (!envelope || !state) return null;
  const members = state.members ?? [], log = state.memberLog ?? [];
  const candidates = (session.localProfiles ?? []).filter(p => p.id !== envelope.ownerId && !members.some(m => m.userId === p.id));
  const disabled = outerBusy || busy || !!workspace.pending || !workspace.changeMember;
  const directory = workspaceMembers(envelope, state, session.user);
  const setGroups = async (userId: string, groups: MistBusinessGroup[]) => {
    if (!manager || outerBusy || busy || workspace.pending || inFlight.current) return;
    const boundScope = scope, current = () => mounted.current && liveScope.current === boundScope;
    inFlight.current = true; setBusy(true); setError('');
    try { await workspace.run({ type: 'member.groups.set', payload: { userId, groups } }); }
    catch (failure) { if (current()) setError(failure instanceof Error ? failure.message : '管理业务线未保存'); }
    finally { if (current()) { inFlight.current = false; setBusy(false); } }
  };
  /** 管理业务线（面料 / 成衣，可多选）：主管按线看到并管理本线全部业务；只有公司管理人员可改。 */
  const groupControl = (userId: string) => {
    const groups = directory.find(m => m.id === userId)?.groups ?? [];
    return <span className="mist-row" role="group" aria-label={uiText("管理业务线")}>{MIST_BUSINESS_GROUPS.map(g => <Checkbox key={g} label={uiText(MIST_BUSINESS_GROUP_LABEL[g])} checked={groups.includes(g)} disabled={!manager || outerBusy || busy || !!workspace.pending}
      onChange={on => void setGroups(userId, MIST_BUSINESS_GROUPS.filter(x => x === g ? on : groups.includes(x)))} />)}</span>;
  };
  const ownedSummary = (userId: string) => {
    const owned = accountOwnedObjects(state, userId);
    return owned.length ? `名下 ${owned.length} 项：${owned.slice(0, 3).map(o => o.role + ' ' + o.label).join('；')}${owned.length > 3 ? ' 等' : ''}` : '名下暂无负责对象';
  };
  const change = async (action: 'add' | 'remove', target: string) => {
    if (!owner || disabled || inFlight.current) return;
    const boundScope = scope, current = () => mounted.current && liveScope.current === boundScope;
    inFlight.current = true; setBusy(true); setError('');
    try { await workspace.changeMember!(action, target); if (current() && action === 'add') setAccount(''); }
    catch (failure) { if (current()) setError(failure instanceof Error ? failure.message : '授权未完成'); }
    finally { if (current()) { inFlight.current = false; setBusy(false); } }
  };
  return <>{company ? <FormSection title={uiText("公司成员")} description={uiText("公司在职成员自动进入本公司，离职或停用即不能进入。看到哪些模块按岗位权限，看到哪些业务按本人、所在部门与小组的数据范围决定。成员在人事中维护。")}><p className="mist-note">{uiText(`当前在职成员 ${directory.length} 人。`)}</p></FormSection> : <FormSection title={uiText("授权访问")} description={uiText("授权只让对方进入公司。对方能看到哪些数据、能办理哪些动作，仍按其本人岗位权限决定，由服务端校验。")}>
    {!owner && <Banner tone="neutral" title={uiText("你是被授权成员")}>{uiText("公司成员管理与授权由公司管理人员办理；你可以按本人岗位权限查看和办理业务。")}</Banner>}
    {error && <Banner tone="bad" title={uiText("授权未完成")}>{uiText(error)}</Banner>}
    <SettingRow title={uiText("公司管理人员")} description={uiText(envelope.ownerId === session.user?.id ? '当前账号' : '创建公司的账号')} control={<span className="mist-mono">{uiText(envelope.ownerId === session.user?.id ? session.user?.displayName : envelope.ownerId)}</span>} />
    {members.map(m => <SettingRow key={m.userId} title={uiText(m.name)} description={ui`${m.addedByName} 于 ${when(m.addedAt)} 授权`} control={owner ? <Button size="sm" disabled={disabled} onClick={() => void change('remove', m.userId)}>{uiText("撤销授权")}</Button> : <span className="mist-note">{uiText(m.userId === session.user?.id ? '当前账号' : '已授权')}</span>} />)}
    {!members.length && <p className="mist-note">{uiText("尚未授权其他账号。")}</p>}
    {owner && <div className="mist-row">
      <Field label={uiText(session.localMode ? '本地工作身份' : '员工账号')} hint={uiText(session.localMode ? '本地测试身份的权限取自现有岗位' : '填写登录邮箱或账号编号')}>
        {session.localMode
          ? <Select aria-label={uiText("要授权的本地工作身份")} disabled={disabled || !candidates.length} value={account} onChange={event => setAccount(event.target.value)} placeholder={uiText(candidates.length ? '选择身份' : '没有可授权的身份')} options={candidates.map(p => ({ value: p.id, label: p.name }))} />
          : <TextInput aria-label={uiText("要授权的员工账号")} disabled={disabled} value={account} onChange={event => setAccount(event.target.value)} />}
      </Field>
      <Button icon={UserPlus} disabled={disabled || !account.trim()} loading={busy} onClick={() => void change('add', account)}>{uiText("授权进入")}</Button>
    </div>}
    {log.length > 0 && <div className="mist-col"><b>{uiText("授权记录")}</b>{log.slice(0, 20).map(l => <small key={l.id}>{when(l.at)} · {l.actorName}{uiText(l.action === 'add' ? ' 授权 ' : ' 撤销 ')}{l.name}</small>)}</div>}
  </FormSection>}
  <FormSection title={uiText("管理业务线")} description={uiText("只对主管岗位生效：面料主管看到并管理全部面料订单、采购、开发与履约，成衣主管同理。业务员不需设置，可同时办理面料和成衣。")}>
    {!manager && <p className="mist-note">{uiText("管理业务线只能由公司管理人员设置。")}</p>}
    {directory.map(m => <SettingRow key={m.id} title={uiText(m.owner ? `${m.name}（公司管理人员）` : m.name)} description={uiText(ownedSummary(m.id))} control={groupControl(m.id)} />)}
  </FormSection>
  {manager && <MemberHandover state={state} directory={directory} busy={outerBusy || busy} />}</>;
}