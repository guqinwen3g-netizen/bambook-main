import { interfaceLocale } from '../../../../services/interfaceLanguage';
import { uiText, ui } from '../../../../services/interfaceLanguage';
/** T10 设置：保留 Mist 分区导航、设置卡与吸底操作栏。 */
import React from 'react';
import { Bell, Building2, Landmark, RefreshCw, LayoutDashboard, History } from 'lucide-react';
import { FormFooter, Banner, Button, Card, DataTable, EmptyState, Field, FormGrid, FormSection, MistPage, PageHeader, Select, SettingRow, Skeleton, Switch, TextInput, VerticalSteps, useToast } from '../../../../components/mist';
import type { MistCompanyProfile, MistSettings } from '../../../../server/src/shared/mistWorkspace';
import { useMistSession } from '../runtime/auth';
import { useMistWorkspace } from '../runtime/workspace';
import { useNav } from '../nav';
import { WorkspaceMembers } from './WorkspaceMembers';
import { CompanyProfileSection } from './CompanyProfileSection';

type TextKey = 'workspaceName';
type TextValues = Pick<MistSettings, TextKey>;
type SettingsPatch = Partial<Omit<MistSettings, 'companyProfile'>> & { companyProfile?: Partial<MistCompanyProfile> };
export function SettingsPage() {
  const workspace = useMistWorkspace(), session = useMistSession(), toast = useToast(), nav = useNav();
  const { state, loading, saving, pending } = workspace;
  const [sec, setSec] = React.useState(() => ['overview', 'activity', 'notify', 'workspace', 'company'].includes(String(nav?.route?.section)) ? String(nav!.route.section) : 'overview'), [error, setError] = React.useState('');
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
    setDraft(state ? { scope, values: { workspaceName: state.settings.workspaceName } } : null);
  }, [scope]);
  React.useEffect(() => {
    if (!state) return;
    setDraft(previous => {
      const values = { workspaceName: state.settings.workspaceName };
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
  return (
    <MistPage>
      <PageHeader eyebrow={uiText("公司管理")} title={uiText("公司设置")} />
      {(error || workspace.error) && <Banner tone="bad" title={uiText(error || workspace.error)} actions={<Button size="sm" icon={RefreshCw} onClick={() => { setError(''); void workspace.refresh(); }}>{uiText("重新读取")}</Button>} />}
      {pending && !saving && <Banner tone="warn" title={uiText("上一次操作结果待核对")} actions={<Button size="sm" disabled={saving} onClick={() => void workspace.recover().catch(failure=>setError(failure instanceof Error?failure.message:'原请求核对失败'))}>{uiText("核对原请求")}</Button>} />}
      <div className="mist-wizard">
        <VerticalSteps mode="page" current={sec} onSelect={setSec} steps={[
          { id: 'overview', label: '管理总览', icon: LayoutDashboard }, ...(!member ? [{ id: 'activity', label: '设置记录', icon: History }] : []),
          { id: 'notify', label: '通知', icon: Bell },
          { id: 'workspace', label: '公司成员', icon: Building2 }, { id: 'company', label: '公司资料', icon: Landmark }]} />
        <Card>
          {!settings || !values ? <FormSection title={uiText("正在读取设置")}><Skeleton height={120} /></FormSection> : <>
          {member && sec !== 'workspace' && sec !== 'company' && <Banner tone="neutral" title={uiText("公司设置由管理人员维护")}>{uiText("这些设置作用于整个公司，当前账号只能查看，不能修改。")}</Banner>}
          {sec === 'overview' && <FormSection title={uiText("公司管理总览")}>
            <SettingRow title={uiText("公司资料与单据抬头")} control={<Button onClick={()=>setSec('company')}>{uiText("维护公司资料")}</Button>}/>
            <SettingRow title={uiText("成员与业务范围")} control={<Button onClick={()=>setSec('workspace')}>{uiText("管理公司成员")}</Button>}/>
            {(session.hasPermission?.('users:admin') || session.hasRole?.('owner','admin')) && <SettingRow title={uiText("人员账号与岗位权限")} control={<Button onClick={()=>nav?.go('admin-panel')}>{uiText("进入公司后台")}</Button>}/>}
            {(session.hasPermission?.('hr:read') || session.hasPermission?.('hr:write')) && <SettingRow title={uiText("部门、小组与员工档案")} control={<Button onClick={()=>nav?.go('hr')}>{uiText("管理组织架构")}</Button>}/>}
            <SettingRow title={uiText("业务默认项")} control={<Button onClick={()=>setSec('workspace')}>{uiText("查看业务设置")}</Button>}/>
          </FormSection>}
          {sec === 'activity' && !member && <FormSection title={uiText("公司设置变更记录")}>
            <DataTable ariaLabel={uiText("公司设置变更记录")} rows={state.events.filter(item=>item.entityType==='settings').slice(0,100)} rowKey={item=>item.id} columns={[{key:'time',header:'时间',render:item=>new Date(item.at).toLocaleString(interfaceLocale())},{key:'actor',header:'操作人',render:item=>item.actor},{key:'text',header:'变更内容',render:item=>item.text}]} empty={<EmptyState title={uiText("暂无设置变更记录")} description={uiText("之后保存的公司设置将记录在这里。")} compact/>}/>
          </FormSection>}
          {sec === 'notify' && <FormSection title={uiText("通知")}>
            <SettingRow title={uiText("QC 报告回传")} control={<Switch ariaLabel={uiText("QC 报告回传")} checked={settings.notifications.qc} disabled={settingsLocked} onChange={value => notify('qc', value)} />} />
            <SettingRow title={uiText("出运准备提醒")} control={<Switch ariaLabel={uiText("出运准备提醒")} checked={settings.notifications.shipping} disabled={settingsLocked} onChange={value => notify('shipping', value)} />} />
            <SettingRow title={uiText("小竹主动建议")} control={<Switch ariaLabel={uiText("小竹主动建议")} checked={settings.notifications.suggestions} disabled={settingsLocked} onChange={value => notify('suggestions', value)} />} />
            <SettingRow title={uiText("站内每日摘要")} control={<Switch ariaLabel={uiText("站内每日摘要")} checked={settings.notifications.digest} disabled={settingsLocked} onChange={value => notify('digest', value)} />} />
          </FormSection>}
          {sec === 'workspace' && <FormSection title={uiText("公司基本设置")}>
            <FormGrid><Field label={uiText("名称")}><TextInput aria-label={uiText("公司显示名称")} value={values.workspaceName} disabled={settingsLocked} onChange={event => edit('workspaceName', event.target.value)} onBlur={() => saveField('workspaceName')} /></Field><Field label={uiText("默认币种")} hint={uiText("用于新建资料；客户与来源单据的币种优先")}><Select aria-label={uiText("默认币种")} disabled={settingsLocked} value={settings.companyProfile?.defaultCurrency||'USD'} options={[...new Set(['USD','EUR','CNY','GBP','HKD',settings.companyProfile?.defaultCurrency||'USD'])]} onChange={event=>saveCurrency(event.target.value)} /></Field>
            </FormGrid>
          </FormSection>}
          {sec === 'workspace' && <WorkspaceMembers busy={busy} />}
          {/* 常驻挂载：在分区间切换不丢公司资料草稿；保存按钮在其自身吸底栏。 */}
          <div hidden={sec !== 'company'}><CompanyProfileSection member={member} /></div>
          </>}
          {!['company','overview','activity'].includes(sec) && <FormFooter>{saving && <span className="mist-note">{uiText('正在保存…')}</span>}<span className="mist-spacer" /><Button variant="primary" disabled={busy || !settings} loading={saving} onClick={finish}>{uiText("完成")}</Button></FormFooter>}
        </Card>
      </div>
    </MistPage>
  );
}
