import { uiText, ui } from '../../../../../services/interfaceLanguage';
/** 人事管理：组织架构（部门 / 小组）与人员名册；员工档案与在职变动见 EmployeeFile。账号与岗位权限在“公司管理”，岗位即其中的公司岗位。范围按 2026-10-15 决定：不含考勤、请假、薪资、绩效、培训。 */
import React from 'react';
import { Building2, Plus, RefreshCw, UserPlus, Users } from 'lucide-react';
import { Banner, Button, Card, CardHeader, Checkbox, DataTable, Dialog, Drawer, EmptyState, Field, FormGrid, KeyValue, MistPage, PageHeader, Pill, Select, Tabs, TextArea, TextInput, Toolbar, useToast, type Column } from '../../../../../components/mist';
import { EmployeeFile } from './EmployeeFile';
import { useMistSession } from '../../runtime/auth';
import { useMistWorkspace } from '../../runtime/workspace';
import { useNav } from '../../nav';
import { attributeLabel, BUSINESS_ATTRIBUTES, departmentOptions, EMPLOYMENT_STATUS, organizationApi, ACCOUNT_STATUS, type BusinessAttribute, type EmployeeProfile, type OrgDepartment, type OrgJob, type OrgPerson, type OrgTeam } from '../../runtime/organization';

const message = (e: unknown, fallback: string) => e instanceof Error ? e.message : fallback;
type Directory = { people: OrgPerson[]; departments: OrgDepartment[]; jobs: OrgJob[]; positionNames: Record<string, string>; teams: OrgTeam[]; employees: EmployeeProfile[] };
type Open = { kind: 'dept' | 'team' | 'person'; id: string } | null;
type DeptForm = { kind: 'dept'; id?: string; name: string; attributes: BusinessAttribute[] };
type TeamForm = { kind: 'team'; id?: string; departmentId: string; name: string; description: string };
type Form = DeptForm | TeamForm;
type Confirm = { kind: 'retire'; department: OrgDepartment; target: string } | { kind: 'dissolve'; team: OrgTeam } | { kind: 'remove'; team: OrgTeam; person: OrgPerson | { id: string; displayName: string } } | null;

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'neutral' | 'bad'> = { Probation: 'warn', Regular: 'ok', Suspended: 'bad', Resigned: 'neutral', Terminated: 'neutral' };

function AttributePills({ values }: { values?: string[] }) {
  return values?.length ? <span className="mist-row" style={{ flexWrap: 'wrap', gap: 4 }}>{values.map(v => <Pill key={v} plain>{attributeLabel(v)}</Pill>)}</span> : <span className="mist-note">{uiText("未设业务属性")}</span>;
}

export function HrOrganizationPage() {
  const session = useMistSession(), { route, go } = useNav();
  const tab = route.section === 'teams' ? 'org' : route.section === 'people' || route.section === 'positions' || route.id ? 'people' : 'org';
  return <MistPage><PageHeader title={uiText("人事管理")} />
    {!session.localMode && <Tabs<'org' | 'people'> value={tab} onChange={next => go('hr', undefined, { section: next })} options={[{ value: 'org', label: '组织架构', icon: Building2 }, { value: 'people', label: '人员', icon: Users }]} />}
    <section className="mist-section"><HrOrganization part={tab} /></section>
  </MistPage>;
}

export function HrOrganization({ part }: { part: 'org' | 'people' }) {
  const session = useMistSession(), workspace = useMistWorkspace(), { route, go } = useNav(), toast = useToast();
  const canRead = session.hasPermission('hr:read') || session.hasPermission('hr:write'), canWrite = session.hasPermission('hr:write');
  const [data, setData] = React.useState<Directory | null>(null), [loading, setLoading] = React.useState(true), [error, setError] = React.useState('');
  const [open, setOpen] = React.useState<Open>(null), [form, setForm] = React.useState<Form | null>(null), [formError, setFormError] = React.useState('');
  const [confirm, setConfirm] = React.useState<Confirm>(null), [busy, setBusy] = React.useState(false);
  const [operationError, setOperationError] = React.useState('');
  React.useEffect(() => { setOperationError(''); }, [open?.kind, open?.id, confirm?.kind]);
  const [query, setQuery] = React.useState(''), [deptFilter, setDeptFilter] = React.useState('');
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
    if (route.section === 'teams') { linkedPerson.current = undefined; return; }
    if (!route.id) { linkedPerson.current = undefined; return; }
    if (route.id !== linkedPerson.current && data?.people.some(person => person.id === route.id)) {
      linkedPerson.current = route.id; setOpen({ kind: 'person', id: route.id });
    }
  }, [route.id, route.section, data]);
  const linkedTeam = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    if (route.section !== 'teams' || !route.id) { linkedTeam.current = undefined; return; }
    if (route.id !== linkedTeam.current && data?.teams.some(team => team.id === route.id)) {
      linkedTeam.current = route.id; setOpen({ kind: 'team', id: route.id });
    }
  }, [route.id, route.section, data]);
  const root = data?.departments.find(d => !d.parentId) ?? null;
  const departments = (data?.departments ?? []).filter(d => d.parentId);
  const person = (userId: string) => data?.people.find(p => p.id === userId);
  const activeMembers = (team: OrgTeam) => team.members.filter(m => !m.leftAt);
  const teamOf = (userId: string) => data?.teams.find(t => activeMembers(t).some(m => m.userId === userId)) ?? null;
  const openDept = open?.kind === 'dept' ? departments.find(d => d.id === open.id) ?? null : null;
  const openTeam = open?.kind === 'team' ? data?.teams.find(t => t.id === open.id) ?? null : null;
  const teamScope = workspace.state?.teamScopes?.find(scope => scope.teamId === openTeam?.id);
  const scopeConditions = (teamScope?.conditions ?? []).map(condition => [
    condition.customerId ? workspace.state?.customers.find(customer => customer.id === condition.customerId)?.name ?? uiText('指定客户') : '',
    condition.line === 'fabric' ? uiText('面料') : condition.line === 'garment' ? uiText('成衣') : '',
    condition.season ?? '',
    condition.supplierId ? workspace.state?.market?.suppliers.find(supplier => supplier.id === condition.supplierId)?.name ?? uiText('指定供应商/工厂') : '',
  ].filter(Boolean).join(' · '));
  const openPerson = open?.kind === 'person' ? person(open.id) ?? null : null;
  const employeeOf = (userId: string) => data?.employees.find(e => e.userId === userId) ?? null;

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
    setBusy(true);
    try {
      if (form.kind === 'dept') {
        if (form.id) await organizationApi.updateDepartment(form.id, { name: form.name.trim(), businessAttributes: form.attributes });
        else await organizationApi.createDepartment({ name: form.name.trim(), parentId: root!.id, businessAttributes: form.attributes });
      } else if (form.kind === 'team') {
        if (form.id) await organizationApi.updateTeam(form.id, { name: form.name.trim(), description: form.description.trim() });
        else await organizationApi.createTeam({ name: form.name.trim(), departmentId: form.departmentId, description: form.description.trim() || undefined });
      }
      toast(form.id ? '已保存' : form.kind === 'dept' ? '部门已新建' : '小组已新建');
      setForm(null); await load();
    } catch (e) { setFormError(message(e, '保存未完成')); }
    finally { setBusy(false); }
  };
  const decide = async () => {
    if (!confirm) return;
    const ok = confirm.kind === 'retire' ? await run(() => organizationApi.retireDepartment(confirm.department.id, confirm.target || undefined), '部门已裁撤')
      : confirm.kind === 'dissolve' ? await run(() => organizationApi.dissolveTeam(confirm.team.id), '小组已解散，成员保留在原部门')
      : await run(() => organizationApi.removeMember(confirm.team.id, confirm.person.id), '已移出小组');
    if (ok) { if (confirm.kind !== 'remove') setOpen(null); setConfirm(null); }
  };

  if (session.localMode) return <Banner tone="neutral" title={uiText("本机演示模式没有组织架构")}>{uiText("部门、小组与员工档案保存在公司服务器账号体系中；连接公司服务器登录后在此维护。")}</Banner>;
  if (!canRead) return <Banner tone="neutral" title={uiText("当前账号没有人事查看权限")} />;
  const refresh = <Button icon={RefreshCw} loading={loading} onClick={() => void load()}>{uiText("重新读取")}</Button>;

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
  return <>
    {error && <Banner tone="bad" title={uiText("组织架构读取失败")} actions={<Button size="sm" icon={RefreshCw} onClick={() => void load()}>{uiText("重试")}</Button>}>{uiText(error)}</Banner>}
    <section className="mist-section">{part === 'org' ? <>
      <Toolbar right={<>{refresh}{canWrite && <Button variant="primary" icon={Plus} disabled={!data} onClick={() => { setFormError(''); setForm({ kind: 'dept', name: '', attributes: [] }); }}>{uiText("新建部门")}</Button>}</>}>
        <span />
      </Toolbar>
      <Card><DataTable ariaLabel={uiText("部门")} rows={departments} rowKey={d => d.id} loading={loading && !data} selectedKey={openDept?.id ?? null} onRowClick={d => setOpen({ kind: 'dept', id: d.id })} columns={deptColumns}
        empty={<EmptyState title={uiText("还没有部门")} description={uiText(canWrite ? '用“新建部门”建立第一个部门。' : '请联系人事或管理员建立部门。')} />} /></Card>

    </> : <>
      <Toolbar right={refresh}>
        <Field label={uiText("搜索")}><TextInput aria-label={uiText("搜索人员")} placeholder={uiText("姓名、邮箱、部门或小组")} value={query} onChange={e => setQuery(e.target.value)} /></Field>
        <Field label={uiText("部门")}><Select aria-label={uiText("部门筛选")} value={deptFilter} onChange={e => setDeptFilter(e.target.value)} options={[{ value: '', label: '全部部门' }, ...departmentOptions(data?.departments ?? [])]} /></Field>
      </Toolbar>
      <Card><DataTable ariaLabel={uiText("全部人员")} rows={people} rowKey={p => p.id} loading={loading && !data} selectedKey={openPerson?.id ?? null} onRowClick={p => setOpen({ kind: 'person', id: p.id })} columns={personColumns}
        empty={<EmptyState title={uiText(data?.people.length ? '没有符合条件的人员' : '还没有公司人员')} description={uiText(data?.people.length ? '调整搜索或部门后再看。' : undefined)} />} /></Card>
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
        {canWrite && workspace.workspace?.access?.companyLibrary && <>
          <CardHeader title={uiText('业务范围')} tools={<Button size="sm" variant="quiet" onClick={() => go('company-settings', openTeam.id, { section: 'teams' })}>{uiText('配置业务范围')}</Button>} />
          {teamScope ? <KeyValue items={[
            { label: '范围条件', value: scopeConditions.length ? <div className="mist-col">{scopeConditions.map((label, index) => <span key={index}>{label}</span>)}</div> : '无' },
            { label: '手选业务', value: ui`${teamScope.picks.length} 笔` }, { label: '排除业务', value: ui`${teamScope.exclusions.length} 笔` },
          ]} /> : <p className="mist-note">{uiText('未设置范围')}</p>}
        </>}
        <CardHeader title={uiText("成员")} sub={ui`${openTeam.memberCount} 人`} />
        {activeMembers(openTeam).length ? activeMembers(openTeam).map(m => { const p = person(m.userId); return <p key={m.id} className="mist-row"><b>{p?.displayName ?? m.userId}</b><span className="mist-note">{p?.email}</span>{canWrite && <Button size="sm" variant="quiet" disabled={busy} onClick={() => setConfirm({ kind: 'remove', team: openTeam, person: p ?? { id: m.userId, displayName: m.userId } })}>{uiText("移出")}</Button>}</p>; }) : <EmptyState compact title={uiText("还没有成员")} />}
        {canWrite && <div className="mist-section"><Field label={uiText("加入成员")}>
          <div className="mist-row"><Select aria-label={uiText("选择成员")} value={candidate} disabled={busy || !candidates?.length} placeholder={uiText(candidates === null ? '读取中' : candidates.length ? '选择人员' : '没有可加入的人员')} onChange={e => setCandidate(e.target.value)} options={(candidates ?? []).map(c => ({ value: c.id, label: `${c.displayName}（${c.email}）` }))} />
            <Button icon={UserPlus} disabled={!candidate || busy} onClick={() => void run(() => organizationApi.addMember(openTeam.id, candidate), '已加入小组')}>{uiText("加入")}</Button></div>
        </Field></div>}
      </>}
    </Drawer>


    <Drawer open={!!openPerson && !form} onClose={() => setOpen(null)} title={uiText(openPerson?.displayName ?? '')} sub={uiText(openPerson?.email)}>
      {openPerson && <>
        {operationError && <Banner tone="bad" title={uiText("操作未完成")}>{uiText(operationError)}</Banner>}
        {session.hasPermission('users:admin') && <Button size="sm" onClick={() => go('company-settings', openPerson.id, { section: 'accounts' })}>{uiText("账号与岗位")}</Button>}
        <KeyValue items={[{ label: '任职部门', value: openPerson.department ?? '未分配' }, { label: '小组', value: teamOf(openPerson.id)?.name ?? '未入组' }, { label: '岗位', value: openPerson.roles.join('、') || '未设岗位' }, { label: '账号状态', value: ACCOUNT_STATUS[openPerson.status]?.label ?? openPerson.status }]} />
        <EmployeeFile person={openPerson} departments={data?.departments ?? []} jobs={data?.jobs ?? []} positionNames={data?.positionNames ?? {}} nameOf={id => person(id)?.displayName} onChanged={load} />
      </>}
    </Drawer>

    <Drawer open={!!form} onClose={() => !busy && setForm(null)} title={uiText(form?.kind === 'dept' ? (form.id ? '修改部门' : '新建部门') : form?.id ? '修改小组' : '新建小组')}
      footer={<div className="mist-row"><Button variant="primary" loading={busy} onClick={() => void submit()}>{uiText('保存')}</Button><Button disabled={busy} onClick={() => setForm(null)}>{uiText("取消")}</Button></div>}>
      {form && <>
        {formError && <Banner tone="bad" title={uiText("未保存")}>{formError}</Banner>}
        {form.kind === 'dept' ? <FormGrid>
          <Field label={uiText("部门名称")} required full><TextInput value={form.name} disabled={busy} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={uiText("业务属性")} full hint={uiText("影响本部门全部成员")}><div className="mist-col">{BUSINESS_ATTRIBUTES.map(a => <Checkbox key={a.value} label={uiText(a.label)} checked={form.attributes.includes(a.value)} disabled={busy} onChange={on => setForm({ ...form, attributes: on ? [...form.attributes, a.value] : form.attributes.filter(v => v !== a.value) })} />)}</div></Field>
        </FormGrid> : <FormGrid>
          <Field label={uiText("小组名称")} required><TextInput value={form.name} disabled={busy} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={uiText("所属部门")} required hint={uiText(form.id ? '小组成员须与部门一致，建立后不在此改部门。' : undefined)}><Select aria-label={uiText("所属部门")} value={form.departmentId} disabled={busy || !!form.id} placeholder={uiText("选择部门")} onChange={e => setForm({ ...form, departmentId: e.target.value })} options={departmentOptions(data?.departments ?? [])} /></Field>
          <Field label={uiText("说明")} full><TextArea value={form.description} disabled={busy} onChange={e => setForm({ ...form, description: e.target.value })} /></Field>
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
  </>;
}
