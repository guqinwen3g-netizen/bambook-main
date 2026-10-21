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
  expect(button('创建公司首次使用竹衍')).toBeTruthy();
  expect(button('加入公司公司已在使用竹衍')).toBeTruthy();
  await click('登录');
  expect(go).toHaveBeenCalledWith('login');
});

it('creates a company step by step and signs the new administrator in', async () => {
  api.registerCompany.mockResolvedValue({ company: { name: '雾织贸易', code: 'wuzhimaoyi' }, email: 'owner@example.test' });
  session.login.mockResolvedValue({ displayName: '沈霁' });
  await click('创建公司首次使用竹衍');
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
  await click('创建公司首次使用竹衍');
  await type(field('公司名称'), '雾织 贸易');
  await settle();
  expect(host.textContent).toContain('「雾织贸易」已在使用竹衍');
  await click('申请加入');
  expect(host.textContent).toContain('你的账号');
  expect(host.textContent).toContain('雾织贸易');
});

it('finds a company by name and submits a join request for it', async () => {
  api.searchRegistrationCompanies.mockResolvedValue([{ id: 'co-1', name: '雾织贸易', business: 'both' }, { id: 'co-2', name: '雾织纺织', business: null }]);
  api.registerJoinCompany.mockResolvedValue({ company: { name: '雾织贸易' }, email: 'owner@example.test' });
  await click('加入公司公司已在使用竹衍');
  await submit();
  expect(host.textContent).toContain('请选择你的公司');
  await type(host.querySelector('input[aria-label="公司名称"]') as HTMLInputElement, '雾织');
  await settle();
  expect(api.searchRegistrationCompanies.mock.calls.at(-1)?.[0]).toBe('雾织');
  await act(async () => (host.querySelector('[role="option"]') as HTMLButtonElement).click());
  await submit();
  expect(field('工作邮箱')).toBeTruthy();
  await fillAccount('工作邮箱');
  await submit();
  await enterCode('123456');
  expect(api.registerJoinCompany).toHaveBeenCalledWith({ companyId: 'co-1', displayName: '沈霁', email: 'owner@example.test', password: STRONG, code: '123456' });
  expect(host.textContent).toContain('申请已发送');
  expect(host.textContent).toContain('「雾织贸易」的管理员同意后');
});

it('shows a clear empty result and offers the company code instead', async () => {
  await click('加入公司公司已在使用竹衍');
  await type(host.querySelector('input[aria-label="公司名称"]') as HTMLInputElement, '不存在公司');
  await settle();
  expect(host.textContent).toContain('没有找到「不存在公司」');
  await click('公司代码');
  await type(field('公司代码'), 'wuzhimaoyi');
  await submit();
  expect(host.textContent).toContain('公司代码 wuzhimaoyi');
});

it('keeps the account step until the password meets every rule', async () => {
  await click('创建公司首次使用竹衍');
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
  await click('创建公司首次使用竹衍');
  await type(field('公司名称'), '雾织贸易');
  await click('面料');
  await submit();
  await fillAccount('联系邮箱');
  await submit();
  expect(host.textContent).toContain('60 秒后可重新发送');
  await enterCode('000000');
  expect(host.textContent).toContain('验证码错误或已过期');
  expect(host.textContent).toContain('验证邮箱');
  await settle(2000);
  expect(host.textContent).toContain('58 秒后可重新发送');
});
