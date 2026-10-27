/**
 * 岗位权限的展示分组：按业务模块把权限码归成「查看 / 办理 / 审批」三档，其余专项权限挂在所属模块下。
 * 只是编辑界面的组织方式；授权真源仍是岗位实际持有的权限码（服务端 rolePermissionMatrix 与 Role 表）。
 */
export type JobLevel = 'none' | 'read' | 'write' | 'approve';
export type JobModule = { key: string; label: string; read: string[]; write: string[]; approve: string[]; extra: string[] };
export type JobArea = { label: string; modules: JobModule[] };

const m = (key: string, label: string, read: string[], write: string[] = [], approve: string[] = [], extra: string[] = []): JobModule => ({ key, label, read, write, approve, extra });

export const JOB_AREAS: JobArea[] = [
  { label: '基础', modules: [
    m('workspace', '首页与个人设置', ['cockpit:read', 'dashboard:read', 'settings:account'], [], [], ['tools:execute']),
    m('ai', 'AI 助手', ['ai:chat'], ['ai:write:low', 'ai:write:medium'], ['ai:write:high', 'agent:approvals:approve']),
  ] },
  { label: '客户与市场', modules: [
    m('relations', '客户与联系人', ['relations:read'], ['relations:write', 'relations:delete'], ['relations:admin']),
    m('crm', '客户跟进', ['crm:read'], ['crm:write']),
    m('suppliers', '供应商', ['suppliers:read'], ['suppliers:write'], ['suppliers:admin']),
    m('seasons', '季节与趋势', ['seasons:read'], ['seasons:write']),
    m('marketing', '营销推广', ['marketing:read'], ['marketing:write']),
    m('emails', '智能邮箱', ['emails:read'], ['emails:write'], ['emails:admin'], ['emails:maintenance:write']),
  ] },
  { label: '订单履约', modules: [
    m('products', '开发、样品与产品档案', ['products:read'], ['products:write'], [], ['sample:early_production:write', 'sample:shipment:write', 'sample:color_batch:write', 'sample:room:write']),
    m('quotations', '报价', ['quotations:read'], ['quotations:write', 'quotations:convert'], ['quotations:approve']),
    m('orders', '订单', ['orders:read'], ['orders:write', 'orders:delete'], ['orders:approve:change_delivery', 'orders:approve:change_qty', 'orders:approve:change_price', 'orders:approve:cancel'],
      ['order:change_request:create', 'order:change_request:apply', 'order:internal_trade:write', 'moq:line_override', 'moq:capsule_exemption:write', 'exception:dr013:create']),
    m('procurement', '采购与加工', ['procurement:read'], ['procurement:write'], ['procurement:approve']),
    m('production', '生产进度', ['production:read'], ['production:write'], [], ['production:pp_release:business_sign', 'production:pp_release:production_sign', 'production:pp_release:admin']),
    m('qc', '质检', ['qc:read'], ['qc:write'], [], ['qc:inspect', 'qc:fabric_chain:write', 'qc:garment_chain:write']),
    m('inventory', '库存与仓储', ['inventory:read'], ['inventory:write']),
    m('shipments', '出运与装箱', ['shipments:read'], ['shipments:write'], ['shipments:approve'], ['logistics:handle']),
    m('customs', '报关与单证', ['customs:read'], ['customs:write'], ['customs:admin'], ['customs:clear']),
  ] },
  { label: '财务与成本', modules: [
    m('finance', '收付款与票据', ['finance:read', 'invoices:read', 'vouchers:read'], ['invoices:write', 'vouchers:write', 'invoices:reconcile', 'invoices:suggest_match'],
      ['invoices:approve:writeoff', 'vouchers:approve:pay_lt5', 'vouchers:approve:pay_gt5', 'vouchers:approve:pay_new_supplier', 'finance:payment_request:approve'], ['finance:payment_request:create']),
    m('tax', '税务、退税与汇兑', ['vat:read', 'tax:read', 'remit:read'], ['vat:write', 'tax:write', 'remit:write'], ['tax:approve'], ['fx:lock']),
    m('bom', '成本核算', ['bom:read'], ['bom:write'], ['bom:admin']),
    m('pricing', '定价', ['pricing:read'], ['pricing:write'], ['pricing:admin']),
    m('reports', '报表与毛利', ['reports:read'], ['reports:write'], ['reports:admin']),
    m('sensitive', '敏感字段', [], [], [], ['sensitive:cost', 'sensitive:profit', 'sensitive:commission', 'sensitive:tax_base', 'sensitive:salary']),
  ] },
  { label: '风险与售后', modules: [
    m('risk', '风险与合规', ['risk:read'], ['risk:write'], ['risk:admin'], ['credit:freeze:write', 'credit:thaw:write']),
    m('aftersales', '售后索赔', ['aftersales:read'], ['aftersales:write'], ['aftersales:approve']),
    m('knowledge', '资料库', ['knowledge:read'], ['knowledge:write'], ['knowledge:approve', 'knowledge:admin']),
  ] },
  { label: '公司管理', modules: [
    m('hr', '人事与组织', ['hr:read'], ['hr:write'], [], ['hr:salary:read']),
    m('users', '账号与岗位', ['users:read'], ['users:write'], ['users:admin']),
    m('settings', '公司设置', ['settings:system:read'], ['dictionary:write', 'settings:moq:write', 'settings:tolerance:write', 'settings:automation:write']),
    m('audit', '审计记录', ['audit:read'], [], [], ['audit:export']),
    m('data', '数据导入导出', [], [], [], ['data:import', 'data:export:full', 'business:delete']),
  ] },
];
export const JOB_MODULES = JOB_AREAS.flatMap(area => area.modules);

const scopesUpTo = (module: JobModule, level: JobLevel) =>
  level === 'none' ? [] : level === 'read' ? module.read : level === 'write' ? [...module.read, ...module.write] : [...module.read, ...module.write, ...module.approve];
export const levelsOf = (module: JobModule): JobLevel[] => ['none', ...(module.read.length ? ['read' as const] : []), ...(module.write.length ? ['write' as const] : []), ...(module.approve.length ? ['approve' as const] : [])];

/** 模块当前档位：完整持有的最高一档；持有部分权限但凑不齐任一档时为 partial。 */
export function moduleLevel(module: JobModule, granted: readonly string[]): JobLevel | 'partial' {
  const has = new Set(granted), main = [...module.read, ...module.write, ...module.approve];
  const top = [...levelsOf(module)].reverse().find(level => level !== 'none' && scopesUpTo(module, level).every(scope => has.has(scope)));
  const level = top ?? 'none', extraMain = main.filter(scope => has.has(scope) && !scopesUpTo(module, level).includes(scope));
  return extraMain.length ? 'partial' : level;
}
/** 把模块设到某一档：先移除本模块三档权限，再加上该档所需权限；专项权限保持不变。 */
export function setModuleLevel(module: JobModule, granted: readonly string[], level: JobLevel): string[] {
  const main = new Set([...module.read, ...module.write, ...module.approve]);
  return [...new Set([...granted.filter(scope => !main.has(scope)), ...scopesUpTo(module, level)])];
}

/** 写权限还要求任职部门具备相应业务属性（与服务端 departmentAuthorization 同口径）。 */
export const DEPARTMENT_GATES: Array<{ scopes: string[]; attributes: string[]; label: string }> = [
  { scopes: ['orders:write', 'orders:delete', 'products:write'], attributes: ['fabric_business', 'garment_business'], label: '面料业务或成衣业务' },
  { scopes: ['qc:inspect'], attributes: ['fabric_qc', 'garment_qc'], label: '面料 QC 或成衣 QC' },
  { scopes: ['shipments:write', 'customs:write', 'customs:clear', 'logistics:handle'], attributes: ['logistics'], label: '后勤单证' },
  { scopes: ['invoices:write', 'vouchers:write'], attributes: ['finance'], label: '财务' },
];
export const moduleGate = (module: JobModule, granted: readonly string[]) =>
  DEPARTMENT_GATES.find(gate => gate.scopes.some(scope => granted.includes(scope) && [...module.write, ...module.extra].includes(scope)))?.label;

type Levels = Partial<Record<string, JobLevel>>;
const build = (levels: Levels, extra: string[] = []) => [...new Set([...JOB_MODULES.flatMap(module => scopesUpTo(module, levels[module.key] ?? 'none')), ...extra])];
const BASICS: Levels = { workspace: 'read', ai: 'read' };
const VIEW_ALL: Levels = Object.fromEntries(JOB_MODULES.filter(module => module.read.length && !['hr', 'users', 'settings', 'audit'].includes(module.key)).map(module => [module.key, 'read']));

/** 新建岗位时可参照的外贸服装公司常见岗位；只是起点，保存的是勾选后的权限。 */
export const JOB_TEMPLATES: Array<{ id: string; name: string; permissions: string[] }> = [
  { id: 'merchandiser', name: '跟单员', permissions: build({ ...BASICS, relations: 'read', crm: 'read', suppliers: 'read', emails: 'write', products: 'write', quotations: 'read', orders: 'write', procurement: 'write', production: 'write', qc: 'read', inventory: 'write', shipments: 'read', customs: 'read', finance: 'read', aftersales: 'write', knowledge: 'read' }, ['order:change_request:create', 'finance:payment_request:create']) },
  { id: 'documents', name: '单证报关', permissions: build({ ...BASICS, relations: 'read', suppliers: 'read', emails: 'write', orders: 'read', procurement: 'read', production: 'read', inventory: 'read', shipments: 'write', customs: 'write', finance: 'read', tax: 'read', knowledge: 'read' }, ['logistics:handle', 'customs:clear']) },
  { id: 'cashier', name: '出纳', permissions: build({ ...BASICS, relations: 'read', suppliers: 'read', orders: 'read', procurement: 'read', finance: 'write', tax: 'read' }) },
  { id: 'accountant', name: '会计', permissions: build({ ...BASICS, relations: 'read', suppliers: 'read', orders: 'read', procurement: 'read', shipments: 'read', customs: 'read', finance: 'write', tax: 'write', bom: 'read', reports: 'read' }, ['fx:lock']) },
  { id: 'hr-admin', name: '人事行政', permissions: build({ ...BASICS, emails: 'write', hr: 'write', users: 'read', knowledge: 'read' }) },
  { id: 'viewer', name: '只读查看', permissions: build({ ...VIEW_ALL }) },
];
