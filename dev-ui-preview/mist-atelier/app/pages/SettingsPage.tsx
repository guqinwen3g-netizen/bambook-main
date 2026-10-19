/** T10 设置：保留 Mist 分区导航、设置卡与吸底操作栏。 */
import React from 'react';
import { Bell, Building2, Landmark, Laptop, Moon, Palette, Shield, Sun, User, RefreshCw, LayoutDashboard, History } from 'lucide-react';
import { Banner, Button, Card, DataTable, EmptyState, ChoiceCards, Field, FormGrid, FormSection, MistPage, PageHeader, Select, SettingRow, Skeleton, Switch, TextInput, VerticalSteps, useToast } from '../../../../components/mist';
import type { MistCompanyProfile, MistSettings } from '../../../../server/src/shared/mistWorkspace';
import { useMistSession } from '../runtime/auth';
import { useMistWorkspace } from '../runtime/workspace';
import { useNav } from '../nav';
import { WorkspaceMembers } from './WorkspaceMembers';
import { ChangePasswordRow, LogoutAllRow } from './ChangePassword';
import { CompanyProfileSection } from './CompanyProfileSection';
import { AvatarSettingRow } from './AvatarStudio';

type TextKey = 'workspaceName' | 'profileName' | 'profileEmail' | 'locale';
type TextValues = Pick<MistSettings, TextKey>;
type SettingsPatch = Partial<Omit<MistSettings, 'companyProfile'>> & { companyProfile?: Partial<MistCompanyProfile> };
export function SettingsPage() {
  const workspace = useMistWorkspace(), session = useMistSession(), toast = useToast(), nav = useNav();
  const { state, loading, saving, pending } = workspace;
  const [sec, setSec] = React.useState(() => ['overview', 'activity', 'appearance', 'notify', 'workspace', 'company', 'account', 'security'].includes(String(nav?.route?.section)) ? String(nav!.route.section) : 'overview'), [error, setError] = React.useState('');
  const scope = `${session.sessionKey}:${workspace.workspace?.id ?? ''}`, activeScope = React.useRef(scope); activeScope.current = scope;
  const [draft, setDraft] = React.useState<{ scope: string; values: TextValues } | null>(null);
  const dirty = React.useRef<Partial<Record<TextKey, boolean>>>({}), working = React.useRef(false);
  const latest = React.useRef(draft); latest.current = draft;
  React.useEffect(() => {
    dirty.current = {}; working.current = false; setError('');
    setDraft(state ? { scope, values: { workspaceName: state.settings.workspaceName, profileName: state.settings.profileName, profileEmail: state.settings.profileEmail, locale: state.settings.locale } } : null);
  }, [scope]);
  React.useEffect(() => {
    if (!state) return;
    setDraft(previous => {
      const values = { workspaceName: state.settings.workspaceName, profileName: state.settings.profileName, profileEmail: state.settings.profileEmail, locale: state.settings.locale };
      if (previous?.scope === scope) for (const key of Object.keys(dirty.current) as TextKey[]) if (dirty.current[key]) values[key] = previous.values[key];
      return { scope, values };
    });
  }, [state?.settings, scope]);
  const settings = state?.settings;
  const values = draft?.scope === scope ? draft.values : settings;
  const member = workspace.workspace?.access?.role === 'member';
  const busy = loading || saving || !!pending || !!workspace.pendingCreate;
  /** 空间设置写入整个共享空间，只有所有者可改；服务端同样拒绝成员修改。 */
  const settingsLocked = busy || member;
  const edit = (key: TextKey, value: string) => {
    if (!values) return;
    dirty.current[key] = true; setDraft({ scope, values: { workspaceName: values.workspaceName, profileName: values.profileName, profileEmail: values.profileEmail, locale: values.locale, [key]: value } });
  };
  const save = async (patch: SettingsPatch, success?: string) => {
    if (!state || busy || working.current) return false;
    if (patch.workspaceName !== undefined && (!patch.workspaceName.trim() || patch.workspaceName.trim().length > 120)) { setError('公司显示名称须为1至120字'); return false; }
    if (patch.profileEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.profileEmail)) { setError('请输入有效的显示邮箱'); return false; }
    working.current = true; const current = scope; setError('');
    try {
      await workspace.run({ type: 'settings.update', payload: patch });
      if (activeScope.current !== current) return false;
      for (const key of Object.keys(patch) as Array<keyof SettingsPatch>) if (key in dirty.current && latest.current?.values[key as TextKey] === patch[key]) delete dirty.current[key as TextKey];
      if (success) toast(success);
      return true;
    } catch (failure) {
      if (activeScope.current === current) { const message = failure instanceof Error ? failure.message : '设置保存失败'; setError(message); toast(message, 'bad'); }
      return false;
    } finally { if (activeScope.current === current) working.current = false; }
  };
  const saveField = (key: TextKey) => { if (dirty.current[key] && values) void save({ [key]: values[key].trim() }); };
  const finish = () => {
    if (!values) return;
    const patch: Partial<MistSettings> = {};
    for (const key of Object.keys(dirty.current) as TextKey[]) if (dirty.current[key]) patch[key] = values[key].trim();
    if (Object.keys(patch).length) void save(patch, '公司设置已保存'); else toast('当前设置已同步');
  };
  const saveCurrency=(defaultCurrency:string)=>{if(!settings)return;void save({companyProfile:{defaultCurrency}});};
  const notify = (key: keyof MistSettings['notifications'], value: boolean) => settings && void save({ notifications: { ...settings.notifications, [key]: value } });
  return (
    <MistPage>
      <PageHeader eyebrow="公司管理" title="公司设置" description="公司资料、人员组织、业务默认项、通知和账号安全。选择项即时保存，文字离开输入框后保存；公司资料点击保存。" />
      {(error || workspace.error) && <Banner tone="bad" title={error || workspace.error} actions={<Button size="sm" icon={RefreshCw} onClick={() => { setError(''); void workspace.refresh(); }}>重新读取</Button>} />}
      {pending && !saving && <Banner tone="warn" title="上一次操作结果待核对" actions={<Button size="sm" disabled={saving} onClick={() => void workspace.recover().catch(failure=>setError(failure instanceof Error?failure.message:'原请求核对失败'))}>核对原请求</Button>} />}
      <div className="mist-wizard">
        <VerticalSteps mode="page" current={sec} onSelect={setSec} steps={[
          { id: 'overview', label: '管理总览', icon: LayoutDashboard }, ...(!member ? [{ id: 'activity', label: '设置记录', icon: History }] : []),
          { id: 'appearance', label: '外观', icon: Palette }, { id: 'notify', label: '通知', icon: Bell },
          { id: 'workspace', label: '公司成员', icon: Building2 }, { id: 'company', label: '公司资料', icon: Landmark }, { id: 'account', label: '账号', icon: User }, { id: 'security', label: '安全', icon: Shield }]} />
        <Card>
          {!settings || !values ? <FormSection title="正在读取设置"><Skeleton height={120} /></FormSection> : <>
          {member && sec !== 'workspace' && sec !== 'security' && sec !== 'company' && <Banner tone="neutral" title="公司设置由管理人员维护">这些设置作用于整个公司，当前账号只能查看，不能修改。</Banner>}
          {sec === 'overview' && <FormSection title="公司管理总览" description="公司共用一套经营资料；部门组织人员，小组划定协作范围，岗位决定操作权限。">
            <SettingRow title="公司资料与单据抬头" description="公司名称、地址、联系方式、出口信息及收款银行，用于公司单据。" control={<Button onClick={()=>setSec('company')}>维护公司资料</Button>}/>
            <SettingRow title="成员与业务范围" description="查看公司成员，维护成员的业务组与可见范围。" control={<Button onClick={()=>setSec('workspace')}>管理公司成员</Button>}/>
            {(session.hasPermission?.('users:admin') || session.hasRole?.('owner','admin')) && <SettingRow title="人员账号与岗位权限" description="维护本公司登录账号、岗位与权限；平台账号由 Sylway Cloud 管理。" control={<Button onClick={()=>nav?.go('admin-panel')}>进入公司后台</Button>}/>}
            {(session.hasPermission?.('hr:read') || session.hasPermission?.('hr:write')) && <SettingRow title="部门、小组与员工档案" description="管理公司 → 部门 → 小组，安排人员归属并维护员工档案。" control={<Button onClick={()=>nav?.go('hr')}>管理组织架构</Button>}/>}
            <SettingRow title="业务默认项" description="维护公司显示名称和新建资料的默认币种，客户及来源单据币种优先。" control={<Button onClick={()=>setSec('workspace')}>查看业务设置</Button>}/>
            <SettingRow title="当前账号安全" description="修改登录密码、退出其他设备。" control={<Button onClick={()=>setSec('security')}>查看账号安全</Button>}/>
          </FormSection>}
          {sec === 'activity' && !member && <FormSection title="公司设置变更记录" description="从本次版本起记录设置变更的操作人和时间，不记录银行账号等字段原值。">
            <DataTable ariaLabel="公司设置变更记录" rows={state.events.filter(item=>item.entityType==='settings').slice(0,100)} rowKey={item=>item.id} columns={[{key:'time',header:'时间',render:item=>new Date(item.at).toLocaleString('zh-CN')},{key:'actor',header:'操作人',render:item=>item.actor},{key:'text',header:'变更内容',render:item=>item.text}]} empty={<EmptyState title="暂无设置变更记录" description="之后保存的公司设置将记录在这里。" compact/>}/>
          </FormSection>}
          {sec === 'appearance' && <FormSection title="外观" description="浅色 = 雾蓝 Light Mist，深色 = 深夜 Deep Night。">
            <ChoiceCards<MistSettings['theme']> ariaLabel="主题" disabled={settingsLocked} value={settings.theme} onChange={value => void save({ theme: value })} options={[{ value: 'light', title: '浅色', description: '雾蓝渐变', icon: Sun }, { value: 'dark', title: '深色', description: '深夜蓝渐变', icon: Moon }, { value: 'system', title: '跟随系统', description: '自动切换', icon: Laptop }]} />
            <div style={{ marginTop: 18 }}>
              <SettingRow title="列表密度" description="影响公司数据表的行高" control={<Select aria-label="列表密度" disabled={settingsLocked} value={settings.density} onChange={event => void save({ density: event.target.value as MistSettings['density'] })} options={[{ value: 'compact', label: '紧凑' }, { value: 'default', label: '标准' }, { value: 'comfy', label: '宽松' }]} />} />
              <SettingRow title="减少动效" description="保存减少动效偏好" control={<Switch ariaLabel="减少动效" checked={settings.reducedMotion} disabled={settingsLocked} onChange={value => void save({ reducedMotion: value })} />} />
            </div>
          </FormSection>}
          {sec === 'notify' && <FormSection title="通知" description="保存公司通知偏好。">
            <SettingRow title="QC 报告回传" description="显示开发案新评审结论的站内提醒" control={<Switch ariaLabel="QC 报告回传" checked={settings.notifications.qc} disabled={settingsLocked} onChange={value => notify('qc', value)} />} />
            <SettingRow title="出运准备提醒" description="显示交期与出运准备事项的站内提醒" control={<Switch ariaLabel="出运准备提醒" checked={settings.notifications.shipping} disabled={settingsLocked} onChange={value => notify('shipping', value)} />} />
            <SettingRow title="小竹主动建议" description="保存主动建议的通知偏好" control={<Switch ariaLabel="小竹主动建议" checked={settings.notifications.suggestions} disabled={settingsLocked} onChange={value => notify('suggestions', value)} />} />
            <SettingRow title="站内每日摘要" description="在公司内显示每日摘要，不发送邮件" control={<Switch ariaLabel="站内每日摘要" checked={settings.notifications.digest} disabled={settingsLocked} onChange={value => notify('digest', value)} />} />
          </FormSection>}
          {sec === 'workspace' && <FormSection title="公司基本设置" description={`${workspace.workspace?.name ?? settings.workspaceName} · ${member ? '当前公司，设置由公司管理人员维护' : '当前公司'}`}>
            <FormGrid><Field label="名称"><TextInput aria-label="公司显示名称" value={values.workspaceName} disabled={settingsLocked} onChange={event => edit('workspaceName', event.target.value)} onBlur={() => saveField('workspaceName')} /></Field><Field label="默认币种" hint="用于新建资料；客户与来源单据的币种优先"><Select aria-label="默认币种" disabled={settingsLocked} value={settings.companyProfile?.defaultCurrency||'USD'} options={[...new Set(['USD','EUR','CNY','GBP','HKD',settings.companyProfile?.defaultCurrency||'USD'])]} onChange={event=>saveCurrency(event.target.value)} /></Field>
              <Field label="时区" hint="当前设备时区，只读"><Select disabled options={[Intl.DateTimeFormat().resolvedOptions().timeZone]} /></Field><Field label="单号前缀" hint="由业务命令生成"><TextInput value="自动生成" disabled className="mist-mono" /></Field></FormGrid>
          </FormSection>}
          {sec === 'workspace' && <WorkspaceMembers busy={busy} />}
          {/* 常驻挂载：在分区间切换不丢公司资料草稿；保存按钮在其自身吸底栏。 */}
          <div hidden={sec !== 'company'}><CompanyProfileSection member={member} /></div>
          {sec === 'account' && <FormSection title="账号" description="公司内显示资料，不改变登录账号、邮箱或密码。">{!session.localMode && <AvatarSettingRow />}<FormGrid><Field label="姓名"><TextInput aria-label="显示姓名" value={values.profileName} disabled={settingsLocked} onChange={event => edit('profileName', event.target.value)} onBlur={() => saveField('profileName')} /></Field><Field label="邮箱"><TextInput aria-label="显示邮箱" type="email" value={values.profileEmail} disabled={settingsLocked} onChange={event => edit('profileEmail', event.target.value)} onBlur={() => saveField('profileEmail')} /></Field>
            <Field label="语言偏好" hint="保存偏好，不改变当前页面文案"><Select aria-label="显示语言" disabled={settingsLocked} value={values.locale} onChange={event => { edit('locale', event.target.value); void save({ locale: event.target.value }); }} options={[{ value: 'zh-CN', label: '简体中文' }, { value: 'en-US', label: 'English' }]} /></Field></FormGrid></FormSection>}
          {sec === 'security' && <FormSection title="安全">
            {!session.localMode && <><ChangePasswordRow /><LogoutAllRow /></>}
            {session.localMode && <>
            <SettingRow title="退出所有设备" description="本地身份由本机服务提供，设备会话管理不适用" control={<Button size="sm" disabled>不适用</Button>} /></>}
          </FormSection>}
          </>}
          {!['company','overview','activity'].includes(sec) && <div className="mist-sticky-foot"><span className="mist-note">{saving ? '正在保存…' : '选择项即时保存，文字离开输入框后保存'}</span><span className="mist-spacer" /><Button variant="primary" disabled={busy || !settings} loading={saving} onClick={finish}>完成</Button></div>}
        </Card>
      </div>
    </MistPage>
  );
}
