// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Nav } from '../nav';

const api = vi.hoisted(() => ({ registerCompany: vi.fn(), registerJoinCompany: vi.fn(), sendVerificationCode: vi.fn(), searchRegistrationCompanies: vi.fn() }));
const session = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock('../../../../services/authService', () => api);
vi.mock('../runtime/auth', () => ({ useMistSession: () => session }));
import { RegisterPage } from './RegisterPage';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, host: HTMLDivElement;
const go = vi.fn();
const STRONG = 'Bamboo2026secure';
const button = (name: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === name) as HTMLButtonElement | undefined;
async function click(name: string) { const b = button(name); expect(b, name).toBeTruthy(); await act(async () => b!.click()); }
async function type(input: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
const field = (label: string) => [...host.querySelectorAll('label.mist-field')].find(l => l.querySelector('.mist-field-label')?.textContent === label)!.querySelector('input') as HTMLInputElement;
async function submit() { await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
async function settle(ms = 300) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function fillAccount(emailLabel: string) { await type(field('姓名'), '沈霁'); await type(field(emailLabel), 'owner@example.test'); await type(field('设置密码'), STRONG); }
async function enterCode(code: string) { const first = host.querySelector('.mist-code input') as HTMLInputElement; await type(first, code); }

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  for (const fn of [...Object.values(api), session.login]) fn.mockReset();
  api.sendVerificationCode.mockResolvedValue({ message: 'ok', cooldownMs: 60000, transport: 'smtp' });
  api.searchRegistrationCompanies.mockResolvedValue([]);
  go.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<Nav.Provider value={{ route: { view: 'register' }, go, theme: 'light', toggleTheme: vi.fn(), openPalette: vi.fn(), openAI: vi.fn() } as any}><RegisterPage /></Nav.Provider>));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); vi.useRealTimers(); });

it('starts with two short choices and a way back to login', async () => {
  expect(button('开通公司账户负责人或授权管理员办理')).toBeTruthy();
  expect(button('申请加入公司员工申请，需公司管理员审核')).toBeTruthy();
  await click('返回登录');
  expect(go).toHaveBeenCalledWith('login');
});

it('creates a company step by step and signs the new administrator in', async () => {
  api.registerCompany.mockResolvedValue({ company: { name: '雾织贸易', code: 'wuzhimaoyi' }, email: 'owner@example.test' });
  session.login.mockResolvedValue({ displayName: '沈霁' });
  await click('开通公司账户负责人或授权管理员办理');
  await submit();
  expect(host.textContent).toContain('请填写公司名称');
  await type(field('公司名称'), '雾织贸易');
  await submit();
  expect(host.textContent).toContain('请选择主营业务');
  await click('面料与成衣');
  await click('21–100 人');
  await submit();
  expect(host.textContent).toContain('管理员账号');
  expect(field('联系邮箱')).toBeTruthy();
  await fillAccount('联系邮箱');
  await submit();
  expect(api.sendVerificationCode).toHaveBeenCalledWith('owner@example.test', 'register');
  expect(host.textContent).toContain('验证码已发送至 owner@example.test');
  await enterCode('381406');
  expect(api.registerCompany).toHaveBeenCalledWith({ companyName: '雾织贸易', business: 'both', size: '21-100', displayName: '沈霁', email: 'owner@example.test', password: STRONG, code: '381406' });
  expect(session.login).toHaveBeenCalledWith('owner@example.test', STRONG, { remember: true });
  expect(go).toHaveBeenCalledWith('cockpit');
});

it('points to the existing company when the name is already in use', async () => {
  api.searchRegistrationCompanies.mockResolvedValue([{ id: 'co-1', name: '雾织贸易', business: 'both' }]);
  await click('开通公司账户负责人或授权管理员办理');
  await type(field('公司名称'), ' 雾织贸易 ');
  await settle(200);
  expect(api.searchRegistrationCompanies).not.toHaveBeenCalled();
  await settle();
  expect(host.textContent).toContain('「雾织贸易」已开通公司账户');
  await click('申请加入');
  expect(host.textContent).toContain('申请人信息');
  expect(host.textContent).toContain('雾织贸易');
});

it('finds a company by name and submits a join request for it', async () => {
  api.searchRegistrationCompanies.mockResolvedValue([{ id: 'co-1', name: '雾织贸易', business: 'both' }, { id: 'co-2', name: '雾织纺织', business: null }]);
  api.registerJoinCompany.mockResolvedValue({ company: { name: '雾织贸易' }, email: 'owner@example.test' });
  await click('申请加入公司员工申请，需公司管理员审核');
  await submit();
  expect(host.textContent).toContain('请填写公司名称');
  await type(field('公司名称'), '雾织贸易');
  await settle(200);
  expect(api.searchRegistrationCompanies).not.toHaveBeenCalled();
  await settle();
  expect(api.searchRegistrationCompanies.mock.calls.at(-1)?.[0]).toBe('雾织贸易');
  expect(host.textContent).not.toContain('雾织纺织');
  await act(async () => (host.querySelector('[role="option"]') as HTMLButtonElement).click());
  await submit();
  expect(field('工作邮箱')).toBeTruthy();
  await fillAccount('工作邮箱');
  await submit();
  await enterCode('123456');
  expect(api.registerJoinCompany).toHaveBeenCalledWith({ companyId: 'co-1', displayName: '沈霁', email: 'owner@example.test', password: STRONG, code: '123456' });
  expect(host.textContent).toContain('申请已提交');
  expect(host.textContent).toContain('待「雾织贸易」管理员审核通过后');
});

it('shows a clear empty result and offers the company code instead', async () => {
  await click('申请加入公司员工申请，需公司管理员审核');
  await type(field('公司名称'), '不存在公司');
  await submit();
  await settle();
  expect(host.textContent).toContain('暂未确认公司');
  await click('使用公司代码');
  await type(field('公司代码'), 'wuzhimaoyi');
  await submit();
  expect(host.textContent).toContain('公司代码 wuzhimaoyi');
});

it('clears the previous selection when edited and automatically checks the new name', async () => {
  api.searchRegistrationCompanies.mockResolvedValue([{ id: 'co-1', name: '雾织贸易', business: null }]);
  await click('申请加入公司员工申请，需公司管理员审核');
  await type(field('公司名称'), '雾织贸易');
  await settle();
  await act(async () => (host.querySelector('[role="option"]') as HTMLButtonElement).click());
  await type(field('公司名称'), '雾织X'); await settle();
  expect(host.querySelector('[role="option"]')).toBeNull();
  expect(api.searchRegistrationCompanies).toHaveBeenCalledTimes(2);
  expect(button('下一步')?.disabled).toBe(true);
  expect(host.querySelector('[role="option"]')).toBeNull();
});

it('can retry a failed exact-name check without changing the company name', async () => {
  api.searchRegistrationCompanies.mockRejectedValueOnce(new Error('连接失败')).mockResolvedValueOnce([{ id: 'co-1', name: '雾织贸易', business: null }]);
  await click('申请加入公司员工申请，需公司管理员审核');
  await type(field('公司名称'), '雾织贸易');
  await settle();
  expect(host.textContent).toContain('连接失败');
  await click('重试'); await settle();
  expect(host.querySelector('[role="option"]')?.textContent).toContain('雾织贸易');
  expect(api.searchRegistrationCompanies).toHaveBeenCalledTimes(2);
});

it('shows one bounded prefix match automatically, but suppresses ambiguous candidates', async () => {
  api.searchRegistrationCompanies.mockResolvedValueOnce([{ id: 'co-1', name: '雾织贸易', business: null }]).mockResolvedValueOnce([{ id: 'co-1', name: '雾织贸易', business: null }, { id: 'co-2', name: '雾织科技', business: null }]);
  await click('申请加入公司员工申请，需公司管理员审核');
  await type(field('公司名称'), '雾织'); await settle();
  expect(host.querySelector('[role="option"]')?.textContent).toContain('雾织贸易');
  await type(field('公司名称'), '雾织科'); await settle();
  // A stale / overbroad response still cannot create a client-side tenant list.
  expect(host.querySelectorAll('[role="option"]')).toHaveLength(1);
  expect(host.textContent).not.toContain('雾织贸易');
  api.searchRegistrationCompanies.mockResolvedValueOnce([{ id: 'co-1', name: '雾织贸易', business: null }, { id: 'co-2', name: '雾织科技', business: null }]);
  await type(field('公司名称'), '雾织'); await settle();
  expect(host.querySelector('[role="option"]')).toBeNull();
});

it('never flashes an empty match while pending and keeps a settled result without repeat queries', async () => {
  let resolve!: (rows: unknown[]) => void;
  api.searchRegistrationCompanies.mockReturnValue(new Promise(r => { resolve = r; }));
  await click('申请加入公司员工申请，需公司管理员审核');
  await type(field('公司名称'), '雾织贸易');
  expect(host.textContent).not.toContain('暂未确认');
  await settle();
  expect(host.textContent).toContain('核对中');
  expect(host.textContent).not.toContain('暂未确认');
  await act(async () => resolve([{ id: 'co-1', name: '雾织贸易', business: null }]));
  await settle(2000);
  expect(host.querySelector('[role="option"]')?.textContent).toContain('雾织贸易');
  expect(api.searchRegistrationCompanies).toHaveBeenCalledTimes(1);
});

it('ignores a stale response and keeps the current no-match result visible', async () => {
  let resolve!: (rows: unknown[]) => void;
  api.searchRegistrationCompanies.mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValueOnce([]);
  await click('申请加入公司员工申请，需公司管理员审核');
  await type(field('公司名称'), '雾织贸易'); await settle();
  await type(field('公司名称'), '未开通公司'); await settle();
  await act(async () => resolve([{ id: 'co-1', name: '雾织贸易', business: null }]));
  await settle(2000);
  expect(host.querySelector('[role="option"]')).toBeNull();
  expect(host.textContent).toContain('暂未确认公司');
  expect(api.searchRegistrationCompanies).toHaveBeenCalledTimes(2);
});

it('waits for Chinese composition to finish before checking the full name', async () => {
  await click('申请加入公司员工申请，需公司管理员审核');
  await act(async () => field('公司名称').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await type(field('公司名称'), '雾织'); await settle();
  expect(api.searchRegistrationCompanies).not.toHaveBeenCalled();
  await type(field('公司名称'), '雾织贸易');
  await act(async () => field('公司名称').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await settle();
  expect(api.searchRegistrationCompanies).toHaveBeenCalledTimes(1);
  expect(api.searchRegistrationCompanies.mock.calls[0][0]).toBe('雾织贸易');
});

it('keeps the account step until the password meets every rule', async () => {
  await click('开通公司账户负责人或授权管理员办理');
  await type(field('公司名称'), '雾织贸易');
  await click('面料');
  await submit();
  await type(field('姓名'), '沈霁'); await type(field('联系邮箱'), 'owner@example.test'); await type(field('设置密码'), 'onlyletters');
  expect(host.querySelectorAll('.mist-register-checks [data-ok]')).toHaveLength(2);
  await submit();
  expect(host.textContent).toContain('密码未满足要求');
  expect(api.sendVerificationCode).not.toHaveBeenCalled();
});

it('keeps the code step on a server error and counts down before resending', async () => {
  api.registerCompany.mockRejectedValue(new Error('验证码错误或已过期'));
  await click('开通公司账户负责人或授权管理员办理');
  await type(field('公司名称'), '雾织贸易');
  await click('面料');
  await submit();
  await fillAccount('联系邮箱');
  await submit();
  expect(host.textContent).toContain('60 秒后可重新发送');
  await enterCode('000000');
  expect(host.textContent).toContain('验证码错误或已过期');
  expect(host.textContent).toContain('邮箱验证');
  await settle(2000);
  expect(host.textContent).toContain('58 秒后可重新发送');
});
