// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { organizationEntry, unionMembers } from './OrganizationEntry';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const person = (id: string) => ({ id, name: `成员${id}` });
const teams = [{ id: 'a', name: '针织一组', members: ['1', '2', '3', '4', '5', '6'].map(person) }, { id: 'b', name: '梭织组', members: ['5', '7'].map(person) }];
const org = (over: Partial<Parameters<typeof organizationEntry>[0]['organization']> = {}) => ({ name: '', caption: '', teams, error: false, loading: false, retry: vi.fn(), ...over });
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const show = (node: React.ReactNode) => { host = document.createElement('div'); root = createRoot(host); act(() => root.render(<>{node}</>)); return host; };
afterEach(() => act(() => root?.unmount()));

it('shows the chosen group with an avatar stack capped at four plus a count', () => {
  const entry = organizationEntry({ organization: org(), department: '面料部', teamId: 'a', onSelect: vi.fn() });
  expect(entry).toMatchObject({ name: '针织一组', caption: '当前小组' });
  const lead = show(entry.lead).querySelector('[data-expanded-only]')!;
  expect(lead.querySelectorAll('.mist-avatar')).toHaveLength(5);
  expect(lead.textContent).toContain('+2');
});

it.each([3,4,5,6])('shows the last member instead of a +1 for a %s-person group',count=>{
 const members=Array.from({length:count},(_,i)=>person(String(i+1)));
 const entry=organizationEntry({organization:org({teams:[{id:'a',name:'测试组',members}]}),department:'面料部',teamId:'a',onSelect:vi.fn()});
 const lead=show(<>{entry.lead}{entry.disclosure}</>);
 expect(lead.querySelector('[title="+1"]')).toBeNull();
 const expanded=lead.querySelector('[data-expanded-only]')!;
 const collapsed=lead.querySelector('[data-collapsed-only]')!;
 if(count<=5)expect(expanded.querySelector(`[title="成员${count}"]`)).not.toBeNull();
 if(count===3)expect(collapsed.querySelector('[title="成员3"]')).not.toBeNull();
 if(count===6)expect(expanded.querySelector('[title="+2"]')).not.toBeNull();
 const row=lead.querySelectorAll('.mist-team-row')[1];
 if(count<=4)expect(row.querySelector(`[title="成员${count}"]`)).not.toBeNull();
 else expect(row.querySelector(`[title="+${count-3}"]`)).not.toBeNull();
});

it('merges members across groups for the "all" view and lists every group to switch to', () => {
  expect(unionMembers(teams).map(p => p.id)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  const onSelect = vi.fn(), onManageTeams = vi.fn();
  const entry = organizationEntry({ organization: org(), department: '面料部', teamId: 'all', onSelect, onManageTeams });
  expect(entry.name).toBe('全部小组');
  const panel = show(entry.disclosure);
  const rows = [...panel.querySelectorAll('[role="menuitemradio"]')];
  expect(rows.map(r => r.textContent)).toEqual([expect.stringContaining('全部小组7 人'), expect.stringContaining('针织一组6 人'), expect.stringContaining('梭织组2 人')]);
  expect(rows[0].getAttribute('aria-checked')).toBe('true');
  act(() => (rows[2] as HTMLButtonElement).click()); expect(onSelect).toHaveBeenCalledWith('b');
  act(() => ([...panel.querySelectorAll('button')].find(b => b.textContent === '管理小组') as HTMLButtonElement).click()); expect(onManageTeams).toHaveBeenCalled();
});

it('falls back to a department icon container without initials when not in a group', () => {
  const entry = organizationEntry({ organization: org({ teams: [] }), department: '面料事业部', teamId: 'all', onSelect: vi.fn() });
  expect(entry).toMatchObject({ name: '面料事业部', caption: '当前部门' });
  const lead = show(entry.lead);
  expect(lead.querySelector('.mist-ws-dept svg')).not.toBeNull();
  expect(lead.textContent).toBe('');
});
