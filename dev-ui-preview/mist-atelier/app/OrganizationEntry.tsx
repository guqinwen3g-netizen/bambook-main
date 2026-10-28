/**
 * 左上角组织入口（规格 §5，2026-10-28 定稿）：小组状态为成员头像串 + 小组名；未入组为部门图标容器 + 部门名。
 * 浮层列出“全部小组”与各小组（小头像串、名称、人数、选中标记），其后为公司资料与管理小组入口。切换即时生效，按账号记住。
 */
import React from 'react';
import { Building2, Check } from 'lucide-react';
import { AvatarStack, Icon } from '../../../components/mist';
import { uiText } from '../../../services/interfaceLanguage';
import { ALL_TEAMS } from './runtime/teamView';
import type { OwnTeam, TeamPerson } from './runtime/organizationContext';

type Organization = { name: string; caption: string; teams: OwnTeam[]; error: boolean; loading: boolean; retry: () => void };
const people = (list: TeamPerson[]) => list.map(person => ({ name: person.name, src: person.avatarUrl }));
/** “全部”视角：本人所在各组成员去重合并。 */
export function unionMembers(teams: OwnTeam[]): TeamPerson[] {
  const seen = new Map<string, TeamPerson>();
  for (const team of teams) for (const person of team.members ?? []) if (!seen.has(person.id)) seen.set(person.id, person);
  return [...seen.values()];
}

function Lead({ members, department }: { members?: TeamPerson[]; department?: boolean }) {
  if (department || !members) return <span className="mist-ws-dept" aria-hidden="true"><Icon icon={Building2} size="sm" /></span>;
  return <span className="mist-ws-lead" aria-hidden="true">
    <span data-expanded-only><AvatarStack overlap people={people(members)} max={4} size="xs" /></span>
    <span data-collapsed-only><AvatarStack overlap people={people(members)} max={2} size="xs" /></span>
  </span>;
}

export function organizationEntry(input: {
  organization: Organization; department: string | null | undefined; teamId: string;
  onSelect: (teamId: string) => void; onCompanyProfile?: () => void; onManageTeams?: () => void;
}) {
  const { organization, teamId } = input, teams = organization.teams;
  const selected = teams.find(team => team.id === teamId);
  const hasTeams = teams.length > 0;
  const members = selected ? selected.members ?? [] : unionMembers(teams);
  const name = !hasTeams ? input.department?.trim() || '部门未设置' : selected ? selected.name : '全部小组';
  const caption = organization.error ? '小组归属待核对' : organization.loading ? '正在读取小组' : hasTeams ? '当前小组' : '当前部门';
  const row = (id: string, label: string, list: TeamPerson[], count: number) => {
    const checked = id === (selected ? selected.id : ALL_TEAMS);
    return <li key={id}><button type="button" role="menuitemradio" aria-checked={checked} className="mist-team-row" onClick={() => input.onSelect(id)}>
      <span aria-hidden="true">{list.length ? <AvatarStack overlap people={people(list)} max={3} size="xs" /> : <span className="mist-ws-dept"><Icon icon={Building2} size="xs" /></span>}</span>
      <span><b>{uiText(label)}</b><small>{uiText(`${count} 人`)}</small></span>
      {checked && <Icon icon={Check} size="sm" label={uiText('当前视角')} />}
    </button></li>;
  };
  const disclosure = <>
    {hasTeams && <ul className="mist-team-list" role="menu" aria-label={uiText('切换小组视角')}>
      {row(ALL_TEAMS, '全部小组', unionMembers(teams), unionMembers(teams).length)}
      {teams.map(team => row(team.id, team.name, team.members ?? [], team.members?.length ?? 0))}
    </ul>}
    {!hasTeams && !organization.loading && !organization.error && <p className="mist-note">{uiText('未加入小组')}</p>}
    {organization.error && <button type="button" onClick={organization.retry}>{uiText('重新读取')}</button>}
    <div className="mist-team-sep" role="separator" />
    {input.onCompanyProfile && <button type="button" onClick={input.onCompanyProfile}>{uiText('公司资料')}</button>}
    {input.onManageTeams && <button type="button" onClick={input.onManageTeams}>{uiText('管理小组')}</button>}
  </>;
  return { symbol: name.slice(0, 1), lead: <Lead members={hasTeams ? members : undefined} department={!hasTeams} />, name, caption, disclosure };
}
