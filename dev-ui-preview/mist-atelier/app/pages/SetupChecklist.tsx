/**
 * fin9：新公司开户清单。按公司资料、部门、账号、业务分组、邮箱、银行账户、期初数据逐项判断，完成项不再显示；全部完成后整卡消失。
 * 只给公司管理员显示。账号数缺数据时不判为未完成；部门在人事模块维护，不在此列。
 */
import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Card, CardHeader, Checklist } from '../../../../components/mist';
import { uiText } from '../../../../services/interfaceLanguage';
import type { MistState } from '../../../../server/src/shared/mistWorkspace';

type Workspace = unknown;
type Go = (view: string, id?: string, target?: Record<string, string | undefined>) => void;
export function setupItems(state: MistState, _workspace?: Workspace) {
  const profile = state.settings.companyProfile, members = state.members?.length;
  return [
    { id: 'profile', label: '填写公司抬头与地址', done: !!profile?.legalName && !!profile?.address, go: ['settings', undefined, { section: 'company' }] as const },
    { id: 'accounts', label: '为同事开通账号并设岗位', done: members === undefined || members > 1, go: ['admin-panel', undefined, {}] as const },
    { id: 'groups', label: '设置成员业务分组（成衣 / 面料）', done: !state.members?.length || (state.memberGroups || []).some(g => g.groups.length), go: ['admin-panel', undefined, {}] as const },
    { id: 'mail', label: '接入公司邮箱', done: !!state.email?.accounts?.length, go: ['emails', undefined, {}] as const },
    { id: 'bank', label: '登记公司银行账户', done: !!state.bankAccounts?.length, go: ['payment-vouchers', undefined, { section: 'accounts' }] as const },
    { id: 'opening', label: '导入期初应收与应付', done: state.invoices.some(i => (i as { opening?: unknown }).opening) || state.invoices.length > 0 || (state.payables?.bills || []).length > 0, go: ['data-center', undefined, { section: 'import' }] as const },
  ];
}
export function SetupChecklist({ state, workspace, canAdmin, go }: { state: MistState; workspace: Workspace; canAdmin: boolean; go: Go }) {
  if (!canAdmin) return null;
  const items = setupItems(state, workspace), left = items.filter(i => !i.done);
  if (!left.length) return null;
  return <Card className="mist-section">
    <CardHeader title={uiText(`开户清单 · 还剩 ${left.length} 项`)} />
    <Checklist items={left.map(i => ({ label: uiText(i.label), done: false }))} onToggle={index => { const item = left[index]; if (item) go(item.go[0], item.go[1], { ...item.go[2] }); }} />
    {items.length - left.length > 0 && <div className="mist-card-body mist-note"><CheckCircle2 size={14} /> {uiText(`已完成 ${items.length - left.length} 项`)}</div>}
  </Card>;
}
