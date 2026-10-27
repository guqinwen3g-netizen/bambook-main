/**
 * 基础资料批量导入：上线时把现有客户、供应商、产品档案一次录入全新公司。
 * 每一行按对应的单条保存命令执行（同样的校验、编码查重、负责人按账号核对）；
 * 整批要么全部导入，要么一行都不导入，并逐行列出不通过的原因。
 */
import { isServiceSupplier } from './mistSupplierStatus';
import type { MistMemberDirectoryEntry } from './mistAccounts';

export type MistImportKind = 'customer' | 'supplier' | 'product' | 'openingReceivable' | 'openingPayable';
export type MistImportRow = Record<string, string>;
export type MistImportField = { key: string; label: string; required?: boolean; hint?: string; example: string };

export const MIST_IMPORT_MAX_ROWS = 1000;
export const MIST_IMPORT_KIND_LABEL: Record<MistImportKind, string> = { customer: '客户', supplier: '供应商', product: '产品档案', openingReceivable: '期初应收', openingPayable: '期初应付' };

const contactFields: MistImportField[] = [
  { key: 'contactName', label: '联系人', example: 'Anna Berg' },
  { key: 'contactRole', label: '联系人岗位', example: 'Buyer' },
  { key: 'contactEmail', label: '联系人邮箱', example: 'anna@example.com' },
  { key: 'contactPhone', label: '联系人电话', example: '+46 8 123 456' },
];

export const MIST_IMPORT_FIELDS: Record<MistImportKind, MistImportField[]> = {
  customer: [
    { key: 'code', label: '客户编码', hint: '留空自动生成', example: '' },
    { key: 'name', label: '客户名称', required: true, example: 'Nordic Wear AB' },
    { key: 'country', label: '国家', example: '瑞典' },
    { key: 'city', label: '城市', example: '斯德哥尔摩' },
    { key: 'industry', label: '行业', example: '服装品牌' },
    { key: 'owner', label: '客户经理', hint: '填成员姓名；留空为导入人', example: '' },
    { key: 'grade', label: '等级', example: 'A' },
    { key: 'currency', label: '结算币种', required: true, hint: '三位字母，如 USD', example: 'USD' },
    { key: 'terms', label: '付款条款', example: 'T/T 30% 定金，70% 见提单副本' },
    { key: 'incoterm', label: '贸易术语', example: 'FOB' },
    { key: 'categories', label: '主要品类', example: '外套' },
    { key: 'since', label: '合作起始日', hint: 'YYYY-MM-DD', example: '2023-03-01' },
    { key: 'creditLimit', label: '信用额度', hint: '数字，留空为 0', example: '50000' },
    ...contactFields,
  ],
  supplier: [
    { key: 'code', label: '供应商编码', hint: '留空自动生成', example: '' },
    { key: 'name', label: '供应商名称', required: true, example: '江南成衣厂' },
    { key: 'type', label: '供应商类型', required: true, hint: '如 织造、印染、成衣、辅料', example: '成衣' },
    { key: 'country', label: '国家地区', example: '中国' },
    { key: 'address', label: '生产地址', example: '浙江省绍兴市' },
    { key: 'capabilities', label: '生产能力', example: '梭织外套、羽绒服' },
    { key: 'capacity', label: '月产能', hint: '数字', example: '20000' },
    { key: 'capacityUnit', label: '产能单位', example: '件/月' },
    { key: 'leadDays', label: '交付周期天', hint: '数字', example: '45' },
    { key: 'note', label: '备注', example: '' },
    ...contactFields,
  ],
  product: [
    { key: 'sku', label: '公司产品编码', required: true, example: 'FB-2026-001' },
    { key: 'name', label: '名称', required: true, example: '全棉府绸' },
    { key: 'category', label: '类别', required: true, hint: '成衣 / 面料 / 辅料', example: '面料' },
    { key: 'season', label: '季节', example: 'SS26' },
    { key: 'supplier', label: '供应商', hint: '填已导入的供应商编码或名称', example: 'SUP-001' },
    { key: 'supplierCode', label: '供应商货号', example: 'JN-8801' },
    { key: 'composition', label: '成分', example: '100% 棉' },
    { key: 'specification', label: '规格', example: '40x40 133x72 145cm' },
    { key: 'color', label: '颜色', example: '白' },
    { key: 'unit', label: '单位', required: true, example: '米' },
    { key: 'cost', label: '成本价', hint: '数字，留空为 0', example: '18.50' },
    { key: 'currency', label: '成本币种', hint: '留空为 CNY', example: 'CNY' },
    { key: 'refPrice', label: '参考售价', example: '3.20' },
    { key: 'note', label: '备注', example: '' },
  ],
  openingReceivable: [
    { key: 'customer', label: '客户', required: true, hint: '填已建档的客户编码或名称', example: 'CUS-2026-0001' },
    { key: 'reference', label: '原发票号', required: true, hint: '客户认得的原始发票/CI 号，不可重复', example: 'CI-2026-0815' },
    { key: 'issuedAt', label: '开票日期', required: true, hint: 'YYYY-MM-DD，不晚于今天', example: '2026-08-15' },
    { key: 'due', label: '到期日', required: true, hint: 'YYYY-MM-DD，不早于开票日期', example: '2026-10-14' },
    { key: 'currency', label: '币种', required: true, hint: '三位字母', example: 'USD' },
    { key: 'originalAmount', label: '票面金额', hint: '留空同未收余额', example: '48000' },
    { key: 'amount', label: '未收余额', required: true, hint: '截至启用日仍未收回的金额', example: '33600' },
    { key: 'note', label: '备注', example: '定金已收 30%' },
  ],
  openingPayable: [
    { key: 'supplier', label: '供应商', required: true, hint: '填已建档的供应商编码或名称', example: 'SUP-001' },
    { key: 'invoiceNo', label: '供应商发票号', required: true, hint: '同一供应商不可重复', example: '33012026-00881' },
    { key: 'invoiceDate', label: '发票日期', required: true, hint: 'YYYY-MM-DD，不晚于今天', example: '2026-09-05' },
    { key: 'due', label: '到期日', required: true, hint: 'YYYY-MM-DD，不早于发票日期', example: '2026-10-05' },
    { key: 'currency', label: '币种', required: true, hint: '三位字母', example: 'CNY' },
    { key: 'originalAmount', label: '价税合计', hint: '留空同未付余额', example: '113000' },
    { key: 'taxAmount', label: '税额', hint: '专票税额，留空为 0', example: '13000' },
    { key: 'amount', label: '未付余额', required: true, hint: '截至启用日仍未付的金额', example: '60000' },
    { key: 'note', label: '备注', example: '已付 53000' },
  ],
};

/** 表头（中文名或字段键）→ 字段键；忽略首尾空格、星号与全角括号说明。 */
export function mistImportHeaderKey(kind: MistImportKind, header: string): string | undefined {
  const clean = String(header ?? '').replace(/[*＊]/g, '').replace(/[（(].*[)）]$/, '').trim();
  return MIST_IMPORT_FIELDS[kind].find(f => f.label === clean || f.key === clean)?.key;
}

type Command = { type: string; payload: any };
type Ctx = { members?: MistMemberDirectoryEntry[]; actorId?: string };
type Market = { suppliers: Array<{ id: string; code: string; name: string }> };

export const text = (row: MistImportRow, key: string) => String(row[key] ?? '').trim();
function num(value: string, label: string, integer = false): number {
  if (!value) return 0;
  const v = value.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(v) || (integer && !/^\d+$/.test(v))) throw new Error(`${label}须为${integer ? '非负整数' : '非负数字'}`);
  return Number(v);
}
export function mistImportDate(value: string, label: string): string {
  if (!value) return '';
  const v = value.replace(/[./]/g, '-').replace(/-(\d)(?=-|$)/g, '-0$1');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${label}须为 YYYY-MM-DD`);
  return v;
}
function owner(ctx: Ctx, value: string): string {
  if (!value) { if (!ctx.actorId) throw new Error('无法确定客户经理'); return ctx.actorId; }
  const members = ctx.members || [];
  const byId = members.find(m => m.id === value);
  if (byId) return byId.id;
  const named = members.filter(m => m.name === value);
  if (named.length === 1) return named[0].id;
  if (named.length > 1) throw new Error(`客户经理“${value}”有重名成员，请改填账号`);
  throw new Error(`客户经理“${value}”不是本公司成员`);
}
const CATEGORY: Record<string, 'garment' | 'fabric' | 'trimming'> = { 成衣: 'garment', 服装: 'garment', garment: 'garment', 面料: 'fabric', fabric: 'fabric', 辅料: 'trimming', trimming: 'trimming', trim: 'trimming' };

function contact(kind: 'customer' | 'supplier', row: MistImportRow): Omit<Command['payload'], 'parentId'> | null {
  const name = text(row, 'contactName'), email = text(row, 'contactEmail'), phone = text(row, 'contactPhone'), role = text(row, 'contactRole');
  if (!name) { if (email || phone || role) throw new Error('填写了联系方式但缺少联系人姓名'); return null; }
  return { kind, name, role, email, phone, primary: true };
}

/** 把一行导入资料转成单条保存命令（不执行）。 */
export function mistImportRowCommand(kind: MistImportKind, row: MistImportRow, ctx: Ctx, market: Market): { command: Command; contact: ReturnType<typeof contact> } {
  if (kind === 'customer') {
    return { command: { type: 'market.customer.create', payload: { input: {
      code: text(row, 'code'), name: text(row, 'name'), country: text(row, 'country'), city: text(row, 'city'), industry: text(row, 'industry'),
      ownerId: owner(ctx, text(row, 'owner')), grade: text(row, 'grade'), currency: text(row, 'currency').toUpperCase(), terms: text(row, 'terms'),
      incoterm: text(row, 'incoterm').toUpperCase(), categories: text(row, 'categories'), since: mistImportDate(text(row, 'since'), '合作起始日'), creditLimit: num(text(row, 'creditLimit'), '信用额度'),
    } } }, contact: contact('customer', row) };
  }
  if (kind === 'supplier') {
    const service=isServiceSupplier({type:text(row,'type')});
    return { command: { type: 'market.supplier.save', payload: { input: {
      code: text(row, 'code'), name: text(row, 'name'), type: text(row, 'type'), country: text(row, 'country'), address: text(row, 'address'),
      capabilities: text(row, 'capabilities'), capacity: service?0:num(text(row, 'capacity'), '月产能'), capacityUnit: service?'':text(row, 'capacityUnit'), leadDays: service?0:num(text(row, 'leadDays'), '交付周期天', true),
      note: text(row, 'note'), fileIds: [],
    } } }, contact: contact('supplier', row) };
  }
  const categoryText = text(row, 'category'), category = CATEGORY[categoryText.toLowerCase()] || CATEGORY[categoryText];
  if (!category) throw new Error('类别须为 成衣 / 面料 / 辅料');
  const supplierText = text(row, 'supplier');
  let supplierId = '';
  if (supplierText) {
    const lower = supplierText.toLowerCase();
    const hit = market.suppliers.find(s => s.code.toLowerCase() === lower) || market.suppliers.filter(s => s.name === supplierText).at(0);
    if (!hit) throw new Error(`供应商“${supplierText}”不存在，请先导入供应商`);
    supplierId = hit.id;
  }
  const cost = text(row, 'cost').replace(/,/g, '') || '0', refPrice = text(row, 'refPrice').replace(/,/g, '');
  return { command: { type: 'market.product.save', payload: { input: {
    sku: text(row, 'sku'), name: text(row, 'name'), category, season: text(row, 'season').toUpperCase(), supplierId, supplierCode: text(row, 'supplierCode'),
    composition: text(row, 'composition'), specification: text(row, 'specification'), color: text(row, 'color'), unit: text(row, 'unit'),
    cost, currency: (text(row, 'currency') || 'CNY').toUpperCase(), ...(refPrice ? { refPrice } : {}), sourceDevId: '', sourceVersionId: '', fileIds: [], note: text(row, 'note'),
  } } }, contact: null };
}

export function mistImportPermission(kind: unknown): string {
  if (kind === 'customer') return 'relations:write';
  if (kind === 'openingReceivable' || kind === 'openingPayable') return 'invoices:write';
  if (kind === 'supplier') return 'suppliers:write';
  if (kind === 'product') return 'products:write';
  throw new Error('导入类型无效');
}

/** 逐行执行 handle；任何一行不通过则抛出汇总错误（调用方的事务不提交，整批不生效）。 */
export function mistImportEach(kind: MistImportKind, rows: unknown, handle: (row: MistImportRow) => void, fail: (message: string) => never) {
  if (!MIST_IMPORT_FIELDS[kind]) fail('导入类型无效');
  if (!Array.isArray(rows) || !rows.length) fail('导入文件没有数据行');
  if ((rows as unknown[]).length > MIST_IMPORT_MAX_ROWS) fail(`一次最多导入 ${MIST_IMPORT_MAX_ROWS} 行，请分批`);
  const problems: string[] = [];
  let imported = 0;
  (rows as unknown[]).forEach((raw, index) => {
    const declared = raw && typeof raw === 'object' ? Number((raw as Record<string, unknown>).__row) : NaN;
    const line = Number.isInteger(declared) && declared > 1 ? declared : index + 2;
    try {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('行格式无效');
      const row = Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'string' ? v : v == null ? '' : String(v)]));
      const missing = MIST_IMPORT_FIELDS[kind].filter(f => f.required && !(kind==='supplier' && isServiceSupplier({type:text(row,'type')}) && ['capacity','capacityUnit','leadDays'].includes(f.key)) && !text(row, f.key)).map(f => f.label);
      if (missing.length) throw new Error(missing.join('、') + '未填写');
      handle(row);
      imported++;
    } catch (error) {
      problems.push(`第 ${line} 行：${error instanceof Error ? error.message : String(error)}`);
    }
  });
  if (problems.length) fail(`导入未执行，共 ${problems.length} 行不通过（行号按表格计，第 1 行为表头）：\n${problems.slice(0, 30).join('\n')}${problems.length > 30 ? `\n……另有 ${problems.length - 30} 行` : ''}`);
  return { imported };
}

/** 客户 / 供应商 / 产品：每行按单条市场保存命令执行。run 执行单条市场命令并返回其结果。 */
export function mistImportRun(kind: MistImportKind, rows: unknown, ctx: Ctx, market: Market, run: (command: Command) => { id?: string; customerId?: string }, fail: (message: string) => never) {
  if (!['customer', 'supplier', 'product'].includes(kind)) fail('导入类型无效');
  return mistImportEach(kind, rows, row => {
    const { command, contact: person } = mistImportRowCommand(kind, row, ctx, market);
    const result = run(command);
    const parentId = kind === 'customer' ? result.customerId : result.id;
    if (person && parentId) run({ type: 'market.contact.save', payload: { ...person, parentId } });
  }, fail);
}
