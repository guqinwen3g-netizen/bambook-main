import { describe, expect, it } from 'vitest';
import { View } from '../../../types';
import { pageDocumentTitle } from './pageTitle';

describe('application page titles', () => {
  it.each([[View.Orders, '订单管理'], [View.Suppliers, '供应商管理'], [View.Products, '数字档案'], ['orders/new', '新建订单'], ['orders/detail', '订单详情']])('names the actual %s page with a stable brand and spacing', (view, label) => {
    expect(pageDocumentTitle(view)).toBe(`Bambook · ${label}`);
  });
  it('describes the login page rather than the protected URL when anonymous', () => {
    expect(pageDocumentTitle(View.Orders, { anonymous: true })).toBe('Bambook · 登录');
    expect(pageDocumentTitle('login')).toBe('Bambook · 登录');
    expect(pageDocumentTitle('register', { anonymous: true })).toBe('Bambook · 账户开通');
    expect(pageDocumentTitle('account-access', { anonymous: true, invitation: true })).toBe('Bambook · 设置登录密码');
  });
  it('distinguishes platform and company settings and mandatory password changes', () => {
    expect(pageDocumentTitle('system-settings', { platformOnly: true })).toBe('Bambook · 平台设置');
    expect(pageDocumentTitle('system-settings')).toBe('Bambook · 公司设置');
    expect(pageDocumentTitle(View.Orders, { mustChangePassword: true })).toBe('Bambook · 修改密码');
  });
  it('keeps the base brand while loading or when a route has no known label', () => {
    expect(pageDocumentTitle(View.Orders, { loading: true })).toBe('Bambook');
    expect(pageDocumentTitle('unknown-private-object')).toBe('Bambook');
  });
});
