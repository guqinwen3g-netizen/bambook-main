import { interfaceLocale } from '../../../../services/interfaceLanguage';
import { uiText, ui } from '../../../../services/interfaceLanguage';
/**
 * 公司管理：账号、岗位与权限、公司资料、数据访问、通知与记录集中在一处（2026-10-27 合并原公司设置与公司后台；人事管理保留独立页面）。
 * 旧地址（system-settings / admin-panel 及其分区）仍打开本页对应分区；各分区按本人权限出现，服务端照常复核。
 */
import React from 'react';
import { Bell, Briefcase, History, Landmark, Laptop, RefreshCw, ScrollText, ShieldCheck, Stamp, Users } from 'lucide-react';
import { Banner, Button, Card, DataTable, EmptyState, Field, FormGrid, FormSection, MistPage, PageHeader, Select, SettingRow, Skeleton, Switch, TextInput, VerticalSteps, useToast } from '../../../../components/mist';
import type { MistCompanyProfile, MistSettings } from '../../../../server/src/shared/mistWorkspace';
import { View } from '../../../../types';
import { useMistSession } from '../runtime/auth';
import { useMistWorkspace } from '../runtime/workspace';
import { useNav } from '../nav';
import { WorkspaceMembers } from './WorkspaceMembers';
import { CompanyProfileSection } from './CompanyProfileSection';
import { AdminAccounts, AdminAuditLog, AdminRoles } from './modules/AdminAccounts';
import { AdminApprovalAuthorities } from './modules/AdminApprovalAuthorities';
import { LocalAdminPanel } from './modules/LocalAdminPanel';
import { ExporterProfilePanel } from './modules/ExporterProfilePanel';

type TextKey = 'workspaceName';
type TextValues = Pick<MistSettings, TextKey>;
type SettingsPatch = Partial<Omit<MistSettings, 'companyProfile'>> & { companyProfile?: Partial<MistCompanyProfile> };
export type CompanySection = 'accounts' | 'jobs' | 'approvals' | 'profile' | 'access' | 'notify' | 'activity' | 'audit' | 'local';
const SECTIONS: CompanySection[] = ['accounts', 'jobs', 'approvals', 'profile', 'access', 'notify', 'activity', 'audit', 'local'];
/** 旧页面与分区地址 → 公司管理分区。 */
export function companySection(view: string, section?: string, id?: string): CompanySection | undefined {
  if (section && (SECTIONS as string[]).includes(section)) return section as CompanySection;
  if (view === 'admin-panel') return ({ roles: 'jobs', approvals: 'approvals', audit: 'audit', profile: 'profile' } as Record<string, CompanySection>)[section ?? ''] ?? 'accounts';
  if (id) return 'accounts';
  return ({ company: 'profile', workspace: 'access', notify: 'notify', activity: 'activity' } as Record<string, CompanySection>)[section ?? ''];
}

export function SettingsPage() {
  const workspace = useMistWorkspace(), session = useMistSession(), toast = useToast(), nav = useNav();
  const { state, loading, saving, pending } = workspace;
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    const section = nav?.route?.section;
    if (section && ['appearance', 'account', 'security'].includes(section)) nav?.go('account', undefined, { section: section === 'account' ? 'profile' : section });
  }, [nav?.route?.section]);
  const scope = `${session.sessionKey}:${workspace.workspace?.id ?? ''}`, activeScope = React.useRef(scope); activeScope.current = scope;
  const [draft, setDraft] = React.useState<{ scope: string; values: TextValues } | null>(null);
  const dirty = React.useRef<Partial<Record<TextKey, boolean>>>({}), working = React.useRef(false);
  const latest = React.useRef(draft); latest.current = draft;
  React.useEffect(() => {
    dirty.current = {}; working.current = false; setError('');
    setDraft(state?.settings ? { scope, values: { workspaceName: state.settings.workspaceName } } : null);
  }, [scope]);
  React.useEffect(() => {
    if (!state?.settings) return;
    setDraft(previous => {
      const values = { workspaceName: state.settings.workspaceName };
      if (previous?.scope === scope) for (const key of Object.keys(dirty.current) as TextKey[]) if (dirty.current[key]) values[key] = previous.values[key];
      return { scope, values };
    });
  }, [state?.settings, scope]);
  const settings = state?.settings;
  const values = draft?.scope === scope ? draft.values : settings;
  const access = workspace.workspace?.access, member = !(access?.canManageCompany ?? access?.role !== 'member');
  const busy = loading || saving || !!pending || !!workspace.pendingCreate;
  /** 公司设置写入整个公司库，只有公司管理员（本机空间为所有者）可改；服务端同样拒绝其他成员修改。 */
  const settingsLocked = busy || member;
  const edit = (key: TextKey, value: string) => {
    if (!values) return;
    dirty.current[key] = true; setDraft({ scope, values: { ...values, [key]: value } });
  };
  const save = async (patch: SettingsPatch, success?: string) => {
    if (!state || busy || working.current) return false;
    if (patch.workspaceName !== undefined && (!patch.workspaceName.trim() || patch.workspaceName.trim().length > 120)) { setError('公司显示名称须为1至120字'); return false; }
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

  const local = !!session.localMode, scoped = !!session.user?.companyId, platformCompany = !!session.user?.platformCompany;
  const manager = !local && (session.hasRole('owner', 'admin') || session.hasPermission('users:admin'));
  const settingsAccess = platformCompany || session.canAccessView(View.SystemSettings);
  const steps = ([
    manager && { id: 'accounts', label: '账号', icon: Users },
    manager && { id: 'jobs', label: '岗位与权限', icon: Briefcase },
    manager && !scoped && { id: 'approvals', label: '审批资格', icon: Stamp },
    settingsAccess && { id: 'profile', label: '公司资料', icon: Landmark },
    settingsAccess && !platformCompany && { id: 'access', label: '数据访问', icon: ShieldCheck },
    settingsAccess && { id: 'notify', label: '通知', icon: Bell },
    settingsAccess && !member && { id: 'activity', label: '设置记录', icon: History },
    manager && !scoped && { id: 'audit', label: '审计日志', icon: ScrollText },
    local && { id: 'local', label: '本机设置', icon: Laptop },
  ].filter(Boolean)) as Array<{ id: CompanySection; label: string; icon: typeof Users }>;
  const requested = companySection(nav?.route?.view ?? '', nav?.route?.section, nav?.route?.id);
  const [chosen, setChosen] = React.useState<CompanySection | undefined>(requested);
  const sec: CompanySection | undefined = steps.find(step => step.id === chosen)?.id ?? steps[0]?.id;
  const workspaceSection = sec === 'profile' || sec === 'access' || sec === 'notify' || sec === 'activity';

  return (
    <MistPage>
      <PageHeader title={uiText("公司管理")} />
      {workspaceSection && (error || workspace.error) && <Banner tone="bad" title={uiText(error || workspace.error)} actions={<Button size="sm" icon={RefreshCw} onClick={() => { setError(''); void workspace.refresh(); }}>{uiText("重新读取")}</Button>} />}
      {workspaceSection && pending && !saving && <Banner tone="warn" title={uiText("上一次操作结果待核对")} actions={<Button size="sm" disabled={saving} onClick={() => void workspace.recover().catch(failure=>setError(failure instanceof Error?failure.message:'原请求核对失败'))}>{uiText("核对原请求")}</Button>} />}
      {!sec ? <Banner tone="neutral" title={uiText("当前账号没有公司管理权限")} /> : <div className="mist-wizard">
        <VerticalSteps mode="page" current={sec} onSelect={id => setChosen(id as CompanySection)} steps={steps} />
        <div className="mist-col" style={{ minWidth: 0 }}>
          {sec === 'accounts' && <AdminAccounts />}
          {sec === 'jobs' && <AdminRoles />}
          {sec === 'approvals' && <AdminApprovalAuthorities />}
          {sec === 'audit' && <AdminAuditLog />}
          {sec === 'local' && <LocalAdminPanel embedded />}
          {workspaceSection && <Card>
            {!settings || !values ? <FormSection title={uiText("正在读取设置")}><Skeleton height={120} /></FormSection> : <>
            {member && sec === 'notify' && <Banner tone="neutral" title={uiText("公司设置由管理人员维护")}>{uiText("这些设置作用于整个公司，当前账号只能查看。")}</Banner>}
            {sec === 'profile' && <FormSection title={uiText("公司基本设置")}>
            <FormGrid><Field label={uiText("名称")}><TextInput aria-label={uiText("公司显示名称")} value={values.workspaceName} disabled={settingsLocked} onChange={event => edit('workspaceName', event.target.value)} onBlur={() => saveField('workspaceName')} /></Field><Field label={uiText("默认币种")} hint={uiText("用于新建资料；客户与来源单据的币种优先")}><Select aria-label={uiText("默认币种")} disabled={settingsLocked} value={settings.companyProfile?.defaultCurrency||'USD'} options={[...new Set(['USD','EUR','CNY','GBP','HKD',settings.companyProfile?.defaultCurrency||'USD'])]} onChange={event=>saveCurrency(event.target.value)} /></Field>
            </FormGrid>
            </FormSection>}
            {sec === 'activity' && <FormSection title={uiText("公司设置变更记录")}>
            <DataTable ariaLabel={uiText("公司设置变更记录")} rows={state.events.filter(item=>item.entityType==='settings').slice(0,100)} rowKey={item=>item.id} columns={[{key:'time',header:'时间',render:item=>new Date(item.at).toLocaleString(interfaceLocale())},{key:'actor',header:'操作人',render:item=>item.actor},{key:'text',header:'变更内容',render:item=>item.text}]} empty={<EmptyState title={uiText("暂无设置变更记录")} description={uiText("之后保存的公司设置将记录在这里。")} compact/>}/>
          </FormSection>}
            {sec === 'notify' && <FormSection title={uiText("通知")}>
            <SettingRow title={uiText("QC 报告回传")} control={<Switch ariaLabel={uiText("QC 报告回传")} checked={settings.notifications.qc} disabled={settingsLocked} onChange={value => notify('qc', value)} />} />
            <SettingRow title={uiText("出运准备提醒")} control={<Switch ariaLabel={uiText("出运准备提醒")} checked={settings.notifications.shipping} disabled={settingsLocked} onChange={value => notify('shipping', value)} />} />
            <SettingRow title={uiText("小竹主动建议")} control={<Switch ariaLabel={uiText("小竹主动建议")} checked={settings.notifications.suggestions} disabled={settingsLocked} onChange={value => notify('suggestions', value)} />} />
            <SettingRow title={uiText("站内每日摘要")} control={<Switch ariaLabel={uiText("站内每日摘要")} checked={settings.notifications.digest} disabled={settingsLocked} onChange={value => notify('digest', value)} />} />
          </FormSection>}
            {sec === 'access' && <WorkspaceMembers busy={busy} />}
            {/* 常驻挂载：在分区间切换不丢公司资料草稿；保存按钮在其自身吸底栏。 */}
            <div hidden={sec !== 'profile'}><CompanyProfileSection member={member} active={sec === 'profile'} /></div>
            </>}
          </Card>}
          {sec === 'profile' && manager && !scoped && !platformCompany && <ExporterProfilePanel />}
        </div>
      </div>}
    </MistPage>
  );
}
