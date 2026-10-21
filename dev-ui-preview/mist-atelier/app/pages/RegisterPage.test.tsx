// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Nav } from '../nav';

const api = vi.hoisted(() => ({ registerCompany: vi.fn(), registerJoinCompany: vi.fn(), sendVerificationCode: vi.fn() }));
vi.mock('../../../../services/authService', () => api);
import { RegisterPage } from './RegisterPage';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, host: HTMLDivElement;
const go = vi.fn();
const button = (name: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === name || b.textContent?.trim().startsWith(name)) as HTMLButtonElement | undefined;
async function click(name: string) { const b = button(name); expect(b, name).toBeTruthy(); await act(async () => b!.click()); }
async function fill(label: string, value: string) {
  const field = [...host.querySelectorAll('label.mist-field')].find(l => l.querySelector('.mist-field-label')?.textContent === label)!;
  const input = field.querySelector('input') as HTMLInputElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function submit() { await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
const STRONG = 'Bamboo2026secure';

beforeEach(async () => {
  for (const fn of Object.values(api)) fn.mockReset();
  go.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<Nav.Provider value={{ route: { view: 'register' }, go, theme: 'light', toggleTheme: vi.fn(), openPalette: vi.fn(), openAI: vi.fn() } as any}><RegisterPage /></Nav.Provider>));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); vi.useRealTimers(); });

async function fillAccount() { await fill('你的姓名', '沈霁'); await fill('工作邮箱', 'owner@example.test'); await fill('邮箱验证码', '123456'); await fill('设置密码', STRONG); }

it('offers both ways to register and a way back to login', async () => {
  expect(host.textContent).toContain('创建公司');
  expect(host.textContent).toContain('加入公司');
  await click('返回登录');
  expect(go).toHaveBeenCalledWith('login');
});

it('creates a company with its administrator and shows the company code', async () => {
  api.registerCompany.mockResolvedValue({ company: { name: '雾织贸易', code: 'wuzhimaoyi' }, email: 'owner@example.test' });
  await click('创建公司');
  await fill('公司名称', '雾织贸易');
  await fillAccount();
  await submit();
  expect(api.registerCompany).toHaveBeenCalledWith({ companyName: '雾织贸易', displayName: '沈霁', email: 'owner@example.test', password: STRONG, code: '123456' });
  expect(host.textContent).toContain('公司已创建');
  expect(host.textContent).toContain('wuzhimaoyi');
  await click('登录');
  expect(go).toHaveBeenCalledWith('login', 'owner@example.test');
});

it('submits a join request with the company code', async () => {
  api.registerJoinCompany.mockResolvedValue({ company: { name: '雾织贸易' }, email: 'owner@example.test' });
  await click('加入公司');
  await fill('公司代码', 'wuzhimaoyi');
  await fillAccount();
  await submit();
  expect(api.registerJoinCompany).toHaveBeenCalledWith({ companyCode: 'wuzhimaoyi', displayName: '沈霁', email: 'owner@example.test', password: STRONG, code: '123456' });
  expect(host.textContent).toContain('申请已提交');
  expect(host.textContent).toContain('雾织贸易');
});

it('checks the form before calling the server', async () => {
  await click('创建公司');
  await submit();
  expect(host.textContent).toContain('请填写公司名称');
  await fill('公司名称', '雾织贸易');
  await fillAccount();
  await fill('设置密码', 'short1');
  await submit();
  expect(host.textContent).toContain('至少 12 个字符');
  expect(api.registerCompany).not.toHaveBeenCalled();
});

it('sends an email code and counts down before it can be resent', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  api.sendVerificationCode.mockResolvedValue({ message: 'ok', cooldownMs: 60000, transport: 'smtp' });
  await click('加入公司');
  await click('获取验证码');
  expect(host.textContent).toContain('请先填写正确的工作邮箱');
  expect(api.sendVerificationCode).not.toHaveBeenCalled();
  await fill('工作邮箱', 'staff@example.test');
  await click('获取验证码');
  expect(api.sendVerificationCode).toHaveBeenCalledWith('staff@example.test', 'register');
  expect(button('60 秒后重发')?.disabled).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(button('58 秒后重发')).toBeTruthy();
});

it('shows the server message and keeps the form when registration fails', async () => {
  api.registerJoinCompany.mockRejectedValue(new Error('没有找到这个公司代码，或该公司暂停使用。请向公司管理员核对。'));
  await click('加入公司');
  await fill('公司代码', 'nope-co');
  await fillAccount();
  await submit();
  expect(host.textContent).toContain('没有找到这个公司代码');
  expect(host.textContent).toContain('提交加入申请');
});
