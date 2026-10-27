import { uiText, ui } from '../../../../../services/interfaceLanguage';
import {businessNow} from '../../runtime/businessClock';
/** 人事管理：公司组织架构（部门 / 小组）、人员名册、员工档案与在职变动；岗位即“岗位与权限”中的公司岗位。范围按 2026-10-15 决定：不含考勤、请假、薪资、绩效、培训。 */
import React from 'react';
import { Building2, Plus, RefreshCw, UserPlus, Users } from 'lucide-react';
import { Banner, Button, Card, CardHeader, Checkbox, DataTable, Dialog, Drawer, EmptyState, Field, FormGrid, KeyValue, MistPage, PageHeader, Pill, Select, Tabs, TextArea, TextInput, Toolbar, useToast, type Column } from '../../../../../components/mist';
import { useMistSession } from '../../runtime/auth';
import { useNav } from '../../nav';
import { ACTIVE_EMPLOYMENT, attributeLabel, BUSINESS_ATTRIBUTES, CONTRACT_TYPES, departmentOptions, EMPLOYMENT_EVENTS, EMPLOYMENT_STATUS, eventLabel, organizationApi, ACCOUNT_STATUS, type BusinessAttribute, type EmployeeProfile, type EmploymentEvent, type OrgDepartment, type OrgJob, type OrgPerson, type OrgTeam } from '../../runtime/organization';

const message = (e: unknown, fallback: string) => e instanceof Error ? e.message : fallback;
type Directory = { people: OrgPerson[]; departments: OrgDepartment[]; jobs: OrgJob[]; positionNames: Record<string, string>; teams: OrgTeam[]; employees: EmployeeProfile[] };
type Open = { kind: 'dept' | 'team' | 'person'; id: string } | null;
type DeptForm = { kind: 'dept'; id?: string; name: string; attributes: BusinessAttribute[] };
type TeamForm = { kind: 'team'; id?: string; departmentId: string; name: string; description: string };
type ProfileForm = { kind: 'profile'; userId: string; exists: boolean; hireDate: string; regularDate: string; contractType: string; contractEnd: string; phone: string; emergencyContact: string; workLocation: string; notes: string };
type EventForm = { kind: 'event'; userId: string; fromStatus: string; type: string; effectiveDate: string; toDeptId: string; toRoleId: string; reason: string; acknowledged: boolean };
type Form = DeptForm | TeamForm | ProfileForm | EventForm;
type Confirm = { kind: 'retire'; department: OrgDepartment; target: string } | { kind: 'dissolve'; team: OrgTeam } | { kind: 'remove'; team: OrgTeam; person: OrgPerson | { id: string; displayName: string } } | null;

const today = () => businessNow().toLocaleDateString('sv-SE');
const STATUS_TONE: Record<string, 'ok' | 'warn' | 'neutral' | 'bad'> = { Probation: 'warn', Regular: 'ok', Suspended: 'bad', Resigned: 'neutral', Terminated: 'neutral' };

function AttributePills({ values }: { values?: string[] }) {
  return values?.length ? <span className="mist-row" style={{ flexWrap: 'wrap', gap: 4 }}>{values.map(v => <Pill key={v} plain>{attributeLabel(v)}</Pill>)}</span> : <span className="mist-note">{uiText("未设业务属性")}</span>;
}

export function HrOrganizationPage() {
  const session = useMistSession(), { route, go } = useNav(), toast = useToast();
  const canRead = session.hasPermission('hr:read') || session.hasPermission('hr:write'), canWrite = session.hasPermission('hr:write');
  const [data, setData] = React.useState<Directory | null>(null), [loading, setLoading] = React.useState(true), [error, setError] = React.useState('');
  const [open, setOpen] = React.useState<Open>(null), [form, setForm] = React.useState<Form | null>(null), [formError, setFormError] = React.useState('');
  const [confirm, setConfirm] = React.useState<Confirm>(null), [busy, setBusy] = React.useState(false);
  const [operationError, setOperationError] = React.useState('');
  React.useEffect(() => { setOperationError(''); }, [open?.kind, open?.id, confirm?.kind]);
  const [query, setQuery] = React.useState(''), [deptFilter, setDeptFilter] = React.useState('');
  const [profile, setProfile] = React.useState<{ userId: string; value: EmployeeProfile | null; error?: string } | null>(null);
  const [events, setEvents] = React.useState<{ userId: string; rows: EmploymentEvent[] | null; error?: string } | null>(null), [profileTick, setProfileTick] = React.useState(0);
  const [candidates, setCandidates] = React.useState<Array<{ id: string; displayName: string; email: string }> | null>(null), [candidate, setCandidate] = React.useState('');
  const serial = React.useRef(0);
  const load = React.useCallback(async () => {
    const run = ++serial.current; setLoading(true); setError('');
    try {
      const [personnel, teams, employees] = await Promise.all([organizationApi.personnel(), organizationApi.teams(), organizationApi.employees()]);
      if (run === serial.current) setData({ people: personnel.personnel ?? [], departments: personnel.departments ?? [], jobs: personnel.jobs ?? [], positionNames: personnel.positionNames ?? {}, teams: (teams.teams ?? []).filter(t => t.status !== 'dissolved'), employees: employees.employees ?? [] });
    } catch (e) { if (run === serial.current) setError(message(e, '组织架构读取失败')); }
    finally { if (run === serial.current) setLoading(false); }
  }, []);
  React.useEffect(() => { setData(null); setOpen(null); setForm(null); if (!session.localMode && canRead) void load(); else setLoading(false); return () => { serial.current++; }; }, [session.sessionKey, session.localMode, canRead, load]);

  const linkedPerson = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    if (!route.id) { linkedPerson.current = undefined; return; }
    if (route.id !== linkedPerson.current && data?.people.some(person => person.id === route.id)) {
      linkedPerson.current = route.id; setOpen({ kind: 'person', id: route.id });
    }
  }, [route.id, data]);
  const root = data?.departments.find(d => !d.parentId) ?? null;
  const departments = (data?.departments ?? []).filter(d => d.parentId);
  const person = (userId: string) => data?.people.find(p => p.id === userId);
  const activeMembers = (team: OrgTeam) => team.members.filter(m => !m.leftAt);
  const teamOf = (userId: string) => data?.teams.find(t => activeMembers(t).some(m => m.userId === userId)) ?? null;
  const openDept = open?.kind === 'dept' ? departments.find(d => d.id === open.id) ?? null : null;
  const openTeam = open?.kind === 'team' ? data?.teams.find(t => t.id === open.id) ?? null : null;
  const openPerson = open?.kind === 'person' ? person(open.id) ?? null : null;
  const employeeOf = (userId: string) => data?.employees.find(e => e.userId === userId) ?? null;
  const positionTitle = (positionId: string | null) => positionId ? data?.positionNames[positionId] ?? '（已删除岗位）' : '—';
  const canAssignJobs = session.hasPermission('users:admin');
  const deptName = (deptId: string | null) => deptId ? data?.departments.find(d => d.id === deptId)?.name ?? '—' : '—';

  React.useEffect(() => {
    if (!openPerson) return;
    let live = true; setProfile({ userId: openPerson.id, value: null });
    organizationApi.profile(openPerson.id).then(value => { if (live) setProfile({ userId: openPerson.id, value }); }, e => { if (live) setProfile({ userId: openPerson.id, value: null, error: message(e, '档案读取失败') }); });
    setEvents({ userId: openPerson.id, rows: null });
    organizationApi.employmentEvents(openPerson.id).then(r => { if (live) setEvents({ userId: openPerson.id, rows: r.events ?? [] }); }, e => { if (live) setEvents({ userId: openPerson.id, rows: [], error: message(e, '变动记录读取失败') }); });
    return () => { live = false; };
  }, [openPerson?.id, profileTick]);
  React.useEffect(() => {
    setCandidates(null); setCandidate('');
    if (!openTeam || !canWrite) return;
    let live = true;
    organizationApi.memberCandidates(openTeam.id).then(r => { if (live) setCandidates(r.users ?? []); }, () => { if (live) setCandidates([]); });
    return () => { live = false; };
  }, [openTeam?.id, openTeam?.memberCount, canWrite]);

  const run = async (action: () => Promise<unknown>, done: string) => {
    if (busy) return false;
    setBusy(true); setOperationError('');
    try { await action(); toast(done); await load(); return true; }
    catch (e) { setOperationError(message(e, '操作未完成')); return false; }
    finally { setBusy(false); }
  };
  const submit = async () => {
    if (!form || busy) return;
    setFormError('');
    if (form.kind === 'dept' && !form.name.trim()) return setFormError('请填写部门名称');
    if (form.kind === 'dept' && !form.id && !root) return setFormError('没有找到公司根部门，无法新建');
    if (form.kind === 'team' && (!form.name.trim() || !form.departmentId)) return setFormError('请填写小组名称并选择所属部门');
    if (form.kind === 'profile' && !form.exists && !form.hireDate) return setFormError('建档须填写入职日期');
    if (form.kind === 'profile' && !form.exists && form.regularDate && form.regularDate < form.hireDate) return setFormError('转正日期不能早于入职日期');
    if (form.kind === 'event' && (!form.type || !form.effectiveDate)) return setFormError('请选择变动类型并填写生效日期');
    if (form.kind === 'event' && EMPLOYMENT_EVENTS.find(e => e.value === form.type)?.position && (!form.toRoleId || !form.toDeptId)) return setFormError('请选择岗位和任职部门');
    if (form.kind === 'event' && EMPLOYMENT_EVENTS.find(e => e.value === form.type)?.position && form.toRoleId === (person(form.userId)?.roleIds?.[0] ?? '') && form.toDeptId === (person(form.userId)?.departmentId ?? '')) return setFormError('请选择新的岗位或部门');
    if (form.kind === 'event' && (EMPLOYMENT_EVENTS.find(e => e.value === form.type)?.terminal || session.user?.companyId && form.type === 'Suspend') && !form.acknowledged) return setFormError(session.user?.companyId ? '请确认暂停本公司访问。' : '请先勾选确认：办理后该员工的系统账号会立即停用');
    setBusy(true);
    try {
      if (form.kind === 'dept') {
        if (form.id) await organizationApi.updateDepartment(form.id, { name: form.name.trim(), businessAttributes: form.attributes });
        else await organizationApi.createDepartment({ name: form.name.trim(), parentId: root!.id, businessAttributes: form.attributes });
      } else if (form.kind === 'team') {
        if (form.id) await organizationApi.updateTeam(form.id, { name: form.name.trim(), description: form.description.trim() });
        else await organizationApi.createTeam({ name: form.name.trim(), departmentId: form.departmentId, description: form.description.trim() || undefined });
      } else if (form.kind === 'event') {
        const current = employeeOf(form.userId) ?? (profile?.userId === form.userId ? profile.value : null);
        const def = EMPLOYMENT_EVENTS.find(e => e.value === form.type);
        const result = await organizationApi.recordEvent({ userId: form.userId, type: form.type, effectiveDate: form.effectiveDate, reason: form.reason.trim() || null,
          fromDeptId: person(form.userId)?.departmentId ?? null, fromPositionId: person(form.userId)?.roleIds?.[0] ?? current?.positionId ?? null, ...(def?.position ? { toRoleId: form.toRoleId, toDeptId: form.toDeptId } : {}) });
        setForm(null); setProfileTick(t => t + 1);
        toast(result.jobChanged && def?.position ? `已办理${def.label}，新岗位权限已生效` : result.accountDisabled ? (session.user?.companyId ? `已办理${def?.label ?? '变动'}，本公司访问已停用` : `已办理${def?.label ?? '变动'}，系统账号已停用`) : result.leftTeams ? `已办理${def?.label ?? '变动'}，部门已调整并退出原小组` : form.type === 'Onboard' ? '已办理返聘，账号已恢复启用' : `已办理${def?.label ?? '变动'}`);
        await load(); return;
      } else {
        if (!form.exists && !session.user?.companyId) {
          // 新建档案按入职事件写入（留下在职变动记录）；填了转正日期则同时记一次转正。
          await organizationApi.recordEvent({ userId: form.userId, type: 'Onboard', effectiveDate: form.hireDate, fromDeptId: null, reason: '建立员工档案' });
          if (form.regularDate) await organizationApi.recordEvent({ userId: form.userId, type: 'Regularize', effectiveDate: form.regularDate, reason: '建档时已转正' });
        }
        const { profile: saved } = await organizationApi.saveProfile(form.userId, { ...(form.hireDate ? { hireDate: form.hireDate } : {}), ...(!form.exists && form.regularDate ? { regularDate: form.regularDate } : {}), contractType: form.contractType || null, contractEnd: form.contractEnd || null, phone: form.phone || null, emergencyContact: form.emergencyContact || null, workLocation: form.workLocation || null, notes: form.notes || null });
        setProfile({ userId: form.userId, value: saved }); setProfileTick(t => t + 1);
      }
      toast(form.kind === 'profile' ? (form.exists ? '员工档案已保存' : '已建立员工档案') : form.id ? '已保存' : form.kind === 'dept' ? '部门已新建' : '小组已新建');
      setForm(null); await load();
    } catch (e) { setFormError(message(e, '保存未完成')); if (form.kind === 'profile' && !form.exists) { setProfileTick(t => t + 1); void load(); } }
    finally { setBusy(false); }
  };
  const decide = async () => {
    if (!confirm) return;
    const ok = confirm.kind === 'retire' ? await run(() => organizationApi.retireDepartment(confirm.department.id, confirm.target || undefined), '部门已裁撤')
      : confirm.kind === 'dissolve' ? await run(() => organizationApi.dissolveTeam(confirm.team.id), '小组已解散，成员保留在原部门')
      : await run(() => organizationApi.removeMember(confirm.team.id, confirm.person.id), '已移出小组');
    if (ok) { if (confirm.kind !== 'remove') setOpen(null); setConfirm(null); }
  };

  const tab = route.section === 'people' || route.section === 'positions' ? 'people' : 'org';
  const header = <PageHeader title={uiText("人事管理")} actions={!session.localMode && canRead ? <Button icon={RefreshCw} loading={loading} onClick={() => void load()}>{uiText("重新读取")}</Button> : undefined} />;
  if (session.localMode) return <MistPage>{uiText(header)}<Banner tone="neutral" title={uiText("本机演示模式没有组织架构")}>{uiText("部门、小组与员工档案保存在公司服务器账号体系中；连接公司服务器登录后在此维护。")}</Banner></MistPage>;
  if (!canRead) return <MistPage>{uiText(header)}<Banner tone="neutral" title={uiText("当前账号没有人事查看权限")}>{uiText("如需查看组织架构或员工档案，请联系老板或管理员调整岗位权限。")}</Banner></MistPage>;

  const deptColumns: Column<OrgDepartment>[] = [
    { key: 'name', header: '部门', width: 'minmax(160px,1.2fr)', render: d => <b>{d.name}</b>, sortValue: d => d.name },
    { key: 'attributes', header: '业务属性', width: 'minmax(200px,2fr)', render: d => <AttributePills values={d.businessAttributes} /> },
    { key: 'teams', header: '小组', width: '80px', align: 'right', render: d => data?.teams.filter(t => t.departmentId === d.id).length ?? 0 },
    { key: 'people', header: '人员', width: '80px', align: 'right', render: d => data?.people.filter(p => p.departmentId === d.id && p.status === 'active').length ?? 0 },
  ];
  const people = (data?.people ?? []).filter(p => (!deptFilter || p.departmentId === deptFilter) && (!query.trim() || [p.displayName, p.email, p.department ?? '', teamOf(p.id)?.name ?? ''].join(' ').toLowerCase().includes(query.trim().toLowerCase())));
  const personColumns: Column<OrgPerson>[] = [
    { key: 'name', header: '姓名 / 邮箱', width: 'minmax(200px,2fr)', render: p => <><b>{p.displayName}</b><div className="mist-note">{p.email}</div></>, sortValue: p => p.displayName },
    { key: 'department', header: '任职部门', render: p => p.department ?? <span className="mist-note">{uiText("未分配")}</span> },
    { key: 'team', header: '小组', render: p => teamOf(p.id)?.name ?? <span className="mist-note">{uiText("未入组")}</span> },
    { key: 'position', header: '岗位', render: p => p.roles.join('、') || <span className="mist-note">{uiText("未设岗位")}</span>, sortValue: p => p.roles.join() },
    { key: 'employment', header: '在职', width: '90px', render: p => { const e = employeeOf(p.id); return e ? <Pill tone={STATUS_TONE[e.employmentStatus] ?? 'neutral'}>{EMPLOYMENT_STATUS[e.employmentStatus] ?? e.employmentStatus}</Pill> : <span className="mist-note">{uiText("未建档")}</span>; }, sortValue: p => employeeOf(p.id)?.employmentStatus ?? '' },
    { key: 'status', header: '账号', width: '90px', render: p => <Pill tone={ACCOUNT_STATUS[p.status]?.tone ?? 'neutral'}>{ACCOUNT_STATUS[p.status]?.label ?? p.status}</Pill> },
  ];
  const teamsIn = (departmentId: string) => (data?.teams ?? []).filter(t => t.departmentId === departmentId);
  const jobOptions = (data?.jobs ?? []).map(job => ({ value: job.id, label: job.name }));
  const eventChoices = (status: string) => EMPLOYMENT_EVENTS.filter(e => e.from.includes(status));
  const profileForm = (userId: string, p: EmployeeProfile | null): ProfileForm => ({ kind: 'profile', userId, exists: !!p, hireDate: p?.hireDate ?? '', regularDate: p?.regularDate ?? '', contractType: p?.contractType ?? '', contractEnd: p?.contractEnd ?? '', phone: p?.phone ?? '', emergencyContact: p?.emergencyContact ?? '', workLocation: p?.workLocation ?? '', notes: p?.notes ?? '' });

  return <MistPage>{uiText(header)}
    {error && <Banner tone="bad" title={uiText("组织架构读取失败")} actions={<Button size="sm" icon={RefreshCw} onClick={() => void load()}>{uiText("重试")}</Button>}>{uiText(error)}</Banner>}
    <Tabs<'org' | 'people'> value={tab} onChange={next => { setOpen(null); go('hr', undefined, { section: next }); }} options={[{ value: 'org', label: '组织架构', icon: Building2, count: departments.length }, { value: 'people', label: '全部人员', icon: Users, count: data?.people.length }]} />
    <section className="mist-section">{tab === 'org' ? <>
      <Toolbar right={canWrite ? <Button variant="primary" icon={Plus} disabled={!data} onClick={() => { setFormError(''); setForm({ kind: 'dept', name: '', attributes: [] }); }}>{uiText("新建部门")}</Button> : undefined}>
        <span />
      </Toolbar>
      <Card><DataTable ariaLabel={uiText("部门")} rows={departments} rowKey={d => d.id} loading={loading && !data} selectedKey={openDept?.id ?? null} onRowClick={d => setOpen({ kind: 'dept', id: d.id })} columns={deptColumns}
        empty={<EmptyState title={uiText("还没有部门")} description={uiText(canWrite ? '用“新建部门”建立第一个部门。' : '请联系人事或管理员建立部门。')} />} /></Card>

    </> : <>
      <Toolbar right={session.hasPermission('users:admin') ? <Button onClick={() => go('admin-panel', undefined, { section: 'accounts' })}>{uiText("账号管理")}</Button> : undefined}>
        <Field label={uiText("搜索")}><TextInput aria-label={uiText("搜索人员")} placeholder={uiText("姓名、邮箱、部门或小组")} value={query} onChange={e => setQuery(e.target.value)} /></Field>
        <Field label={uiText("部门")}><Select aria-label={uiText("部门筛选")} value={deptFilter} onChange={e => setDeptFilter(e.target.value)} options={[{ value: '', label: '全部部门' }, ...departmentOptions(data?.departments ?? [])]} /></Field>
      </Toolbar>
      <Card><DataTable ariaLabel={uiText("全部人员")} rows={people} rowKey={p => p.id} loading={loading && !data} selectedKey={openPerson?.id ?? null} onRowClick={p => setOpen({ kind: 'person', id: p.id })} columns={personColumns}
        empty={<EmptyState title={uiText(data?.people.length ? '没有符合条件的人员' : '还没有公司人员')} description={uiText(data?.people.length ? '调整搜索或部门后再看。' : '在管理后台新建账号后会出现在这里。')} />} /></Card>
    </>}</section>

    <Drawer open={!!openDept && !form} onClose={() => setOpen(null)} title={uiText(openDept?.name ?? '')} sub={uiText("部门")}
      footer={openDept && canWrite && <div className="mist-row">
        <Button variant="primary" icon={Plus} onClick={() => { setFormError(''); setForm({ kind: 'team', departmentId: openDept.id, name: '', description: '' }); }}>{uiText("新建小组")}</Button>
        <Button onClick={() => { setFormError(''); setForm({ kind: 'dept', id: openDept.id, name: openDept.name, attributes: [...(openDept.businessAttributes ?? [])] }); }}>{uiText("修改部门")}</Button>
        <Button onClick={() => setConfirm({ kind: 'retire', department: openDept, target: '' })}>{uiText("裁撤部门")}</Button>
      </div>}>
      {openDept && <>
        {operationError && <Banner tone="bad" title={uiText("操作未完成")}>{uiText(operationError)}</Banner>}
        <KeyValue items={[{ label: '业务属性', value: <AttributePills values={openDept.businessAttributes} /> }, { label: '启用人员', value: data?.people.filter(p => p.departmentId === openDept.id && p.status === 'active').length ?? 0 }]} />
        <CardHeader title={uiText("小组")} sub={ui`${teamsIn(openDept.id).length} 个`} />
        {teamsIn(openDept.id).length ? <DataTable ariaLabel={uiText("部门小组")} rows={teamsIn(openDept.id)} rowKey={t => t.id} onRowClick={t => setOpen({ kind: 'team', id: t.id })} columns={[
          { key: 'name', header: '小组', render: t => <><b>{t.name}</b>{t.description && <div className="mist-note">{t.description}</div>}</> },
          { key: 'members', header: '成员', width: '72px', align: 'right', render: t => t.memberCount },
        ]} /> : <EmptyState compact title={uiText("还没有小组")} />}
        <CardHeader title={uiText("人员")} />
        {(data?.people ?? []).filter(p => p.departmentId === openDept.id).map(p => <p key={p.id} className="mist-row"><Button variant="quiet" size="sm" onClick={() => setOpen({ kind: 'person', id: p.id })}>{p.displayName}</Button><span className="mist-note">{teamOf(p.id)?.name ?? '未入组'}{uiText(p.status !== 'active' ? ' · ' + (ACCOUNT_STATUS[p.status]?.label ?? p.status) : '')}</span></p>)}
      </>}
    </Drawer>

    <Drawer open={!!openTeam && !form} onClose={() => setOpen(null)} title={uiText(openTeam?.name ?? '')} sub={uiText(openTeam ? `小组 · ${openTeam.department ?? ''}` : undefined)}
      footer={openTeam && canWrite && <div className="mist-row">
        <Button onClick={() => { setFormError(''); setForm({ kind: 'team', id: openTeam.id, departmentId: openTeam.departmentId, name: openTeam.name, description: openTeam.description ?? '' }); }}>{uiText("修改小组")}</Button>
        <Button onClick={() => setConfirm({ kind: 'dissolve', team: openTeam })}>{uiText("解散小组")}</Button>
        <Button variant="quiet" onClick={() => setOpen({ kind: 'dept', id: openTeam.departmentId })}>{uiText("返回部门")}</Button>
      </div>}>
      {openTeam && <>
        {operationError && <Banner tone="bad" title={uiText("操作未完成")}>{uiText(operationError)}</Banner>}
        <KeyValue items={[{ label: '所属部门', value: openTeam.department ?? '—' }, { label: '业务属性', value: <AttributePills values={openTeam.businessAttributes} /> }, { label: '说明', value: openTeam.description || '—' }]} />
        <CardHeader title={uiText("成员")} sub={ui`${openTeam.memberCount} 人`} />
        {activeMembers(openTeam).length ? activeMembers(openTeam).map(m => { const p = person(m.userId); return <p key={m.id} className="mist-row"><b>{p?.displayName ?? m.userId}</b><span className="mist-note">{p?.email}</span>{canWrite && <Button size="sm" variant="quiet" disabled={busy} onClick={() => setConfirm({ kind: 'remove', team: openTeam, person: p ?? { id: m.userId, displayName: m.userId } })}>{uiText("移出")}</Button>}</p>; }) : <EmptyState compact title={uiText("还没有成员")} />}
        {canWrite && <div className="mist-section"><Field label={uiText("加入成员")}>
          <div className="mist-row"><Select aria-label={uiText("选择成员")} value={candidate} disabled={busy || !candidates?.length} placeholder={uiText(candidates === null ? '读取中' : candidates.length ? '选择人员' : '没有可加入的人员')} onChange={e => setCandidate(e.target.value)} options={(candidates ?? []).map(c => ({ value: c.id, label: `${c.displayName}（${c.email}）` }))} />
            <Button icon={UserPlus} disabled={!candidate || busy} onClick={() => void run(() => organizationApi.addMember(openTeam.id, candidate), '已加入小组')}>{uiText("加入")}</Button></div>
        </Field></div>}
      </>}
    </Drawer>


    <Drawer open={!!openPerson && !form} onClose={() => setOpen(null)} title={uiText(openPerson?.displayName ?? '')} sub={uiText(openPerson?.email)}
      footer={openPerson && canWrite && profile?.userId === openPerson.id && !profile.error && <div className="mist-row">
        {(!profile.value || ACTIVE_EMPLOYMENT.includes(profile.value.employmentStatus)) && <Button variant="primary" onClick={() => { setFormError(''); setForm(profileForm(openPerson.id, profile.value)); }}>{uiText(profile.value ? '修改员工档案' : '建立员工档案')}</Button>}
        {profile.value && eventChoices(profile.value.employmentStatus).length > 0 && <Button variant={ACTIVE_EMPLOYMENT.includes(profile.value.employmentStatus) ? 'secondary' : 'primary'} onClick={() => { const first = eventChoices(profile.value!.employmentStatus)[0]; setFormError(''); setForm({ kind: 'event', userId: openPerson.id, fromStatus: profile.value!.employmentStatus, type: first.value, effectiveDate: today(), toDeptId: openPerson.departmentId ?? '', toRoleId: openPerson.roleIds?.[0] ?? '', reason: '', acknowledged: false }); }}>{uiText("办理在职变动")}</Button>}
      </div>}>
      {openPerson && <>
        {operationError && <Banner tone="bad" title={uiText("操作未完成")}>{uiText(operationError)}</Banner>}
        {session.hasPermission('users:admin') && <Button size="sm" onClick={() => go('admin-panel', openPerson.id, { section: 'accounts' })}>{uiText("账号与权限")}</Button>}
        <KeyValue items={[{ label: '任职部门', value: openPerson.department ?? '未分配' }, { label: '小组', value: teamOf(openPerson.id)?.name ?? '未入组' }, { label: '岗位', value: openPerson.roles.join('、') || '未设岗位' }, { label: '账号状态', value: ACCOUNT_STATUS[openPerson.status]?.label ?? openPerson.status }]} />
        <CardHeader title={uiText("员工档案")} sub={uiText(profile?.value ? profile.value.employeeNo : undefined)} />
        {profile?.userId !== openPerson.id ? null : profile.error ? <Banner tone="bad" title={uiText("档案读取失败")}>{profile.error}</Banner> : profile.value ? <KeyValue items={[
          { label: '在职状态', value: EMPLOYMENT_STATUS[profile.value.employmentStatus] ?? profile.value.employmentStatus },
          { label: '入职日期', value: profile.value.hireDate ?? '—' }, { label: '转正日期', value: profile.value.regularDate ?? '—' },
          { label: '合同类型', value: CONTRACT_TYPES.find(c => c.value === profile.value!.contractType)?.label ?? '—' }, { label: '合同到期', value: profile.value.contractEnd ?? '—' },
          { label: '联系电话', value: profile.value.phone ?? '—' }, { label: '紧急联系人', value: profile.value.emergencyContact ?? '—' },
          { label: '工作地点', value: profile.value.workLocation ?? '—' }, { label: '备注', value: profile.value.notes ?? '—' },
        ]} /> : <EmptyState compact title={uiText("尚未建立员工档案")} />}
        {profile?.userId === openPerson.id && profile.value && <>
          <CardHeader title={uiText("在职变动记录")} sub={uiText(events?.userId === openPerson.id && events.rows ? `${events.rows.length} 条` : undefined)} />
          {events?.userId !== openPerson.id || !events.rows ? <p className="mist-note">{uiText("读取中…")}</p> : events.error ? <Banner tone="bad" title={uiText("变动记录读取失败")}>{events.error}</Banner> : events.rows.length ? <DataTable ariaLabel={uiText("在职变动记录")} rows={events.rows} rowKey={e => e.id} columns={[
            { key: 'date', header: '生效日期', width: '110px', render: e => e.effectiveDate },
            { key: 'type', header: '变动', width: '110px', render: e => <b>{eventLabel(e.type, e.fromStatus)}</b> },
            { key: 'detail', header: '说明', render: e => <>{(e.type === 'Transfer' || e.type === 'Promote') && <div>{positionTitle(e.fromPositionId)} → {positionTitle(e.toPositionId)}</div>}{e.toDeptId && e.toDeptId !== e.fromDeptId && <div>{uiText("部门：")}{deptName(e.fromDeptId)} → {deptName(e.toDeptId)}</div>}{e.reason && <div className="mist-note">{e.reason}</div>}</> },
            { key: 'by', header: '办理人', width: '110px', render: e => e.operatorId ? person(e.operatorId)?.displayName ?? '—' : '—' },
          ]} /> : <EmptyState compact title={uiText("还没有变动记录")} />}
        </>}

      </>}
    </Drawer>

    <Drawer open={!!form} onClose={() => !busy && setForm(null)} title={uiText(form?.kind === 'dept' ? (form.id ? '修改部门' : '新建部门') : form?.kind === 'team' ? (form.id ? '修改小组' : '新建小组') : form?.kind === 'event' ? '办理在职变动' : form?.exists ? '修改员工档案' : '建立员工档案')}
      sub={uiText(form?.kind === 'profile' || form?.kind === 'event' ? person(form.userId)?.displayName : undefined)}
      footer={<div className="mist-row"><Button variant="primary" loading={busy} onClick={() => void submit()}>{uiText(form?.kind === 'event' ? `确认${EMPLOYMENT_EVENTS.find(e => e.value === form.type)?.label ?? '办理'}` : '保存')}</Button><Button disabled={busy} onClick={() => setForm(null)}>{uiText("取消")}</Button></div>}>
      {form && <>
        {formError && <Banner tone="bad" title={uiText("未保存")}>{formError}</Banner>}
        {form.kind === 'dept' ? <FormGrid>
          <Field label={uiText("部门名称")} required full><TextInput value={form.name} disabled={busy} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={uiText("业务属性")} full hint={uiText("影响本部门全部成员")}><div className="mist-col">{BUSINESS_ATTRIBUTES.map(a => <Checkbox key={a.value} label={uiText(a.label)} checked={form.attributes.includes(a.value)} disabled={busy} onChange={on => setForm({ ...form, attributes: on ? [...form.attributes, a.value] : form.attributes.filter(v => v !== a.value) })} />)}</div></Field>
        </FormGrid> : form.kind === 'team' ? <FormGrid>
          <Field label={uiText("小组名称")} required><TextInput value={form.name} disabled={busy} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={uiText("所属部门")} required hint={uiText(form.id ? '小组成员须与部门一致，建立后不在此改部门。' : undefined)}><Select aria-label={uiText("所属部门")} value={form.departmentId} disabled={busy || !!form.id} placeholder={uiText("选择部门")} onChange={e => setForm({ ...form, departmentId: e.target.value })} options={departmentOptions(data?.departments ?? [])} /></Field>
          <Field label={uiText("说明")} full><TextArea value={form.description} disabled={busy} onChange={e => setForm({ ...form, description: e.target.value })} /></Field>
        </FormGrid> : form.kind === 'event' ? (() => { const def = EMPLOYMENT_EVENTS.find(e => e.value === form.type); const current = employeeOf(form.userId); const stopsAccess = def?.terminal || session.user?.companyId && form.type === 'Suspend'; return <FormGrid>
          <Field label={uiText("当前状态")}><span>{EMPLOYMENT_STATUS[form.fromStatus] ?? form.fromStatus}{uiText(person(form.userId)?.roles.length ? ` · ${person(form.userId)!.roles.join('、')}` : '')}</span></Field>
          <Field label={uiText("变动类型")} required><Select aria-label={uiText("变动类型")} value={form.type} disabled={busy} onChange={e => setForm({ ...form, type: e.target.value, acknowledged: false })} options={eventChoices(form.fromStatus).map(e => ({ value: e.value, label: e.label }))} /></Field>
          <Field label={uiText("生效日期")} required><TextInput type="date" value={form.effectiveDate} disabled={busy} onChange={e => setForm({ ...form, effectiveDate: e.target.value })} /></Field>
          {def?.position && <Field label={uiText("岗位")} required hint={canAssignJobs ? undefined : uiText("调整岗位需要账号与岗位管理权限")}><Select aria-label={uiText("新岗位")} value={form.toRoleId} disabled={busy || !canAssignJobs} placeholder={uiText("选择岗位")} onChange={e => setForm({ ...form, toRoleId: e.target.value })} options={jobOptions} /></Field>}
          {def?.position && <Field label={uiText("任职部门")} required><Select aria-label={uiText("调入部门")} value={form.toDeptId} disabled={busy} placeholder={uiText("选择部门")} onChange={e => setForm({ ...form, toDeptId: e.target.value })} options={departmentOptions(data?.departments ?? [])} /></Field>}
          <Field label={uiText("原因 / 说明")} full><TextArea value={form.reason} disabled={busy} onChange={e => setForm({ ...form, reason: e.target.value })} /></Field>
          {def?.position && form.toDeptId && form.toDeptId !== (person(form.userId)?.departmentId ?? '') && <div style={{ gridColumn: '1 / -1' }}><Banner tone="warn" title={ui`部门将从 ${deptName(person(form.userId)?.departmentId ?? null)} 调为 ${deptName(form.toDeptId)}`}>{uiText("同时退出原部门的小组。")}</Banner></div>}
          {stopsAccess && <div style={{ gridColumn: '1 / -1' }}><Banner tone="bad" title={uiText(session.user?.companyId ? "办理后暂停本公司访问" : "办理后系统账号立即停用")}>{uiText("请先完成业务交接。")}</Banner>
            <Checkbox label={uiText(session.user?.companyId ? "我已确认，暂停此人在本公司的访问" : "我已确认，办理后立即停用该员工的系统账号")} checked={form.acknowledged} disabled={busy} onChange={on => setForm({ ...form, acknowledged: on })} /></div>}
          {form.type === 'Onboard' && <div style={{ gridColumn: '1 / -1' }}><Banner tone="warn" title={uiText(session.user?.companyId ? "返聘将恢复本公司访问" : "返聘会恢复系统账号")}>{uiText("原有岗位保留。")}</Banner></div>}
        </FormGrid>; })() : <FormGrid>
          <Field label={uiText("入职日期")} required={!form.exists}><TextInput type="date" value={form.hireDate} disabled={busy} onChange={e => setForm({ ...form, hireDate: e.target.value })} /></Field>
          {form.exists ? <Field label={uiText("转正日期")} hint={uiText("转正请用“办理在职变动 · 转正”，会同时更新在职状态。")}><span>{form.regularDate || '—'}</span></Field>
            : <Field label={uiText("转正日期")}><TextInput type="date" value={form.regularDate} disabled={busy} onChange={e => setForm({ ...form, regularDate: e.target.value })} /></Field>}
          <Field label={uiText("合同类型")}><Select aria-label={uiText("合同类型")} value={form.contractType} disabled={busy} onChange={e => setForm({ ...form, contractType: e.target.value })} options={[{ value: '', label: '未填写' }, ...CONTRACT_TYPES]} /></Field>
          <Field label={uiText("合同到期")}><TextInput type="date" value={form.contractEnd} disabled={busy} onChange={e => setForm({ ...form, contractEnd: e.target.value })} /></Field>
          <Field label={uiText("联系电话")}><TextInput value={form.phone} disabled={busy} onChange={e => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label={uiText("紧急联系人")}><TextInput value={form.emergencyContact} disabled={busy} onChange={e => setForm({ ...form, emergencyContact: e.target.value })} /></Field>
          <Field label={uiText("工作地点")}><TextInput value={form.workLocation} disabled={busy} onChange={e => setForm({ ...form, workLocation: e.target.value })} /></Field>
          <Field label={uiText("备注")} full><TextArea value={form.notes} disabled={busy} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
        </FormGrid>}
      </>}
    </Drawer>

    <Dialog open={!!confirm} onClose={() => !busy && setConfirm(null)} tone="bad"
      title={uiText(confirm?.kind === 'retire' ? `裁撤「${confirm.department.name}」` : confirm?.kind === 'dissolve' ? `解散「${confirm.team.name}」` : confirm ? `把 ${confirm.person.displayName} 移出小组` : '')}
      description={uiText(confirm?.kind === 'retire' ? '有关联记录时请选择承接部门。' : confirm?.kind === 'dissolve' ? '成员退出，撤销小组共享。' : confirm ? '保留部门归属。' : undefined)}
      footer={<div className="mist-row"><Button variant="primary" loading={busy} onClick={() => void decide()}>{uiText("确认")}</Button><Button disabled={busy} onClick={() => setConfirm(null)}>{uiText("取消")}</Button></div>}>
      {operationError && <Banner tone="bad" title={uiText("操作未完成")}>{uiText(operationError)}</Banner>}
      {confirm?.kind === 'retire' && <Field label={uiText("承接部门")}><Select aria-label={uiText("承接部门")} value={confirm.target} onChange={e => setConfirm({ ...confirm, target: e.target.value })} options={[{ value: '', label: '不转入（仅限空部门）' }, ...departmentOptions(data?.departments ?? []).filter(o => o.value !== confirm.department.id)]} /></Field>}
    </Dialog>
  </MistPage>;
}
