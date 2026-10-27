import { uiText, ui } from '../../../../../services/interfaceLanguage';
import {businessNow} from '../../runtime/businessClock';
/** 员工档案与在职变动：人员详情里的人事部分，账号与人事两处共用同一份。 */
import React from 'react';
import { Banner, Button, CardHeader, Checkbox, DataTable, Drawer, EmptyState, Field, FormGrid, KeyValue, Select, TextArea, TextInput, useToast } from '../../../../../components/mist';
import { useMistSession } from '../../runtime/auth';
import { ACTIVE_EMPLOYMENT, CONTRACT_TYPES, departmentOptions, EMPLOYMENT_EVENTS, EMPLOYMENT_STATUS, eventLabel, organizationApi, type EmployeeProfile, type EmploymentEvent, type OrgDepartment, type OrgJob } from '../../runtime/organization';

export type EmployeePerson = { id: string; displayName: string; departmentId: string | null; roleIds?: string[]; roles: string[] };
type ProfileForm = { kind: 'profile'; exists: boolean; hireDate: string; regularDate: string; contractType: string; contractEnd: string; phone: string; emergencyContact: string; workLocation: string; notes: string };
type EventForm = { kind: 'event'; fromStatus: string; type: string; effectiveDate: string; toDeptId: string; toRoleId: string; reason: string; acknowledged: boolean };

const message = (e: unknown, fallback: string) => e instanceof Error ? e.message : fallback;
const today = () => businessNow().toLocaleDateString('sv-SE');
const eventChoices = (status: string) => EMPLOYMENT_EVENTS.filter(e => e.from.includes(status));
const profileForm = (p: EmployeeProfile | null): ProfileForm => ({ kind: 'profile', exists: !!p, hireDate: p?.hireDate ?? '', regularDate: p?.regularDate ?? '', contractType: p?.contractType ?? '', contractEnd: p?.contractEnd ?? '', phone: p?.phone ?? '', emergencyContact: p?.emergencyContact ?? '', workLocation: p?.workLocation ?? '', notes: p?.notes ?? '' });

export function EmployeeFile({ person, departments, jobs, positionNames, nameOf, onChanged }: {
  person: EmployeePerson; departments: OrgDepartment[]; jobs: OrgJob[]; positionNames: Record<string, string>;
  nameOf: (userId: string) => string | undefined; onChanged?: () => unknown;
}) {
  const session = useMistSession(), toast = useToast();
  const canWrite = session.hasPermission('hr:write'), canAssignJobs = session.hasPermission('users:admin'), company = !!session.user?.companyId;
  const [profile, setProfile] = React.useState<{ userId: string; value: EmployeeProfile | null; error?: string } | null>(null);
  const [events, setEvents] = React.useState<{ userId: string; rows: EmploymentEvent[] | null; error?: string } | null>(null), [tick, setTick] = React.useState(0);
  const [form, setForm] = React.useState<ProfileForm | EventForm | null>(null), [formError, setFormError] = React.useState(''), [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    let live = true; setProfile({ userId: person.id, value: null }); setEvents({ userId: person.id, rows: null });
    organizationApi.profile(person.id).then(value => { if (live) setProfile({ userId: person.id, value }); }, e => { if (live) setProfile({ userId: person.id, value: null, error: message(e, '档案读取失败') }); });
    organizationApi.employmentEvents(person.id).then(r => { if (live) setEvents({ userId: person.id, rows: r.events ?? [] }); }, e => { if (live) setEvents({ userId: person.id, rows: [], error: message(e, '变动记录读取失败') }); });
    return () => { live = false; };
  }, [person.id, tick]);
  React.useEffect(() => { setForm(null); setFormError(''); }, [person.id]);

  const current = profile?.userId === person.id ? profile : null;
  const positionTitle = (id: string | null) => id ? positionNames[id] ?? '（已删除岗位）' : '—';
  const deptName = (id: string | null) => id ? departments.find(d => d.id === id)?.name ?? '—' : '—';
  const done = async (text: string) => { toast(text); setForm(null); setTick(t => t + 1); await onChanged?.(); };
  const submit = async () => {
    if (!form || busy) return;
    setFormError('');
    const def = form.kind === 'event' ? EMPLOYMENT_EVENTS.find(e => e.value === form.type) : undefined;
    if (form.kind === 'profile' && !form.exists && !form.hireDate) return setFormError('建档须填写入职日期');
    if (form.kind === 'profile' && !form.exists && form.regularDate && form.regularDate < form.hireDate) return setFormError('转正日期不能早于入职日期');
    if (form.kind === 'event' && (!form.type || !form.effectiveDate)) return setFormError('请选择变动类型并填写生效日期');
    if (form.kind === 'event' && def?.position && (!form.toRoleId || !form.toDeptId)) return setFormError('请选择岗位和任职部门');
    if (form.kind === 'event' && def?.position && form.toRoleId === (person.roleIds?.[0] ?? '') && form.toDeptId === (person.departmentId ?? '')) return setFormError('请选择新的岗位或部门');
    if (form.kind === 'event' && (def?.terminal || company && form.type === 'Suspend') && !form.acknowledged) return setFormError(company ? '请确认暂停本公司访问。' : '请先勾选确认：办理后该员工的系统账号会立即停用');
    setBusy(true);
    try {
      if (form.kind === 'event') {
        const result = await organizationApi.recordEvent({ userId: person.id, type: form.type, effectiveDate: form.effectiveDate, reason: form.reason.trim() || null,
          fromDeptId: person.departmentId ?? null, fromPositionId: person.roleIds?.[0] ?? current?.value?.positionId ?? null, ...(def?.position ? { toRoleId: form.toRoleId, toDeptId: form.toDeptId } : {}) });
        await done(result.jobChanged && def?.position ? `已办理${def.label}，新岗位权限已生效` : result.accountDisabled ? (company ? `已办理${def?.label ?? '变动'}，本公司访问已停用` : `已办理${def?.label ?? '变动'}，系统账号已停用`) : result.leftTeams ? `已办理${def?.label ?? '变动'}，部门已调整并退出原小组` : form.type === 'Onboard' ? '已办理返聘，账号已恢复启用' : `已办理${def?.label ?? '变动'}`);
      } else {
        if (!form.exists && !company) {
          // 新建档案按入职事件写入（留下在职变动记录）；填了转正日期则同时记一次转正。
          await organizationApi.recordEvent({ userId: person.id, type: 'Onboard', effectiveDate: form.hireDate, fromDeptId: null, reason: '建立员工档案' });
          if (form.regularDate) await organizationApi.recordEvent({ userId: person.id, type: 'Regularize', effectiveDate: form.regularDate, reason: '建档时已转正' });
        }
        const { profile: saved } = await organizationApi.saveProfile(person.id, { ...(form.hireDate ? { hireDate: form.hireDate } : {}), ...(!form.exists && form.regularDate ? { regularDate: form.regularDate } : {}), contractType: form.contractType || null, contractEnd: form.contractEnd || null, phone: form.phone || null, emergencyContact: form.emergencyContact || null, workLocation: form.workLocation || null, notes: form.notes || null });
        setProfile({ userId: person.id, value: saved });
        await done(form.exists ? '员工档案已保存' : '已建立员工档案');
      }
    } catch (e) { setFormError(message(e, '保存未完成')); if (form.kind === 'profile' && !form.exists) { setTick(t => t + 1); void onChanged?.(); } }
    finally { setBusy(false); }
  };
  const value = current?.value ?? null;
  const def = form?.kind === 'event' ? EMPLOYMENT_EVENTS.find(e => e.value === form.type) : undefined;
  const stopsAccess = form?.kind === 'event' && (def?.terminal || company && form.type === 'Suspend');

  return <>
    <CardHeader title={uiText("员工档案")} sub={uiText(value ? value.employeeNo : undefined)} tools={canWrite && current && !current.error ? <div className="mist-row">
      {(!value || ACTIVE_EMPLOYMENT.includes(value.employmentStatus)) && <Button size="sm" variant={value ? 'secondary' : 'primary'} onClick={() => { setFormError(''); setForm(profileForm(value)); }}>{uiText(value ? '修改员工档案' : '建立员工档案')}</Button>}
      {value && eventChoices(value.employmentStatus).length > 0 && <Button size="sm" onClick={() => { const first = eventChoices(value.employmentStatus)[0]; setFormError(''); setForm({ kind: 'event', fromStatus: value.employmentStatus, type: first.value, effectiveDate: today(), toDeptId: person.departmentId ?? '', toRoleId: person.roleIds?.[0] ?? '', reason: '', acknowledged: false }); }}>{uiText("办理在职变动")}</Button>}
    </div> : undefined} />
    {!current ? null : current.error ? <Banner tone="bad" title={uiText("档案读取失败")}>{current.error}</Banner> : value ? <KeyValue items={[
      { label: '在职状态', value: EMPLOYMENT_STATUS[value.employmentStatus] ?? value.employmentStatus },
      { label: '入职日期', value: value.hireDate ?? '—' }, { label: '转正日期', value: value.regularDate ?? '—' },
      { label: '合同类型', value: CONTRACT_TYPES.find(c => c.value === value.contractType)?.label ?? '—' }, { label: '合同到期', value: value.contractEnd ?? '—' },
      { label: '联系电话', value: value.phone ?? '—' }, { label: '紧急联系人', value: value.emergencyContact ?? '—' },
      { label: '工作地点', value: value.workLocation ?? '—' }, { label: '备注', value: value.notes ?? '—' },
    ]} /> : <EmptyState compact title={uiText("尚未建立员工档案")} />}
    {value && <>
      <CardHeader title={uiText("在职变动记录")} sub={uiText(events?.userId === person.id && events.rows ? `${events.rows.length} 条` : undefined)} />
      {events?.userId !== person.id || !events.rows ? <p className="mist-note">{uiText("读取中…")}</p> : events.error ? <Banner tone="bad" title={uiText("变动记录读取失败")}>{events.error}</Banner> : events.rows.length ? <DataTable ariaLabel={uiText("在职变动记录")} rows={events.rows} rowKey={e => e.id} columns={[
        { key: 'date', header: '生效日期', width: '110px', render: e => e.effectiveDate },
        { key: 'type', header: '变动', width: '110px', render: e => <b>{eventLabel(e.type, e.fromStatus)}</b> },
        { key: 'detail', header: '说明', render: e => <>{(e.type === 'Transfer' || e.type === 'Promote') && <div>{positionTitle(e.fromPositionId)} → {positionTitle(e.toPositionId)}</div>}{e.toDeptId && e.toDeptId !== e.fromDeptId && <div>{uiText("部门：")}{deptName(e.fromDeptId)} → {deptName(e.toDeptId)}</div>}{e.reason && <div className="mist-note">{e.reason}</div>}</> },
        { key: 'by', header: '办理人', width: '110px', render: e => e.operatorId ? nameOf(e.operatorId) ?? '—' : '—' },
      ]} /> : <EmptyState compact title={uiText("还没有变动记录")} />}
    </>}

    <Drawer open={!!form} onClose={() => !busy && setForm(null)} title={uiText(form?.kind === 'event' ? '办理在职变动' : form?.exists ? '修改员工档案' : '建立员工档案')} sub={uiText(person.displayName)}
      footer={<div className="mist-row"><Button variant="primary" loading={busy} onClick={() => void submit()}>{uiText(form?.kind === 'event' ? `确认${def?.label ?? '办理'}` : '保存')}</Button><Button disabled={busy} onClick={() => setForm(null)}>{uiText("取消")}</Button></div>}>
      {form && <>
        {formError && <Banner tone="bad" title={uiText("未保存")}>{formError}</Banner>}
        {form.kind === 'event' ? <FormGrid>
          <Field label={uiText("当前状态")}><span>{EMPLOYMENT_STATUS[form.fromStatus] ?? form.fromStatus}{uiText(person.roles.length ? ` · ${person.roles.join('、')}` : '')}</span></Field>
          <Field label={uiText("变动类型")} required><Select aria-label={uiText("变动类型")} value={form.type} disabled={busy} onChange={e => setForm({ ...form, type: e.target.value, acknowledged: false })} options={eventChoices(form.fromStatus).map(e => ({ value: e.value, label: e.label }))} /></Field>
          <Field label={uiText("生效日期")} required><TextInput type="date" value={form.effectiveDate} disabled={busy} onChange={e => setForm({ ...form, effectiveDate: e.target.value })} /></Field>
          {def?.position && <Field label={uiText("岗位")} required hint={canAssignJobs ? undefined : uiText("调整岗位需要账号与岗位管理权限")}><Select aria-label={uiText("新岗位")} value={form.toRoleId} disabled={busy || !canAssignJobs} placeholder={uiText("选择岗位")} onChange={e => setForm({ ...form, toRoleId: e.target.value })} options={jobs.map(job => ({ value: job.id, label: job.name }))} /></Field>}
          {def?.position && <Field label={uiText("任职部门")} required><Select aria-label={uiText("调入部门")} value={form.toDeptId} disabled={busy} placeholder={uiText("选择部门")} onChange={e => setForm({ ...form, toDeptId: e.target.value })} options={departmentOptions(departments)} /></Field>}
          <Field label={uiText("原因 / 说明")} full><TextArea value={form.reason} disabled={busy} onChange={e => setForm({ ...form, reason: e.target.value })} /></Field>
          {def?.position && form.toDeptId && form.toDeptId !== (person.departmentId ?? '') && <div style={{ gridColumn: '1 / -1' }}><Banner tone="warn" title={ui`部门将从 ${deptName(person.departmentId)} 调为 ${deptName(form.toDeptId)}`}>{uiText("同时退出原部门的小组。")}</Banner></div>}
          {stopsAccess && <div style={{ gridColumn: '1 / -1' }}><Banner tone="bad" title={uiText(company ? "办理后暂停本公司访问" : "办理后系统账号立即停用")}>{uiText("请先完成业务交接。")}</Banner>
            <Checkbox label={uiText(company ? "我已确认，暂停此人在本公司的访问" : "我已确认，办理后立即停用该员工的系统账号")} checked={form.acknowledged} disabled={busy} onChange={on => setForm({ ...form, acknowledged: on })} /></div>}
          {form.type === 'Onboard' && <div style={{ gridColumn: '1 / -1' }}><Banner tone="warn" title={uiText(company ? "返聘将恢复本公司访问" : "返聘会恢复系统账号")}>{uiText("原有岗位保留。")}</Banner></div>}
        </FormGrid> : <FormGrid>
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
  </>;
}
