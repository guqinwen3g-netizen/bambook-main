import React from 'react';
import { LogOut, Palette, Shield, User } from 'lucide-react';
import { Button, Card, FormSection, KeyValue, MistPage, PageHeader, SettingRow, VerticalSteps, useToast } from '../../../../components/mist';
import { uiText } from '../../../../services/interfaceLanguage';
import { useMistSession } from '../runtime/auth';
import { useMistWorkspace } from '../runtime/workspace';
import { useOrganizationContext } from '../runtime/organizationContext';
import { useNav } from '../nav';
import { AvatarSettingRow } from './AvatarStudio';
import { ChangePasswordRow, LogoutAllRow } from './ChangePassword';
import { DeviceAppearance } from './DeviceAppearance';
import { ManualLink } from './ManualLink';

export function AccountPage() {
  const session = useMistSession(), { state } = useMistWorkspace(), organization = useOrganizationContext(), nav = useNav(), toast = useToast();
  const requested = nav?.route.section;
  const section = requested === 'appearance' || requested === 'security' ? requested : 'profile';
  const user = session.user;
  if (!user) return null;
  return <MistPage width="narrow">
    <PageHeader title={uiText('我的账号')} />
    <div className="mist-wizard">
      <VerticalSteps mode="page" current={section} onSelect={value => nav?.go('account', undefined, { section: value })} steps={[
        { id: 'profile', label: '个人资料', icon: User }, { id: 'appearance', label: '外观与语言', icon: Palette }, { id: 'security', label: '安全', icon: Shield },
      ]} />
      <Card>
        {section === 'profile' && <FormSection title={uiText('个人资料')}>
          {!session.localMode && <AvatarSettingRow />}
          <KeyValue items={[
            { label: '姓名', value: user.displayName || '—' }, { label: '工作邮箱', value: user.email || '—' },
            ...(user.platformRole === 'platform_admin' ? [] : [
            { label: '公司', value: state?.settings.companyProfile?.legalName || '—' }, { label: '部门', value: user.department || '—' },
            { label: '小组', value: organization.loading ? '正在读取' : organization.error ? '读取失败' : organization.teams.map(team => team.name).join('、') || '未加入小组' },
            ]),
          ]} />
          {organization.error && <Button onClick={organization.retry}>{uiText('重新读取')}</Button>}
          <SettingRow title={uiText('使用手册')} control={<ManualLink variant="button" />} />
          {session.localMode && <div className="mist-row" data-wrap>{session.localProfiles?.map(profile => <Button key={profile.id} aria-pressed={profile.id === user.id} disabled={session.signingIn} onClick={() => void session.selectLocalProfile?.(profile.id).catch(failure => toast(failure instanceof Error ? failure.message : '身份切换未完成', 'bad'))}>{profile.title ? `${profile.name} · ${profile.title}` : profile.name}</Button>)}</div>}
        </FormSection>}
        {section === 'appearance' && <FormSection title={uiText('外观与语言')}><DeviceAppearance /></FormSection>}
        {section === 'security' && <FormSection title={uiText('安全')}>
          {!session.localMode && <><ChangePasswordRow /><LogoutAllRow />
            <SettingRow title={uiText('当前设备')} control={<Button icon={LogOut} loading={session.signingOut} onClick={() => void session.logout().catch(failure => toast(failure instanceof Error ? failure.message : '退出失败', 'bad'))}>{uiText('退出登录')}</Button>} />
          </>}
          {session.localMode && <Button loading={session.refreshing} onClick={() => void session.refresh()}>{uiText('重新进入本地身份')}</Button>}
        </FormSection>}
      </Card>
    </div>
  </MistPage>;
}
