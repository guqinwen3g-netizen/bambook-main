import { useNav } from '../../nav';
import { permissionLabel } from '../../runtime/permissionLabels';
import { interfaceLocale } from '../../../../../services/interfaceLanguage';
import { uiText, ui } from '../../../../../services/interfaceLanguage';
/** 管理后台 · 账号：公司成员身份只在这里新建或经注册审批产生（2026-10-08 决定）；岗位即权限角色，每人一个岗位，岗位权限仅老板可调整（2026-10-16 起），审计只读。 */
import React from 'react';
import { KeyRound, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { Banner, Button, Card, CardHeader, Checkbox, DataTable, Dialog, Drawer, EmptyState, Field, FormGrid, KeyValue, Mono, Pill, Select, TextArea, TextInput, Toolbar, useToast, type Column } from '../../../../../components/mist';
import { useMistSession } from '../../runtime/auth';
import { useMistWorkspace } from '../../runtime/workspace';
import { ACCOUNT_STATUS, departmentOptions, organizationApi, type AdminAccount, type AdminRole, type AuditLogRow, type OrgDepartment } from '../../runtime/organization';
import { passwordOk } from '../../runtime/passwordRule';
import { JOB_TEMPLATES } from '../../runtime/jobPermissions';
import { JobPermissionEditor, jobSummary } from './JobPermissionEditor';

const SUPER_ADMIN = new Set(['role-super-admin', '老板', '超级管理员', 'SuperAdmin', 'super-admin']);
const isSuperAdmin = (role: AdminRole) => SUPER_ADMIN.has(role.id.split('@')[0]) || SUPER_ADMIN.has(role.name);
const when = (at: string | null | undefined) => at ? new Date(at).toLocaleString(interfaceLocale(), { hour12: false }) : '—';
const message = (e: unknown, fallback: string) => e instanceof Error ? e.message : fallback;

type Directory = { users: AdminAccount[]; departments: OrgDepartment[]; roles: AdminRole[] };
function useDirectory() {
  const session = useMistSession();
  const [data, setData] = React.useState<Directory | null>(null), [loading, setLoading] = React.useState(true), [error, setError] = React.useState('');
  const serial = React.useRef(0);
  const load = React.useCallback(async () => {
    const run = ++serial.current; setLoading(true); setError('');
    try { const [accounts, roles] = await Promise.all([organizationApi.listAccounts(), organizationApi.listRoles()]); if (run === serial.current) setData({ users: accounts.users ?? [], departments: accounts.departments ?? [], roles: roles.roles ?? [] }); }
    catch (e) { if (run === serial.current) setError(message(e, '账号读取失败')); }
    finally { if (run === serial.current) setLoading(false); }
  }, []);
  React.useEffect(() => { setData(null); void load(); return () => { serial.current++; }; }, [session.sessionKey, load]);
  return { data, loading, error, load };
}

/** 岗位单选：总经理岗位只有总经理本人能授予，服务器同样复核。 */
function JobSelect({ roles, value, onChange, owner, disabled }: { roles: AdminRole[]; value: string[]; onChange: (v: string[]) => void; owner: boolean; disabled?: boolean }) {
  const options = roles.filter(role => owner || !isSuperAdmin(role) || value.includes(role.id)).map(role => ({ value: role.id, label: role.name }));
  return <Select aria-label={uiText("岗位")} value={value[0] ?? ''} disabled={disabled} placeholder={uiText("选择岗位")} onChange={e => onChange(e.target.value ? [e.target.value] : [])} options={options} />;
}

type Form = { mode: 'create' | 'approve' | 'edit'; account?: AdminAccount; displayName: string; email: string; password: string; departmentId: string; roles: string[]; grant: boolean };
function blank(): Form { return { mode: 'create', displayName: '', email: '', password: '', departmentId: '', roles: [], grant: true }; }

export function AdminAccounts() {
  const session = useMistSession(), workspace = useMistWorkspace(), toast = useToast(), { route, go } = useNav();
  const { data, loading, error, load } = useDirectory();
  const owner = session.hasRole('owner'), hrRead = session.hasPermission('hr:read') || session.hasPermission('hr:write');
  const [query, setQuery] = React.useState(''), [status, setStatus] = React.useState('');
  const [selected, setSelected] = React.useState<string | null>(null), [form, setForm] = React.useState<Form | null>(null);
  React.useEffect(() => { setSelected(route.id ?? null); }, [route.id]);
  const [busy, setBusy] = React.useState(false), [formError, setFormError] = React.useState('');
  const [confirm, setConfirm] = React.useState<{ kind: 'disable' | 'enable' | 'reset' | 'reject'; account: AdminAccount } | null>(null), [reason, setReason] = React.useState('');
  const [decisionError, setDecisionError] = React.useState('');
  React.useEffect(() => { setDecisionError(''); }, [confirm?.kind, confirm?.account.id]);
  const [temporary, setTemporary] = React.useState<{ name: string; password: string } | null>(null);
  const envelope = workspace.workspace, canGrant = envelope?.access?.canManageMembers === true && !!workspace.changeMember;
  const memberIds = new Set((workspace.state?.members ?? []).map(m => m.userId));
  const roleName = (roleId: string) => data?.roles.find(r => r.id === roleId)?.name ?? roleId;
  const departments = data ? departmentOptions(data.departments) : [];
  const users = (data?.users ?? []).filter(u => (!status || u.status === status) && (!query.trim() || [u.displayName, u.email, u.department ?? ''].join(' ').toLowerCase().includes(query.trim().toLowerCase())));
  const pending = (data?.users ?? []).filter(u => u.status === 'pending');
  const current = data?.users.find(u => u.id === selected) ?? null;

  const grant = async (userId: string, name: string) => {
    try { await workspace.changeMember!('add', userId); return true; }
    catch (e) { toast(`账号已生效，但授权进入「${envelope?.name}」未完成：${message(e, '请稍后在账号详情重试')}`, 'bad'); return false; }
  };
  const submit = async () => {
    if (!form || busy) return;
    const f = form;
    if (f.mode !== 'edit' && !f.departmentId) return setFormError('请选择任职部门（不能直接归属公司）');
    if (f.mode !== 'edit' && !f.roles.length) return setFormError('请选择岗位');
    if (f.mode === 'create' && (!f.displayName.trim() || !f.email.trim() || !passwordOk(f.password))) return setFormError('请填写姓名、邮箱，初始密码须包含字母和数字且至少 8 位');
    setBusy(true); setFormError('');
    try {
      let userId = f.account?.id ?? '';
      if (f.mode === 'create') userId = (await organizationApi.createAccount({ displayName: f.displayName.trim(), email: f.email.trim(), password: f.password, roles: f.roles, departmentId: f.departmentId })).userId;
      else if (f.mode === 'approve') await organizationApi.approve(userId, f.roles, f.departmentId);
      else if (session.user?.companyId) {
        await organizationApi.saveAccountAssignment(userId, { displayName: f.displayName.trim(), email: f.email.trim(), departmentId: f.departmentId || null, roles: f.roles });
      } else {
        await organizationApi.updateAccount(userId, { displayName: f.displayName.trim(), email: f.email.trim(), departmentId: f.departmentId || undefined });
        await organizationApi.setRoles(userId, f.roles, f.departmentId || null);
      }
      const granted = f.mode !== 'edit' && f.grant && canGrant ? await grant(userId, f.displayName) : false;
      toast(f.mode === 'create' ? (granted ? `账号已创建并授权进入「${envelope?.name}」` : '账号已创建') : f.mode === 'approve' ? (granted ? `已通过审批并授权进入「${envelope?.name}」` : '已通过注册审批') : '账号已更新');
      setForm(null); setSelected(userId); await load();
    } catch (e) { setFormError(message(e, '保存未完成')); }
    finally { setBusy(false); }
  };
  const decide = async () => {
    if (!confirm || busy) return;
    const { kind, account } = confirm;
    if (kind === 'reject' && !reason.trim()) return;
    setBusy(true); setDecisionError('');
    try {
      if (kind === 'disable') await organizationApi.disable(account.id);
      else if (kind === 'enable') await organizationApi.updateAccount(account.id, { status: 'active' });
      else if (kind === 'reject') await organizationApi.reject(account.id, reason.trim());
      else { const result = await organizationApi.resetPassword(account.id); if (result.temporaryPassword) setTemporary({ name: account.displayName, password: result.temporaryPassword }); }
      toast({ disable: '账号已停用，历史记录保留', enable: '账号已重新启用', reject: '已拒绝注册申请', reset: '密码已重置' }[kind]);
      setConfirm(null); setReason(''); await load();
    } catch (e) { setDecisionError(message(e, '操作未完成')); }
    finally { setBusy(false); }
  };

  const columns: Column<AdminAccount>[] = [
    { key: 'name', header: '姓名 / 邮箱', width: 'minmax(200px,2fr)', render: u => <><b>{u.displayName}</b><div className="mist-note">{u.email}</div></>, sortValue: u => u.displayName },
    { key: 'department', header: '任职部门', render: u => u.department ?? <span className="mist-note">{uiText("未分配")}</span> },
    { key: 'roles', header: '岗位', width: 'minmax(160px,1.5fr)', render: u => u.roleIds.length ? u.roleIds.map(roleName).join('、') : <span className="mist-note">{uiText("未设岗位")}</span> },
    { key: 'status', header: '状态', width: '96px', render: u => <Pill tone={ACCOUNT_STATUS[u.status]?.tone ?? 'neutral'}>{ACCOUNT_STATUS[u.status]?.label ?? u.status}</Pill> },
    { key: 'login', header: '最近登录', width: '150px', render: u => when(u.lastLoginAt), sortValue: u => u.lastLoginAt ?? '' },
  ];
  const self = current?.id === session.user?.id;
  return <>
    {error && <Banner tone="bad" title={uiText("账号读取失败")} actions={<Button size="sm" icon={RefreshCw} onClick={() => void load()}>{uiText("重试")}</Button>}>{uiText(error)}</Banner>}
    {pending.length > 0 && <Banner tone="warn" title={ui`${pending.length} 个注册申请待审批`}>{uiText("审批时确定任职部门与岗位；通过后对方才能登录。")}</Banner>}
    <Toolbar right={<Button variant="primary" icon={UserPlus} disabled={!data} onClick={() => { setFormError(''); setForm(blank()); }}>{uiText("新建账号")}</Button>}>
      <Field label={uiText("搜索")}><TextInput aria-label={uiText("搜索账号")} placeholder={uiText("姓名、邮箱或部门")} value={query} onChange={e => setQuery(e.target.value)} /></Field>
      <Field label={uiText("状态")}><Select aria-label={uiText("账号状态")} value={status} onChange={e => setStatus(e.target.value)} options={[{ value: '', label: '全部状态' }, ...Object.entries(ACCOUNT_STATUS).map(([value, s]) => ({ value, label: s.label }))]} /></Field>
    </Toolbar>
    <Card><DataTable ariaLabel={uiText("公司账号")} rows={users} rowKey={u => u.id} loading={loading && !data} selectedKey={selected} onRowClick={u => setSelected(u.id)} columns={columns}
      empty={<EmptyState title={uiText(data?.users.length ? '没有符合条件的账号' : '还没有公司账号')} description={uiText(data?.users.length ? '调整搜索或状态后再看。' : '用“新建账号”创建第一位成员。')} />} /></Card>
    <Drawer open={!!current && !form} onClose={() => setSelected(null)} title={uiText(current?.displayName ?? '')} sub={uiText(current?.email)}
      footer={current && <div className="mist-row">
        {current.status === 'pending' && <><Button variant="primary" onClick={() => { setFormError(''); setForm({ ...blank(), mode: 'approve', account: current, displayName: current.displayName, email: current.email, departmentId: current.departmentId ?? '', roles: current.roleIds }); }}>{uiText("审批通过")}</Button><Button onClick={() => setConfirm({ kind: 'reject', account: current })}>{uiText("拒绝")}</Button></>}
        {current.status === 'active' && <><Button onClick={() => { setFormError(''); setForm({ ...blank(), mode: 'edit', account: current, displayName: current.displayName, email: current.email, departmentId: current.departmentId ?? '', roles: current.roleIds }); }}>{uiText("修改资料与岗位")}</Button><Button icon={KeyRound} onClick={() => setConfirm({ kind: 'reset', account: current })}>{uiText("重置密码")}</Button><Button disabled={self} onClick={() => setConfirm({ kind: 'disable', account: current })}>{uiText(self ? '不能停用自己' : '停用账号')}</Button></>}
        {current.status === 'disabled' && <Button onClick={() => setConfirm({ kind: 'enable', account: current })}>{uiText("重新启用")}</Button>}
        {hrRead && current.status !== 'pending' && <Button onClick={() => go('hr', current.id, { section: 'people' })}>{uiText("员工档案")}</Button>}
      </div>}>
      {current && <>
        <KeyValue items={[{ label: '状态', value: ACCOUNT_STATUS[current.status]?.label ?? current.status }, { label: '任职部门', value: current.department ?? '未分配' }, { label: '岗位', value: current.roleIds.map(roleName).join('、') || '未设岗位' }, { label: '创建时间', value: when(current.createdAt) }, { label: '最近登录', value: when(current.lastLoginAt) }]} />
        {envelope && current.status === 'active' && <div className="mist-section">{envelope.ownerId === current.id ? <Banner tone="neutral" title={ui`「${envelope.name}」的所有者`} /> : memberIds.has(current.id)
          ? <Banner tone="ok" title={ui`已授权进入「${envelope.name}」`}>{uiText("能办理哪些业务仍按其岗位与任职部门决定。")}</Banner>
          : <Banner tone="warn" title={ui`尚未授权进入「${envelope.name}」`} actions={canGrant ? <Button size="sm" disabled={busy} onClick={async () => { setBusy(true); if (await grant(current.id, current.displayName)) toast('已授权进入本公司'); setBusy(false); }}>{uiText("授权进入")}</Button> : undefined}>{uiText(canGrant ? '授权只让对方进入这家公司，不增加任何业务权限。' : '请公司所有者在“公司管理 · 数据访问”中授权。')}</Banner>}</div>}
      </>}
    </Drawer>
    <Drawer open={!!form} onClose={() => !busy && setForm(null)} title={uiText(form?.mode === 'create' ? '新建账号' : form?.mode === 'approve' ? '审批注册申请' : '修改资料与岗位')} sub={uiText(form?.account?.email)}
      footer={<div className="mist-row"><Button variant="primary" loading={busy} onClick={() => void submit()}>{uiText(form?.mode === 'create' ? '创建账号' : form?.mode === 'approve' ? '通过审批' : '保存')}</Button><Button disabled={busy} onClick={() => setForm(null)}>{uiText("取消")}</Button></div>}>
      {form && data && <>
        {formError && <Banner tone="bad" title={uiText("未保存")}>{formError}</Banner>}
        <FormGrid>
          <Field label={uiText("姓名")} required><TextInput value={form.displayName} disabled={busy || form.mode === 'approve' || form.account?.identityEditable === false} onChange={e => setForm({ ...form, displayName: e.target.value })} /></Field>
          <Field label={uiText("登录邮箱")} required><TextInput type="email" value={form.email} disabled={busy || form.mode === 'approve' || form.account?.identityEditable === false} onChange={e => setForm({ ...form, email: e.target.value })} /></Field>
          {form.mode === 'create' && <Field label={uiText("初始密码")} required hint={uiText("至少 8 位，含字母和数字")}><TextInput type="password" autoComplete="new-password" value={form.password} disabled={busy} onChange={e => setForm({ ...form, password: e.target.value })} /></Field>}
          <Field label={uiText("任职部门")} required><Select aria-label={uiText("任职部门")} value={form.departmentId} disabled={busy} placeholder={uiText("选择部门")} onChange={e => setForm({ ...form, departmentId: e.target.value })} options={departments} /></Field>
          <Field label={uiText("岗位")} required><JobSelect roles={data.roles} value={form.roles} owner={owner} disabled={busy} onChange={roles => setForm({ ...form, roles })} /></Field>
          {form.mode !== 'edit' && envelope && <Field label={uiText("公司")} full>{canGrant ? <Checkbox checked={form.grant} disabled={busy} onChange={grant => setForm({ ...form, grant })} label={ui`同时授权进入「${envelope.name}」`} /> : <span className="mist-note">{uiText("你不是「")}{envelope.name}{uiText("」的所有者；账号生效后请所有者授权。")}</span>}</Field>}
        </FormGrid>
      </>}
    </Drawer>
    <Dialog open={!!confirm} onClose={() => !busy && setConfirm(null)} tone={confirm?.kind === 'disable' || confirm?.kind === 'reject' ? 'bad' : 'warn'}
      title={uiText(confirm ? { disable: '停用账号', enable: '重新启用账号', reset: '重置密码', reject: '拒绝注册申请' }[confirm.kind] : '')}
      description={uiText(confirm ? { disable: `${confirm.account.displayName} 将无法登录，已登录的会话随即失效；历史单据与小组记录保留。`, enable: `${confirm.account.displayName} 可以再次登录，岗位与部门保持不变。`, reset: `将为 ${confirm.account.displayName} 生成临时密码，只显示一次，请当面或经内部渠道转交，并提醒对方登录后在“设置 · 安全”中修改。`, reject: `${confirm.account.displayName} 的申请将被拒绝，请写明原因。` }[confirm.kind] : undefined)}
      footer={<div className="mist-row"><Button variant="primary" loading={busy} disabled={confirm?.kind === 'reject' && !reason.trim()} onClick={() => void decide()}>{uiText("确认")}</Button><Button disabled={busy} onClick={() => setConfirm(null)}>{uiText("取消")}</Button></div>}>
      {decisionError && <Banner tone="bad" title={uiText("操作未完成")}>{uiText(decisionError)}</Banner>}
      {confirm?.kind === 'reject' && <Field label={uiText("拒绝原因")} required><TextArea value={reason} onChange={e => setReason(e.target.value)} /></Field>}
    </Dialog>
    <Dialog open={!!temporary} onClose={() => setTemporary(null)} title={uiText("临时密码")} description={ui`请转交 ${temporary?.name ?? ''}；对方用它登录后会被要求先设置新密码。关闭后不再显示。`} footer={<Button variant="primary" onClick={() => setTemporary(null)}>{uiText("已转交")}</Button>}>
      <Mono>{temporary?.password}</Mono>
    </Dialog>
  </>;
}

const scopeLabel = permissionLabel;

/** 权限勾选：按模块分组，可按模块、名称或代码筛选。 */
type RoleDraft = { mode: 'create' | 'rename'; role?: AdminRole; name: string; description: string; template: string; permissions: string[] };
const TEMPLATE_PREFIX = 'template:';

/** 岗位与权限：老板按公司实际岗位新建 / 改名 / 删除自定义岗位，并按模块调整非总经理岗位的权限（服务器同样只许老板办理、并记审计）。 */
export function AdminRoles() {
  const session = useMistSession(), toast = useToast(), owner = session.hasRole('owner');
  const { data, loading, error, load } = useDirectory();
  const [catalog, setCatalog] = React.useState<Array<{ scope: string; description: string | null }> | null>(null), [catalogError, setCatalogError] = React.useState('');
  const [editing, setEditing] = React.useState<{ role: AdminRole; next: string[] } | null>(null);
  const [draft, setDraft] = React.useState<RoleDraft | null>(null), [removing, setRemoving] = React.useState<AdminRole | null>(null);
  const [confirming, setConfirming] = React.useState(false), [busy, setBusy] = React.useState(false), [saveError, setSaveError] = React.useState('');
  const counts = (roleId: string) => (data?.users ?? []).filter(u => u.status === 'active' && u.roleIds.includes(roleId)).length;
  const holders = (roleId: string) => (data?.users ?? []).filter(u => (u.status === 'active' || u.status === 'pending') && u.roleIds.includes(roleId));
  const loadCatalog = async () => {
    if (catalog) return;
    try { setCatalogError(''); setCatalog((await organizationApi.listPermissions()).permissions ?? []); }
    catch (e) { setCatalogError(message(e, '权限目录读取失败')); }
  };
  const openEditor = async (role: AdminRole) => { setSaveError(''); setEditing({ role, next: [...role.permissions] }); await loadCatalog(); };
  const openCreate = async () => { setSaveError(''); setDraft({ mode: 'create', name: '', description: '', template: '', permissions: [] }); await loadCatalog(); };
  const openRename = (role: AdminRole) => { setSaveError(''); setDraft({ mode: 'rename', role, name: role.name, description: role.description ?? '', template: '', permissions: [] }); };
  const added = editing ? editing.next.filter(p => !editing.role.permissions.includes(p)) : [];
  const removed = editing ? editing.role.permissions.filter(p => !editing.next.includes(p)) : [];
  const describe = (scope: string) => scopeLabel(scope, catalog?.find(c => c.scope === scope)?.description);
  const templates = (data?.roles ?? []).filter(r => !isSuperAdmin(r));
  const scopes = React.useMemo(() => (catalog ?? []).map(c => c.scope).filter(sc => sc !== '*'), [catalog]);
  const applyTemplate = (id: string) => {
    if (id.startsWith(TEMPLATE_PREFIX)) { const preset = JOB_TEMPLATES.find(t => TEMPLATE_PREFIX + t.id === id); return preset ? preset.permissions.filter(sc => scopes.includes(sc)) : []; }
    return templates.find(r => r.id === id)?.permissions.filter(sc => sc !== '*') ?? [];
  };
  const save = async () => {
    if (!editing || busy) return;
    setBusy(true); setSaveError('');
    try {
      await organizationApi.updateRolePermissions(editing.role.id, { addPermissions: added, removePermissions: removed });
      toast(`已调整「${editing.role.name}」的权限`); setConfirming(false); setEditing(null); await load();
    } catch (e) { setSaveError(message(e, '权限未保存')); setConfirming(false); }
    finally { setBusy(false); }
  };
  const saveDraft = async () => {
    if (!draft || busy) return;
    const name = draft.name.trim();
    if (!name) return setSaveError('请填写岗位名称');
    if (draft.mode === 'create' && !draft.permissions.length) return setSaveError('请至少选择一项权限');
    setBusy(true); setSaveError('');
    try {
      if (draft.mode === 'create') { await organizationApi.createRole({ name, description: draft.description.trim(), permissions: draft.permissions }); toast(`已新建岗位「${name}」，可在“账号”中分配给成员`); }
      else if (draft.role) { await organizationApi.updateRole(draft.role.id, { name, description: draft.description.trim() }); toast(`已保存岗位「${name}」`); }
      setDraft(null); await load();
    } catch (e) { setSaveError(message(e, '岗位未保存')); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!removing || busy) return;
    setBusy(true); setSaveError('');
    try { await organizationApi.deleteRole(removing.id); toast(`已删除岗位「${removing.name}」`); setRemoving(null); await load(); }
    catch (e) { setSaveError(message(e, '岗位未删除')); }
    finally { setBusy(false); }
  };
  const removingHolders = removing ? holders(removing.id) : [];
  return <>
    {error && <Banner tone="bad" title={uiText("岗位读取失败")} actions={<Button size="sm" icon={RefreshCw} onClick={() => void load()}>{uiText("重试")}</Button>}>{uiText(error)}</Banner>}
    {!owner && <Pill plain>{uiText("只读")}</Pill>}
    {owner && <Toolbar right={<Button variant="primary" icon={Plus} onClick={() => void openCreate()}>{uiText("新建岗位")}</Button>}><span className="mist-note">{uiText("共 ")}{data?.roles.length ?? 0}{uiText(" 个岗位 · 自定义 ")}{(data?.roles ?? []).filter(r => !r.isSystem).length}{uiText(" 个")}</span></Toolbar>}
    <Card><DataTable ariaLabel={uiText("岗位")} rows={data?.roles ?? []} rowKey={r => r.id} loading={loading && !data} onRowClick={r => void openEditor(r)} columns={[
      { key: 'name', header: '岗位', width: 'minmax(160px,1fr)', render: r => <><b>{r.name}</b> <Pill plain>{uiText(r.isSystem ? '系统' : '自定义')}</Pill></> },
      { key: 'users', header: '在岗', width: '80px', align: 'right', render: r => counts(r.id) },
      { key: 'permissions', header: '权限', width: 'minmax(260px,3fr)', render: r => r.permissions.includes('*') ? <span className="mist-note">{uiText("全部权限")}</span> : r.permissions.length ? <span>{uiText(jobSummary(r.permissions) || `${r.permissions.length} 项权限`)}</span> : <span className="mist-note">{uiText("无")}</span> },
      ...(owner ? [{ key: 'edit', header: '', width: '260px', render: (r: AdminRole) => isSuperAdmin(r) ? <span className="mist-note">{uiText("不可调整")}</span> : <div className="mist-row" onClick={e => e.stopPropagation()}>
        <Button size="sm" icon={ShieldCheck} onClick={() => void openEditor(r)}>{uiText("调整权限")}</Button>
        {!r.isSystem && <><Button size="sm" icon={Pencil} aria-label={ui`编辑「${r.name}」`} onClick={() => openRename(r)}>{uiText("编辑")}</Button><Button size="sm" variant="quiet" icon={Trash2} aria-label={ui`删除「${r.name}」`} onClick={() => { setSaveError(''); setRemoving(r); }}>{uiText("删除")}</Button></>}
      </div> }] : [{ key: 'view', header: '', width: '120px', render: (r: AdminRole) => <Button size="sm" onClick={() => void openEditor(r)}>{uiText("查看权限")}</Button> }]),
    ]} empty={<EmptyState title={uiText("没有岗位")} />} /></Card>

    <Drawer open={!!editing} onClose={() => !busy && setEditing(null)} title={editing ? ui`${editing.role.name} · 权限` : ''} size="lg" sub={uiText(editing ? `${counts(editing.role.id)} 人在岗` : undefined)}
      footer={<div className="mist-row">{owner && editing && !isSuperAdmin(editing.role) && <Button variant="primary" disabled={!catalog || (!added.length && !removed.length)} onClick={() => setConfirming(true)}>{uiText("保存（新增 ")}{added.length}{uiText(" · 移除 ")}{removed.length}）</Button>}<Button disabled={busy} onClick={() => setEditing(null)}>{uiText("取消")}</Button></div>}>
      {editing && <>
        {saveError && <Banner tone="bad" title={uiText("未保存")}>{saveError}</Banner>}
        {isSuperAdmin(editing.role) ? <Pill plain>{uiText("全部权限")}</Pill> : catalogError ? <Banner tone="bad" title={uiText("权限目录读取失败")}>{catalogError}</Banner> : !catalog ? <p className="mist-note">{uiText("读取权限目录…")}</p> :
          <JobPermissionEditor catalog={scopes} value={editing.next} readOnly={busy || !owner} onChange={next => setEditing({ ...editing, next })} />}
      </>}
    </Drawer>
    <Dialog open={confirming} onClose={() => !busy && setConfirming(false)} tone="warn" title={uiText(editing ? `确认调整「${editing.role.name}」的权限` : '')}
      description={editing ? ui`影响 ${counts(editing.role.id)} 名在岗人员。` : undefined}
      footer={<div className="mist-row"><Button variant="primary" loading={busy} onClick={() => void save()}>{uiText("确认调整")}</Button><Button disabled={busy} onClick={() => setConfirming(false)}>{uiText("返回修改")}</Button></div>}>
      {added.length > 0 && <><b>{uiText("新增")}</b><ul>{added.map(sc => <li key={sc}>{describe(sc)}</li>)}</ul></>}
      {removed.length > 0 && <><b>{uiText("移除")}</b><ul>{removed.map(sc => <li key={sc}>{describe(sc)}</li>)}</ul></>}
    </Dialog>

    <Drawer open={!!draft} size={draft?.mode === 'create' ? 'lg' : undefined} onClose={() => !busy && setDraft(null)} title={uiText(draft?.mode === 'create' ? '新建岗位' : draft?.role ? `编辑「${draft.role.name}」` : '')}
      footer={<div className="mist-row"><Button variant="primary" loading={busy} onClick={() => void saveDraft()}>{uiText(draft?.mode === 'create' ? `创建岗位（${draft.permissions.length} 项权限）` : '保存')}</Button><Button disabled={busy} onClick={() => setDraft(null)}>{uiText("取消")}</Button></div>}>
      {draft && <>
        {saveError && <Banner tone="bad" title={uiText("未保存")}>{saveError}</Banner>}
        <FormGrid cols={1}>
          <Field label={uiText("岗位名称")} required><TextInput aria-label={uiText("岗位名称")} value={draft.name} maxLength={40} onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field>
          <Field label={uiText("说明")}><TextArea aria-label={uiText("岗位说明")} value={draft.description} maxLength={200} onChange={e => setDraft({ ...draft, description: e.target.value })} /></Field>
          {draft.mode === 'create' && <Field label={uiText("参照")}><Select aria-label={uiText("参照岗位")} value={draft.template} onChange={e => setDraft({ ...draft, template: e.target.value, permissions: e.target.value ? applyTemplate(e.target.value) : [] })} options={[{ value: '', label: '从空白开始' }, ...templates.map(r => ({ value: r.id, label: r.name })), ...JOB_TEMPLATES.filter(t => !templates.some(r => r.name === t.name)).map(t => ({ value: TEMPLATE_PREFIX + t.id, label: `常见岗位 · ${t.name}` }))]} /></Field>}
        </FormGrid>
        {draft.mode === 'create' && (catalogError ? <Banner tone="bad" title={uiText("权限目录读取失败")}>{catalogError}</Banner> : !catalog ? <p className="mist-note">{uiText("读取权限目录…")}</p> :
          <JobPermissionEditor catalog={scopes} value={draft.permissions} readOnly={busy} onChange={permissions => setDraft({ ...draft, permissions })} />)}
      </>}
    </Drawer>
    <Dialog open={!!removing} onClose={() => !busy && setRemoving(null)} tone="warn" title={uiText(removing ? `删除岗位「${removing.name}」？` : '')}
      description={uiText(removingHolders.length ? `还有 ${removingHolders.length} 人在此岗位，请先为他们调岗后再删除。` : '删除后不可恢复；该岗位的权限组合一并移除，记入审计。')}
      footer={<div className="mist-row"><Button variant="danger" loading={busy} disabled={removingHolders.length > 0} onClick={() => void remove()}>{uiText("删除岗位")}</Button><Button disabled={busy} onClick={() => setRemoving(null)}>{uiText("取消")}</Button></div>}>
      {saveError && <Banner tone="bad" title={uiText("未删除")}>{saveError}</Banner>}
      {removingHolders.length > 0 && <ul>{removingHolders.slice(0, 8).map(u => <li key={u.id}>{u.displayName}（{ACCOUNT_STATUS[u.status]?.label ?? u.status}）</li>)}</ul>}
    </Dialog>
  </>;
}

const AUDIT_ACTIONS: Record<string, string> = { login: '登录', register: '提交注册', create_user: '新建账号', reactivate_user: '重新启用账号', update_user: '修改账号', update_profile: '修改个人资料', reset_password: '重置密码', disable_account: '停用账号', approve_register: '通过注册', reject_register: '拒绝注册', update_roles: '调整岗位', update_role_permissions: '调整岗位权限', create_role: '新建岗位', update_role: '编辑岗位', delete_role: '删除岗位', reset_mfa: '重置两步验证', enable_mfa: '开启两步验证', disable_mfa: '关闭两步验证', login_mfa_recovery: '用恢复码登录', logout_all_sessions: '退出所有设备', erase_personal_data: '清除个人数据', create_department: '新建部门', edit_department: '修改部门', retire_department: '裁撤部门', create_team: '新建小组', update_team: '修改小组', delete_team: '解散小组', add_team_member: '加入小组', remove_team_member: '移出小组', upsert_employee: '保存员工档案', delete_employee: '删除员工档案' };
const AUDIT_TARGETS: Record<string, string> = { UserAccount: '账号', Department: '部门', Team: '小组', TeamMember: '小组成员', EmployeeProfile: '员工档案', Role: '岗位' };
export function AdminAuditLog() {
  const session = useMistSession();
  // 操作人与账号对象显示姓名；读不到账号表时退回原编号。
  const [names, setNames] = React.useState<Record<string, string>>({});
  React.useEffect(() => { let live = true; organizationApi.listAccounts().then(r => { if (live) setNames(Object.fromEntries((r.users ?? []).map(u => [u.id, u.displayName]))); }).catch(() => undefined); return () => { live = false; }; }, [session.sessionKey]);
  const person = (id: string | null | undefined) => id ? (names[id] ? <span title={uiText(id)}>{names[id]}</span> : <Mono>{id}</Mono>) : '—';
  const [rows, setRows] = React.useState<AuditLogRow[]>([]), [total, setTotal] = React.useState(0), [page, setPage] = React.useState(0), [targetType, setTargetType] = React.useState('');
  const [loading, setLoading] = React.useState(true), [error, setError] = React.useState('');
  const size = 50, serial = React.useRef(0);
  const load = React.useCallback(async () => {
    const run = ++serial.current; setLoading(true); setError('');
    try { const result = await organizationApi.auditLogs({ limit: size, offset: page * size, targetType }); if (run === serial.current) { setRows(result.logs ?? []); setTotal(result.total ?? 0); } }
    catch (e) { if (run === serial.current) setError(message(e, '审计日志读取失败')); }
    finally { if (run === serial.current) setLoading(false); }
  }, [page, targetType]);
  React.useEffect(() => { void load(); return () => { serial.current++; }; }, [load, session.sessionKey]);
  return <>
    {error && <Banner tone="bad" title={uiText("审计日志读取失败")} actions={<Button size="sm" icon={RefreshCw} onClick={() => void load()}>{uiText("重试")}</Button>}>{uiText(error)}</Banner>}
    <Toolbar right={<span className="mist-note">{uiText("共 ")}{total}{uiText(" 条 · 第 ")}{uiText(page + 1)} / {Math.max(1, Math.ceil(total / size))}{uiText(" 页")}</span>}>
      <Field label={uiText("对象")}><Select aria-label={uiText("审计对象")} value={targetType} onChange={e => { setPage(0); setTargetType(e.target.value); }} options={[{ value: '', label: '全部对象' }, ...Object.entries(AUDIT_TARGETS).map(([value, label]) => ({ value, label }))]} /></Field>
      <Button disabled={loading || page === 0} onClick={() => setPage(page - 1)}>{uiText("上一页")}</Button><Button disabled={loading || (page + 1) * size >= total} onClick={() => setPage(page + 1)}>{uiText("下一页")}</Button>
    </Toolbar>
    <Card><DataTable ariaLabel={uiText("审计日志")} rows={rows} rowKey={r => r.id} loading={loading} columns={[
      { key: 'at', header: '时间', width: '170px', render: r => when(r.createdAt) },
      { key: 'actor', header: '操作人', width: 'minmax(140px,1fr)', render: r => person(r.actorId) },
      { key: 'action', header: '动作', width: 'minmax(120px,1fr)', render: r => AUDIT_ACTIONS[r.action] ?? r.action },
      { key: 'target', header: '对象', width: 'minmax(180px,2fr)', render: r => <>{AUDIT_TARGETS[r.targetType] ?? r.targetType} {r.targetType === 'UserAccount' ? person(r.targetId) : <Mono>{r.targetId ?? ''}</Mono>}</> },
    ]} empty={<EmptyState title={uiText("没有审计记录")} description={uiText("调整对象筛选后再看。")} />} /></Card>
  </>;
}
