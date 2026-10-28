/** 负责人 / 经手人选择：公司库以当前公司名册为准；本机旧空间兼容所有者与被授权成员。服务端仍按账号 ID 校验。 */
import type { MistState } from '../../../../server/src/shared/mistWorkspace';
import { accountOwnedObjects, type MistBusinessGroup } from '../../../../server/src/shared/mistAccounts';

export type MistMemberOption = { id: string; name: string; groups: MistBusinessGroup[]; owner: boolean };
type Envelope = { ownerId?: string; access?: { companyLibrary?: boolean } } | null | undefined;
type Viewer = { id?: string; displayName?: string } | null | undefined;

/** 当前名册优先于登录、业务组及历史单据快照。库创建人的姓名同样来自名册。 */
function ownerName(state: MistState, ownerId: string, viewer: Viewer): string {
  const fromRoster = state.members?.find(member => member.userId === ownerId)?.name;
  if (fromRoster?.trim()) return fromRoster;
  if (viewer?.id === ownerId && viewer.displayName) return viewer.displayName;
  const fromGroups = state.memberGroups?.find(g => g.userId === ownerId)?.name;
  if (fromGroups) return fromGroups;
  const snapshot = [...(state.customers || []), ...(state.orders || []), ...(state.devs || []), ...(state.fabrics || [])].find(row => row.ownerId === ownerId)?.owner;
  return snapshot || ownerId;
}
export function workspaceMembers(envelope: Envelope, state: MistState | null | undefined, viewer: Viewer): MistMemberOption[] {
  if (!state) return [];
  const groups = (id: string) => state.memberGroups?.find(g => g.userId === id)?.groups ?? [];
  const out: MistMemberOption[] = [];
  const company = envelope?.access?.companyLibrary === true;
  // 公司库的创建人没有额外成员身份；已不在公司名册时不能被前端重新加入。
  if (envelope?.ownerId && (!company || state.members?.some(member => member.userId === envelope.ownerId))) out.push({ id: envelope.ownerId, name: ownerName(state, envelope.ownerId, viewer), groups: groups(envelope.ownerId), owner: !company });
  for (const m of state.members ?? []) if (!out.some(o => o.id === m.userId)) out.push({ id: m.userId, name: m.name, groups: groups(m.userId), owner: false });
  return out;
}
/** Select 选项：业务员通用（P4），不再按面料/成衣过滤；当前值若已不在成员中仍显示（只读保留，服务端不接受新指定）。 */
export function memberSelectOptions(members: MistMemberOption[], options: { group?: MistBusinessGroup; current?: { id?: string; name?: string } } = {}) {
  const list = members;
  const dup = (name: string) => members.filter(m => m.name === name).length > 1;
  const rows = list.map(m => ({ value: m.id, label: dup(m.name) ? `${m.name} · ${m.id}` : m.name }));
  const current = options.current;
  if (current?.id && !rows.some(r => r.value === current.id)) {
    const member = members.find(m => m.id === current.id);
    rows.unshift({ value: current.id, label: `${current.name || member?.name || current.id}（已不在本公司成员中）` });
  }
  return rows;
}
export function defaultMemberId(members: MistMemberOption[], viewerId?: string | null, _group?: MistBusinessGroup) {
  return members.find(m => m.id === viewerId)?.id ?? '';
}
export { accountOwnedObjects };
