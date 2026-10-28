/**
 * 小组视角（规格 §5，P5）。左上角选中某个小组时，列表、首页、待办只看该小组范围内的业务；“全部”看本人可见的全部。
 * 切换只改变视角，不改变权限：服务端已按数据范围裁剪，这里只在已收到的数据上再按小组范围收窄，写操作仍由服务端校验。
 * 选择按账号记在本机偏好中。
 */
import React from 'react';
import type { MistState } from '../../../../server/src/shared/mistWorkspace';
import { applyDataScope } from '../../../../server/src/shared/mistDataScope';
import { buildTeamScopeGraph, resolveTeamScope, type MistTeamScope, type TeamScopeNodeKind, type TeamScopeRef } from '../../../../server/src/shared/mistTeamScope';
import { MistWorkspaceScope, useMistWorkspace } from './workspace';
import type { OwnTeam } from './organizationContext';

export const ALL_TEAMS = 'all';
const KEY = (userId: string) => `mist.teamView:${userId}`;
const memory = new Map<string, string>();
const listeners = new Set<() => void>();
function read(userId: string | undefined) { if (!userId) return ALL_TEAMS; if (memory.has(userId)) return memory.get(userId)!; try { return localStorage.getItem(KEY(userId)) || ALL_TEAMS; } catch { return ALL_TEAMS; } }
export function setTeamView(userId: string | undefined, teamId: string) {
  if (!userId) return;
  memory.set(userId, teamId);
  try { if (teamId === ALL_TEAMS) localStorage.removeItem(KEY(userId)); else localStorage.setItem(KEY(userId), teamId); } catch { /* 偏好不可写时只影响记忆，不影响本次切换 */ }
  for (const fn of listeners) fn();
}
/** 当前视角：记住的小组已不在本人小组中时回到“全部”。 */
export function useTeamView(userId: string | undefined, teams: OwnTeam[]) {
  const stored = React.useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => read(userId), () => ALL_TEAMS);
  const teamId = stored !== ALL_TEAMS && teams.some(team => team.id === stored) ? stored : ALL_TEAMS;
  return { teamId, team: teams.find(team => team.id === teamId), select: (id: string) => setTeamView(userId, id) };
}

type TeamViews = Record<string, TeamScopeRef[]>;
const cache = new WeakMap<MistState, Map<string, MistState>>();
/** 某小组视角下的数据：只保留该小组范围（及业务链下游）内的业务记录；指派给本人的待办保留。 */
export function teamViewState(state: MistState, teamId: string, actorId: string, views?: TeamViews): MistState {
  if (teamId === ALL_TEAMS) return state;
  let byTeam = cache.get(state); if (!byTeam) cache.set(state, byTeam = new Map());
  const picks = views?.[teamId];
  const key = `${teamId}\u0000${actorId}\u0000${JSON.stringify(picks)}`;
  if (!byTeam.has(key)) {
    // Production uses server-resolved references, never hidden HR scope configuration.
    const source = views ? { ...state, teamScopes: [{ teamId, teamName: teamId, updatedAt: "", updatedById: "", updatedBy: "", history: [], conditions: [], picks: picks ?? [], exclusions: [] }] } as MistState : state;
    const next = applyDataScope(source, { userIds: [], teamIds: [teamId] }, actorId);
    next.teamScopes = state.teamScopes;
    preservePartialViews(state, next);
    byTeam.set(key, next);
  }
  return byTeam.get(key)!;
}

/** A second projection must preserve redaction metadata from the server's first projection. */
function preservePartialViews(state: MistState, next: MistState) {
  const orders = new Set(next.orders.map(row => row.id));
  const purchases = new Set(next.fulfillment.purchases.map(row => row.id));
  const invoices = new Set(next.invoices.map(row => row.id));
  for (const shipment of next.fulfillment.shipments) {
    const original = state.fulfillment.shipments.find(row => row.id === shipment.id);
    if (original?.hiddenCount) shipment.hiddenCount = (shipment.hiddenCount ?? 0) + original.hiddenCount;
  }
  for (const row of state.partialPayableBills ?? []) {
    const lines = row.lines.filter(line => purchases.has(line.purchaseId));
    if (lines.length) next.partialPayableBills!.push({ ...row, lines, hiddenCount: row.hiddenCount + row.lines.length - lines.length });
  }
  for (const row of state.partialExpenses ?? []) {
    const shares = row.shares.filter(share => orders.has(share.orderId));
    if (shares.length) next.partialExpenses!.push({ ...row, shares, hiddenCount: row.hiddenCount + row.shares.length - shares.length });
  }
  for (const row of state.partialLettersOfCredit ?? []) {
    const orderIds = row.orderIds.filter(id => orders.has(id));
    if (orderIds.length) next.partialLettersOfCredit!.push({ ...row, orderIds, hiddenCount: row.hiddenCount + row.orderIds.length - orderIds.length });
  }
  for (const row of state.partialStatements ?? []) {
    let hiddenCount = row.hiddenCount;
    const sections = row.sections.map(section => {
      const lines = section.lines.filter(line => invoices.has(line.invoiceId));
      hiddenCount += section.lines.length - lines.length;
      return { ...section, lines, hiddenCount: section.hiddenCount + section.lines.length - lines.length };
    }).filter(section => section.lines.length);
    if (sections.length) next.partialStatements!.push({ ...row, sections, hiddenCount });
  }
  for (const row of state.partialReceipts ?? []) {
    const visible = next.allocations.filter(item => item.receiptId === row.id && item.currency === row.currency);
    const all = state.allocations.filter(item => item.receiptId === row.id && item.currency === row.currency);
    if (visible.length) next.partialReceipts!.push({ ...row, visibleAllocatedAmount: visible.reduce((sum, item) => sum + Math.round(item.amount * 100), 0) / 100, hiddenCount: row.hiddenCount + all.length - visible.length });
  }
}

/** 在小组视角下包裹页面：子页面读到的 state 已按视角收窄。 */
const OwnTeams = React.createContext<{teams: OwnTeam[]; state?: MistState | null; views?: TeamViews}>({teams: []});
export function TeamViewScope({ teamId, actorId, teams = [], children }: { teamId: string; actorId: string | undefined; teams?: OwnTeam[]; children: React.ReactNode }) {
  const workspace = useMistWorkspace();
  const state = workspace.state && actorId ? teamViewState(workspace.state, teamId, actorId, workspace.workspace?.access?.teamViews) : workspace.state;
  const value = React.useMemo(() => state === workspace.state ? workspace : { ...workspace, state, workspace: workspace.workspace ? {...workspace.workspace, state: state!, costMaterialBasis: null} : null }, [workspace, state]);
  return <OwnTeams.Provider value={{teams, state: workspace.state, views: workspace.workspace?.access?.teamViews}}>{state === workspace.state ? children : <MistWorkspaceScope value={value}>{children}</MistWorkspaceScope>}</OwnTeams.Provider>;
}
/** 列表 / 详情用：这条记录经本人哪些小组共享而来（小组名）。 */
export function useTeamOrigins(kind: TeamScopeNodeKind, id: string): string[] {
  const {teams, state, views} = React.useContext(OwnTeams);
  return teamOrigins(state, teams, kind, id, views);
}
/** 列表批量用：返回按记录查小组名的函数。 */
export function useTeamOriginLookup(): (kind: TeamScopeNodeKind, id: string) => string[] {
  const {teams, state, views} = React.useContext(OwnTeams);
  return (kind, id) => teamOrigins(state, teams, kind, id, views);
}

const originCache = new WeakMap<MistState, Map<string, Map<string, string[]>>>();
/** 记录经哪些（本人所在）小组共享而来：返回小组名，供列表与详情显示弱化来源标记。 */
export function teamOrigins(state: MistState | null | undefined, teams: OwnTeam[], kind: TeamScopeNodeKind, id: string, views?: TeamViews): string[] {
  if (views) return teams.filter(team => views[team.id]?.some(ref => ref.kind === kind && ref.id === id)).map(team => team.name);
  if (!state || !teams.length) return [];
  let byTeams = originCache.get(state); if (!byTeams) originCache.set(state, byTeams = new Map());
  const teamsKey = teams.map(team => `${team.id}\u0000${team.name}`).join('\u0001');
  let map = byTeams.get(teamsKey);
  if (!map) {
    map = new Map(); byTeams.set(teamsKey, map);
    const graph = buildTeamScopeGraph(state), mine = new Set(teams.map(team => team.id));
    for (const scope of (state.teamScopes ?? []) as MistTeamScope[]) {
      if (!mine.has(scope.teamId)) continue;
      const name = teams.find(team => team.id === scope.teamId)?.name || scope.teamName, r = resolveTeamScope(state, scope, graph);
      for (const key of [...r.collaborate, ...r.readonly]) { const list = map.get(key) ?? []; if (!list.includes(name)) list.push(name); map.set(key, list); }
    }
  }
  return map.get(`${kind}:${id}`) ?? [];
}
