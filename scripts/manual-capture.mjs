#!/usr/bin/env node
/**
 * 从本地真实 Mist 界面采集教学素材：每一步截一张高清图，并记下要点击 / 填写的控件位置。
 *
 *   npm run dev:mist                     # 先启动本地独立服务（演示种子，不连公司库或共享服务器）
 *   node scripts/manual-capture.mjs chain        # 整条付款链（需先重置本地数据），或逐课：settlement 等
 *   node scripts/manual-capture.mjs order-chain  # 报价 → 订单（需先重置本地数据）
 *
 * 产物：wiki/assets/lessons/<课程>/NN.webp + capture.json（入库，供 wiki:build 生成引导式演示）。
 * 只允许连接 127.0.0.1 的本地服务；采集会在本地工作区真实执行一遍操作，重采前先重置本地数据。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://127.0.0.1:3001';
const VIEWPORT = { width: 1440, height: 900 };

async function session(page, profileId) {
  const res = await page.evaluate(async id => (await fetch('/api/mist/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profileId: id }) })).json(), profileId);
  if (res?.mode !== 'local') throw new Error('只能在本地独立 Mist 服务上采集（mode=local）。');
  await page.reload(); await page.waitForTimeout(2500);
}
async function nav(page, group, item) {
  const head = page.locator('.mist-nav-head', { hasText: group });
  if (await head.getAttribute('aria-expanded') === 'false') { await head.click(); await page.waitForTimeout(300); }
  return page.locator('.mist-nav-group', { hasText: group }).getByText(item, { exact: true });
}
const dialog = (page, name) => page.getByRole('dialog', { name });

/** 每步：prepare 只做准备（不展示），target 指向本步操作的控件，act 执行与员工相同的操作。 */
const PAYEE_CHECK = '按合同所载电话 0512-5868 2203 回拨赵琳，核实账户名称、开户行与账号一致。';
const PLAN_DUE = '2026-11-03', BILL_DUE = '2026-11-26', INVOICE_NO = '3200261130 08841265';
const PREPAY_REASON = '合同已回签，按付款条件 30% 预付，供应商安排投产。';
const BALANCE_REASON = 'ST-2026-0001 已确认，专票 110,670.00 已登记，抵扣预付 33,201.00 后申请余款。';
const NO_RESUPPLY = '华盛毛纺赵琳邮件确认：色差 20 米退回，不再补发。';
const CLOSE_NOTE = '供应商邮件确认色差 20 米不再补发，合同按实收 2,380 米结案。';
const REFUND_NOTE = '供应商退回短交 20 米对应的预付款 279.00。';
let invoiceFile = '', poFile = '';
const QUOTE_SENT = '邮件发送正式报价单 PDF 给 Cedar & Crown 采购 Olivia Grant';
const QUOTE_ACCEPTED = 'Olivia Grant 10-31 邮件确认接受 V2 报价，PO 随后下发。';
const DEV_CONFIRMER = 'Olivia Grant（Cedar & Crown 采购）', DEV_BASIS = '客户 10-31 邮件确认 R2-A-2 大货样，可按此生产。';
const ORDER_DUE = '2026-12-20', CUSTOMER_PO = 'CC-PO-2026-1188';
const QTY_BASIS = '客户 PO CC-PO-2026-1188 按款号总量下单：大衣 800 件、马甲 600 件，分色分码后补。';
const openQuote = [
  { target: p => nav(p, '订单履约', '报价管理'), act: l => l.click() },
  { target: p => p.locator('[role=row]', { hasText: 'V2' }).first(), act: l => l.click() },
  { target: p => p.getByRole('button', { name: '打开报价单' }), act: l => l.click() },
];
const openOrder = [
  { target: p => nav(p, '订单履约', '订单管理'), act: l => l.click() },
  { target: p => p.locator('[role=row]', { hasText: 'SO-G-2026-0009' }).first(), act: l => l.click() },
];
const lineMode = (name, mode) => [
  { target: p => p.getByRole('button', { name: new RegExp(name) }).first().or(p.getByText(name).first()), act: l => l.click() },
  { target: p => p.getByRole('dialog').last().getByRole('button', { name: '编辑条目' }), act: l => l.click() },
  { target: p => p.getByRole('dialog').last().getByLabel('履约模式'), act: l => l.selectOption({ label: mode }), value: mode },
  { target: p => p.getByRole('dialog').last().getByRole('button', { name: '保存条目' }), act: l => l.click() },
];
/** 演示专票原件：采集时现生成，明确标注演示样张。 */
function demoInvoice() { return invoiceFile; }

const LESSONS = {
  'payee-account': [
    { profile: 'demo-finance', target: p => nav(p, '客户与市场', '供应商管理'), act: l => l.click() },
    { target: p => p.getByText('华盛毛纺').first(), act: l => l.click() },
    { target: p => p.getByRole('button', { name: '打开供应商档案' }), act: l => l.click() },
    { target: p => p.locator('section,div').filter({ has: p.getByText('收款账户', { exact: true }) }).filter({ has: p.getByRole('button', { name: '登记', exact: true }) }).last().getByRole('button', { name: '登记', exact: true }), act: l => l.click() },
    { target: p => p.getByRole('dialog').getByLabel('开户行'), act: l => l.fill('中国工商银行张家港塘桥支行'), value: '中国工商银行张家港塘桥支行' },
    { target: p => p.getByRole('dialog').getByLabel('账号'), act: l => l.fill('1102025609001234567'), value: '1102025609001234567' },
    { target: p => p.getByRole('dialog').getByLabel('核实记录'), act: l => l.fill(PAYEE_CHECK), value: PAYEE_CHECK },
    { target: p => p.getByRole('dialog').getByRole('button', { name: '保存' }), act: l => l.click() },
  ],
  'payment-plan': [
    { profile: 'demo-finance', target: p => nav(p, '财务与成本', '财务管理'), act: l => l.click() },
    { target: p => p.getByRole('tab', { name: '应付待办' }), act: l => l.click() },
    { target: p => p.getByRole('button', { name: '登记付款计划' }).first(), act: l => l.click() },
    { target: p => p.getByRole('dialog').getByLabel('来源合同'), act: l => l.selectOption({ label: 'PO-2026-00001 · 华盛毛纺 · 111,600.00 CNY' }), value: 'PO-2026-00001 · 华盛毛纺 · 111,600.00 CNY' },
    { target: p => p.getByRole('dialog').getByLabel('计划付款日'), act: l => l.fill(PLAN_DUE), value: PLAN_DUE },
    { target: p => p.getByRole('dialog').getByLabel('付款触发条件'), act: l => l.selectOption({ label: '合同签订后' }), value: '合同签订后' },
    { target: p => p.getByRole('dialog').getByRole('button', { name: '登记计划' }), act: l => l.click() },
  ],
  'prepay-request': [
    { profile: 'demo-buyer', target: p => p.getByText('PP-2026-0001 · 待申请预付款').first(), act: l => l.click() },
    { target: p => p.getByRole('button', { name: '申请预付款' }).first(), act: l => l.click() },
    { target: p => p.getByRole('dialog').getByRole('textbox', { name: '付款依据' }), act: l => l.fill(PREPAY_REASON), value: PREPAY_REASON },
    { target: p => p.getByRole('dialog').getByRole('button', { name: '提交审批' }), act: l => l.click() },
  ],
  'payment-approve': [
    { profile: 'demo-reviewer', target: p => p.getByText(/PR-2026-0001 · 华盛毛纺/).first(), act: l => l.click() },
    { target: p => p.getByRole('textbox', { name: '审批意见' }), act: l => l.fill('按合同 30% 预付，收款账户已电话核实，同意。'), value: '按合同 30% 预付，收款账户已电话核实，同意。' },
    { target: p => p.getByRole('button', { name: '批准' }), act: l => l.click() },
  ],
  'prepay-pay': [
    { profile: 'demo-finance', target: p => p.getByText('PR-2026-0001 · 待付款').first(), act: l => l.click() },
    { target: p => p.getByRole('button', { name: '登记实付', exact: true }).first(), act: l => l.click() },
    { target: p => p.getByRole('dialog').getByLabel('银行流水号'), act: l => l.fill('ICBC20261031-0088412'), value: 'ICBC20261031-0088412' },
    { target: p => p.getByRole('dialog').getByRole('button', { name: '登记实付' }), act: l => l.click() },
  ],
  settlement: [
    { profile: 'demo-buyer', target: p => nav(p, '财务与成本', '财务管理'), act: l => l.click() },
    { target: p => p.getByRole('tab', { name: '应付待办' }), act: l => l.click() },
    { target: p => p.getByRole('button', { name: '提交结算' }), act: l => l.click() },
    { target: p => dialog(p, '提交结算').getByLabel('结算合同'), act: l => l.selectOption({ label: 'PO-2026-00001 · 华盛毛纺' }), value: 'PO-2026-00001 · 华盛毛纺' },
    { target: p => dialog(p, '提交结算').locator('[data-settle-receipt]').first().getByRole('checkbox'), act: l => l.check({ force: true }) },
    { target: p => dialog(p, '提交结算').getByLabel('结算说明'), act: l => l.fill('首批到货 2,380 米验收合格，按合同单价结算；色差 20 米已退回，待供应商确认补发。'), value: '首批到货 2,380 米验收合格，按合同单价结算；色差 20 米已退回，待供应商确认补发。' },
    { target: p => dialog(p, '提交结算').getByRole('button', { name: '提交复核' }), act: l => l.click() },
  ],
  'settlement-confirm': [
    { profile: 'demo-finance', target: p => p.getByText(/ST-\d{4}-\d{4} · 待财务复核/).last(), act: l => l.click() },
    { target: p => p.getByRole('button', { name: '确认结算' }).first(), act: l => l.click() },
    { target: p => dialog(p, '确认结算').getByLabel('复核意见'), act: l => l.fill('实收 2,380 米与入库记录一致，按合同单价确认；预付按比例抵扣 33,201.00。'), value: '实收 2,380 米与入库记录一致，按合同单价确认；预付按比例抵扣 33,201.00。' },
    { target: p => dialog(p, '确认结算').getByRole('button', { name: '确认结算' }), act: l => l.click() },
    { target: p => p.getByRole('button', { name: '按结算登记票据' }).first(), act: l => l.click() },
  ],
  'bill-register': [
    { profile: 'demo-finance', target: p => nav(p, '财务与成本', '财务管理'), act: l => l.click() },
    { target: p => p.getByRole('tab', { name: '应付待办' }), act: l => l.click() },
    { target: p => p.getByRole('button', { name: /^结算 · / }), act: l => l.click() },
    { target: p => p.getByText('ST-2026-0001').first(), act: l => l.click() },
    { target: p => p.getByRole('button', { name: '按结算登记票据' }).first(), act: l => l.click() },
    { target: p => p.getByRole('dialog').getByLabel('发票类型'), act: l => l.selectOption({ label: '增值税专用发票' }), value: '增值税专用发票' },
    { target: p => p.getByRole('dialog').getByLabel('供应商发票号'), act: l => l.fill(INVOICE_NO), value: INVOICE_NO },
    { target: p => p.getByRole('dialog').getByLabel('到期日', { exact: true }), act: l => l.fill(BILL_DUE), value: BILL_DUE },
    { target: p => p.getByRole('dialog').getByText('拖拽文件到这里，或点击上传'), act: (l, p) => p.getByRole('dialog').locator('input[type=file]').setInputFiles(demoInvoice()) },
    { target: p => p.getByRole('dialog').getByRole('button', { name: '登记应付' }), act: l => l.click() },
  ],
  'balance-request': [
    { profile: 'demo-buyer', target: p => p.getByText('AP-2026-0002 · 待申请付款').first(), act: l => l.click() },
    { target: p => p.getByRole('button', { name: '申请付款', exact: true }), act: l => l.click() },
    { target: p => p.getByRole('dialog').getByRole('textbox', { name: '付款依据' }), act: l => l.fill(BALANCE_REASON), value: BALANCE_REASON },
    { target: p => p.getByRole('dialog').getByRole('button', { name: '提交审批' }), act: l => l.click() },
  ],
  // 以下下划线开头的为准备步骤：按员工同样的界面操作推进业务，但不截图、不生成课程。
  '_balance-approve': [
    { profile: 'demo-reviewer', target: p => p.getByText(/PR-2026-0002 · 华盛毛纺/).first(), act: l => l.click() },
    { target: p => p.getByRole('textbox', { name: '审批意见' }), act: l => l.fill('结算、专票与收货一致，同意支付余款。') },
    { target: p => p.getByRole('button', { name: '批准' }), act: l => l.click() },
  ],
  'balance-pay': [
    { profile: 'demo-finance', target: p => p.getByText('PR-2026-0002 · 待付款').first(), act: l => l.click() },
    { target: p => p.getByRole('button', { name: '登记实付', exact: true }).first(), act: l => l.click() },
    { target: p => p.getByRole('dialog').getByLabel('银行流水号'), act: l => l.fill('ICBC20261031-0093307'), value: 'ICBC20261031-0093307' },
    { target: p => p.getByRole('dialog').getByRole('button', { name: '登记实付' }), act: l => l.click() },
  ],
  'no-resupply': [
    { profile: 'demo-buyer', target: p => nav(p, '订单履约', '采购管理'), act: l => l.click() },
    { target: p => p.getByRole('button', { name: /面料业务/ }), act: l => l.click() },
    { target: p => p.getByText('PO-2026-00001').first(), act: l => l.click() },
    { target: p => p.getByRole('button', { name: '打开采购订单' }), act: l => l.click() },
    { target: p => p.getByRole('button', { name: '登记退货 / 换货' }), act: l => l.click() },
    { target: p => p.getByRole('dialog').getByLabel('供应商处理'), act: l => l.selectOption({ label: '不再补发' }), value: '不再补发' },
    { target: p => p.getByRole('dialog').getByLabel('退货单 / 供应商确认依据'), act: l => l.fill(NO_RESUPPLY), value: NO_RESUPPLY },
    { target: p => p.getByRole('dialog').getByRole('button', { name: '登记退换' }), act: l => l.click() },
  ],
  'quote-approve': [
    { profile: 'demo-reviewer', target: p => p.getByText(/QT-2026-0003-V2 报价审批/).last(), act: l => l.click() },
    { target: p => p.locator('textarea').last(), act: l => l.fill('马甲按客户还价让利，整单毛利可接受，同意。'), value: '马甲按客户还价让利，整单毛利可接受，同意。' },
    { target: p => p.getByRole('button', { name: '批准' }), act: l => l.click() },
  ],
  'quote-send': [
    { profile: 'demo-sales', ...openQuote[0] }, openQuote[1], openQuote[2],
    { target: p => p.getByRole('button', { name: '生成正式报价单' }), act: async (l, p) => { await l.click(); await p.getByText(/QT-2026-0003-V2-01\.pdf/).first().waitFor({ timeout: 20000 }); } },
    { target: p => p.getByRole('button', { name: '登记已发送' }), act: l => l.click() },
    { target: p => p.getByRole('dialog').last().getByLabel('发送方式与对象'), act: l => l.fill(QUOTE_SENT), value: QUOTE_SENT },
    { target: p => p.getByRole('dialog').last().getByRole('button', { name: '登记' }), act: l => l.click() },
  ],
  'quote-accept': [
    { profile: 'demo-sales', ...openQuote[0] }, openQuote[1], openQuote[2],
    { target: p => p.getByRole('button', { name: '客户接受' }), act: l => l.click() },
    { target: p => p.getByRole('dialog').last().getByLabel('客户反馈或依据'), act: l => l.fill(QUOTE_ACCEPTED), value: QUOTE_ACCEPTED },
    { target: p => p.getByRole('dialog').last().getByRole('button', { name: '登记' }), act: l => l.click() },
  ],
  'dev-confirm': [
    { profile: 'demo-sales', target: p => nav(p, '订单履约', '开发与寻样'), act: l => l.click() },
    { target: p => p.getByText('DEV-G-2026-031').first(), act: l => l.click() },
    { target: p => p.getByRole('button', { name: /打开/ }).first(), act: l => l.click() },
    { target: p => p.getByRole('radio', { name: '认可' }), act: l => l.check({ force: true }) },
    { target: p => p.getByLabel('实际确认人'), act: l => l.fill(DEV_CONFIRMER), value: DEV_CONFIRMER },
    { target: p => p.getByLabel('确认依据'), act: l => l.fill(DEV_BASIS), value: DEV_BASIS },
    { target: p => p.getByRole('button', { name: '保存确认' }), act: l => l.click() },
    { target: p => p.getByRole('dialog').last().getByRole('button', { name: '确认提交' }), act: l => l.click() },
  ],
  'quote-convert': [
    { profile: 'demo-sales', ...openQuote[0] }, openQuote[1], openQuote[2],
    { target: p => p.getByRole('button', { name: '核对并转订单' }), act: l => l.click() },
    { target: p => p.getByRole('dialog').last().getByLabel('本次订单交期'), act: l => l.fill(ORDER_DUE), value: ORDER_DUE },
    { target: p => p.getByRole('dialog').last().getByRole('button', { name: '创建订单草稿' }), act: l => l.click() },
  ],
  'order-contract': [
    { profile: 'demo-sales', ...openOrder[0] }, openOrder[1],
    { target: p => p.getByRole('button', { name: '合同与审批资料' }), act: l => l.click() },
    { target: p => p.getByRole('dialog').last().getByLabel('PO / 合同号'), act: l => l.fill(CUSTOMER_PO), value: CUSTOMER_PO },
    { target: p => p.getByRole('dialog').last().getByLabel('数量口径'), act: l => l.selectOption({ label: '按总量' }), value: '按总量' },
    { target: p => p.getByRole('dialog').last().getByLabel('数量依据'), act: l => l.fill(QTY_BASIS), value: QTY_BASIS },
    { target: p => p.getByRole('dialog').last().getByLabel('溢装上限 %'), act: l => l.fill('3'), value: '3' },
    { target: p => p.getByRole('dialog').last().getByLabel('短装下限 %'), act: l => l.fill('3'), value: '3' },
    { target: p => p.getByRole('dialog').last().getByRole('button', { name: '上传文件' }), act: (l, p) => p.getByRole('dialog').last().locator('input[type=file]').setInputFiles(poFile) },
    { target: p => p.getByRole('dialog').last().getByRole('button', { name: '保存合同资料' }), act: l => l.click() },
  ],
  'order-lines': [
    { profile: 'demo-sales', ...openOrder[0] }, openOrder[1],
    ...lineMode('双面羊毛城市大衣', '全包'),
  ],
  '_order-lines-2': [
    { profile: 'demo-sales', ...openOrder[0] }, openOrder[1],
    ...lineMode('轻量填充马甲', '全包'),
  ],
  'order-submit': [
    { profile: 'demo-sales', ...openOrder[0] }, openOrder[1],
    { target: p => p.getByRole('button', { name: '提交主单审批' }), act: l => l.click() },
  ],
  'order-approve': [
    { profile: 'demo-reviewer', target: p => p.getByText(/SO-G-2026-0009/).last(), act: l => l.click() },
    { target: p => p.locator('textarea').last(), act: l => l.fill('PO、价格、交期与付款条件已核对，同意。'), value: 'PO、价格、交期与付款条件已核对，同意。' },
    { target: p => p.getByRole('button', { name: '批准' }), act: l => l.click() },
  ],
  'short-close': [
    { profile: 'demo-buyer', target: p => p.getByText('PO-2026-00001 · 待最终结算').first(), act: l => l.click() },
    { target: p => dialog(p, '提交结算').getByRole('checkbox', { name: '最终结算' }), act: l => l.check({ force: true }) },
    { target: p => dialog(p, '提交结算').getByLabel('结算说明'), act: l => l.fill(CLOSE_NOTE), value: CLOSE_NOTE },
    { target: p => dialog(p, '提交结算').getByRole('button', { name: '提交复核' }), act: l => l.click() },
  ],
  '_close-confirm': [
    { profile: 'demo-finance', target: p => p.getByText(/ST-2026-0002 · 待财务复核/).last(), act: l => l.click() },
    { target: p => p.getByRole('button', { name: '确认结算' }).first(), act: l => l.click() },
    { target: p => dialog(p, '确认结算').getByLabel('复核意见'), act: l => l.fill('供应商不再补发的邮件已核对，同意按实收结案。') },
    { target: p => dialog(p, '确认结算').getByRole('button', { name: '确认结算' }), act: l => l.click() },
  ],
  'prepay-refund': [
    { profile: 'demo-finance', target: p => p.getByText('PO-2026-00001 · 剩余预付待处理').last(), act: l => l.click() },
    { target: p => p.getByRole('button', { name: '登记退款' }), act: l => l.click() },
    { target: p => p.getByRole('dialog').getByLabel('退款流水号'), act: l => l.fill('ICBC20261031-R0279'), value: 'ICBC20261031-R0279' },
    { target: p => p.getByRole('dialog').getByLabel('退款说明'), act: l => l.fill(REFUND_NOTE), value: REFUND_NOTE },
    { target: p => p.getByRole('dialog').getByRole('button', { name: '登记退款' }), act: l => l.click() },
  ],
};
/** 采集全链（按业务先后，重置本地数据后依次执行）。 */
const CHAIN = ['payee-account', 'payment-plan', 'prepay-request', 'payment-approve', 'prepay-pay', 'settlement', 'settlement-confirm', 'bill-register', 'balance-request', '_balance-approve', 'balance-pay', 'no-resupply', 'short-close', '_close-confirm', 'prepay-refund'];

/** 截图并在浏览器内编码为 WebP（不依赖本机图像库）。 */
async function shot(page, file) {
  const png = (await page.screenshot({ type: 'png' })).toString('base64');
  const webp = await page.evaluate(async src => {
    const img = new Image(); img.src = 'data:image/png;base64,' + src; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0); return canvas.toDataURL('image/webp', 0.82).split(',')[1];
  }, png);
  fs.writeFileSync(file + '.webp', Buffer.from(webp, 'base64'));
}

async function capture(browser, name) {
  const steps = LESSONS[name]; if (!steps) throw new Error(`未知课程：${name}（可选 ${Object.keys(LESSONS).join(' / ')}）`);
  const setup = name.startsWith('_'), out = path.join(ROOT, 'wiki/assets/lessons', name); if (!setup) fs.mkdirSync(out, { recursive: true });
  {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE); await page.waitForTimeout(1500);
    const frames = [];
    for (const [i, step] of steps.entries()) {
      if (step.profile) await session(page, step.profile);
      const target = await step.target(page); await target.waitFor({ state: 'visible', timeout: 10000 });
      await target.scrollIntoViewIfNeeded(); await page.mouse.move(0, 0); await page.waitForTimeout(400);
      const box = await target.boundingBox(); if (!box) throw new Error(`${name} 第 ${i + 1} 步找不到目标控件`);
      if (!setup) {
        const image = String(i + 1).padStart(2, '0'); await shot(page, path.join(out, image));
        frames.push({ image: image + '.webp', target: Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Math.round(v)])), ...(step.value ? { value: step.value } : {}) });
      }
      await step.act(target, page); await page.waitForTimeout(1200);
    }
    await page.mouse.move(0, 0); await page.waitForTimeout(600);
    if (errors.length) throw new Error('页面脚本错误：' + errors.join('；'));
    if (!setup) {
      await shot(page, path.join(out, 'result'));
      fs.writeFileSync(path.join(out, 'capture.json'), JSON.stringify({ viewport: VIEWPORT, frames, result: 'result.webp' }, null, 2) + '\n');
    }
    console.log(`✓ ${name}：${setup ? '准备步骤已办理' : `${frames.length} 步 → ${path.relative(ROOT, out)}`}`);
    await page.close();
  }
}

/** 主干第一段：报价 → 订单（重置本地数据后依次执行）。 */
const ORDER_CHAIN = ['quote-approve', 'quote-send', 'quote-accept', 'dev-confirm', 'quote-convert', 'order-contract', 'order-lines', '_order-lines-2', 'order-submit', 'order-approve'];
const names = process.argv.slice(2).flatMap(n => n === 'chain' ? CHAIN : n === 'order-chain' ? ORDER_CHAIN : [n]);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  if (names.includes('bill-register')) {
    const tmp = await browser.newPage(); invoiceFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bambook-')), 'demo-vat-invoice.pdf');
    await tmp.setContent('<body style="font-family:sans-serif;padding:48px"><h2>增值税专用发票（教学演示样张，非真实票据）</h2><p>销售方：华盛毛纺（演示）</p><p>发票号码：' + INVOICE_NO + '</p><p>燕麦色双面呢 2380 米 · 价税合计 110,670.00 · 税率 13%</p><p style="color:#b00">DEMO</p></body>');
    await tmp.pdf({ path: invoiceFile, format: 'A5' }); await tmp.close();
  }
  if (names.includes('order-contract')) {
    const tmp = await browser.newPage(); poFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bambook-')), 'demo-customer-po.pdf');
    await tmp.setContent('<body style="font-family:sans-serif;padding:48px"><h2>PURCHASE ORDER (teaching demo, not a real order)</h2><p>Buyer: Cedar &amp; Crown (demo)</p><p>PO No.: ' + CUSTOMER_PO + '</p><p>Double-face wool city coat GA-2711 · 800 pcs × USD 72.50</p><p>Lightweight padded vest GA-2712 · 600 pcs × USD 20.50</p><p>FOB Shanghai · T/T 30% deposit, 70% against B/L copy · Delivery 2026-12-20</p></body>');
    await tmp.pdf({ path: poFile, format: 'A5' }); await tmp.close();
  }
  for (const name of names) await capture(browser, name);
} finally { await browser.close(); }
