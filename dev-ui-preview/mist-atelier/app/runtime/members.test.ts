import { describe, expect, it } from 'vitest';
import type { MistState } from '../../../../server/src/shared/mistWorkspace';
import { workspaceMembers, memberSelectOptions, defaultMemberId } from './members';

const state = (members: Array<{ userId: string; name: string }>) => ({ members, memberGroups: [], customers: [], orders: [], devs: [], fabrics: [] }) as unknown as MistState;
describe('current company member names', () => {
  it('uses the active directory name for the library creator when another employee signs in', () => {
    const people = workspaceMembers({ ownerId: 'usr-creator', access: { companyLibrary: true } }, state([{ userId: 'usr-creator', name: '叶澄' }, { userId: 'sales', name: '唐玥' }]), { id: 'sales', displayName: '唐玥' });
    expect(memberSelectOptions(people)).toEqual([{ value: 'usr-creator', label: '叶澄' }, { value: 'sales', label: '唐玥' }]);
    expect(defaultMemberId(people, 'sales')).toBe('sales');
  });
  it('prefers the current roster over stale viewer, business-group and document names', () => {
    const source = state([{ userId: 'creator', name: '现姓名' }]);
    source.memberGroups = [{ userId: 'creator', name: '旧姓名', groups: [] }];
    const people = workspaceMembers({ ownerId: 'creator' }, source, { id: 'creator', displayName: '旧登录姓名' });
    expect(people[0].name).toBe('现姓名');
  });
  it('does not reinsert a former library creator into the authoritative company roster', () => {
    const people = workspaceMembers({ ownerId: 'former', access: { companyLibrary: true } }, state([{ userId: 'sales', name: '唐玥' }]), { id: 'sales', displayName: '唐玥' });
    expect(people.map(person => person.id)).toEqual(['sales']);
  });
  it('retains the local-workspace owner fallback and avoids duplicate member options', () => {
    expect(workspaceMembers({ ownerId: 'local-owner' }, state([]), { id: 'local-owner', displayName: '本机负责人' })).toMatchObject([{ id: 'local-owner', name: '本机负责人', owner: true }]);
    expect(workspaceMembers({ ownerId: 'creator' }, state([{ userId: 'creator', name: '姓名' }]), null)).toHaveLength(1);
  });
});
