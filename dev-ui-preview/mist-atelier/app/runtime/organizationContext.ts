import React from 'react';
import { apiService } from '../../../../services/apiService';
import { useMistSession } from './auth';

export type OwnTeam = { id: string; name: string; status?: string };
export function organizationLabel(department: string | null | undefined, teams: OwnTeam[]) {
  const active = teams.filter(team => team.status === undefined || team.status === 'active');
  return active.length
    ? { name: active.map(team => team.name).join('、'), caption: active.length === 1 ? '当前小组' : '所属小组' }
    : { name: department?.trim() || '部门未设置', caption: '当前部门' };
}

/** Read only the authenticated person's groups; membership never grants operation authority. */
export function useOrganizationContext() {
  const session = useMistSession();
  const scope = `${session.sessionKey}:${session.user?.id || ''}`;
  const [attempt, retry] = React.useReducer(value => value + 1, 0);
  React.useEffect(() => { const refresh = () => retry(); window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh); }, []);
  const [result, setResult] = React.useState<{ scope: string; teams: OwnTeam[]; error: boolean }>();
  React.useEffect(() => {
    if (session.status !== 'authenticated' || session.localMode) return;
    const controller = new AbortController(); let active = true;
    void fetch('/api/hr/teams/mine', { headers: apiService.getAuthHeaders(), credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw Error('小组归属读取失败');
        const data = await response.json();
        if (data.ok !== true || !Array.isArray(data.teams) || data.teams.some((team: OwnTeam) => !team || typeof team.id !== 'string' || typeof team.name !== 'string')) throw Error('小组归属格式无效');
        if (active) setResult({ scope, teams: data.teams.filter((team: OwnTeam) => team.status === undefined || team.status === 'active'), error: false });
      }).catch(() => { if (active) setResult({ scope, teams: [], error: true }); });
    return () => { active = false; controller.abort(); };
  }, [scope, session.status, session.localMode, attempt]);
  const current = result?.scope === scope ? result : undefined;
  const label = organizationLabel(session.user?.department, current?.teams || []);
  const loading = !session.localMode && !current;
  return { ...label, caption: current?.error ? '小组归属待核对' : loading ? '正在读取小组' : label.caption, teams: current?.teams || [], error: current?.error || false, loading, retry };
}
