/**
 * 客户对账单（Statement of Account，2026-10-18）。外贸通行的“未结项对账单”（open-item statement）：
 * 截至对账日按币种列出该客户全部未结应收（票面、已到账核销、贷项抵扣、未收、到期日、逾期天数）、
 * 已到账但尚未核销的款项（付款方与客户同名的到账余额，作为预收/待核销抵减），以及账龄分段与净欠款。
 * 不跨币种折算合计。服务端按冻结快照渲染 PDF 归档（SOA-YYYY-NNNN，按年连续），只追加不改写；不记录发送状态。
 * 收款账户按币种取未销户的公司银行账户，缺省回落到公司档案的开户行与账号。
 */
import { mistInvoiceCustomerId } from './mistOpeningBalance';
import { MistCommandError, isRecognizedMistInvoice, type MistCompanyProfile, type MistContext, type MistState } from './mistWorkspace';
import { platformBusinessDate } from './mistPlatform';
import { creditDocumentFingerprint } from './mistCreditDocuments';

export const CUSTOMER_STATEMENT_TEMPLATE_VERSION = 1 as const;
export type StatementAgeBucket = 'not-due' | '1-30' | '31-60' | '61-90' | '90+' | 'unknown';
export const STATEMENT_AGE_BUCKETS: StatementAgeBucket[] = ['not-due', '1-30', '31-60', '61-90', '90+', 'unknown'];
export const STATEMENT_AGE_LABEL: Record<StatementAgeBucket, { zh: string; en: string }> = {
  'not-due': { zh: '未到期', en: 'Not due' }, '1-30': { zh: '逾期 1–30 天', en: '1–30 days' }, '31-60': { zh: '逾期 31–60 天', en: '31–60 days' },
  '61-90': { zh: '逾期 61–90 天', en: '61–90 days' }, '90+': { zh: '逾期 90 天以上', en: 'Over 90 days' }, unknown: { zh: '到期日未记录', en: 'No due date' },
};
export type StatementLine = { invoiceId: string; code: string; reference: string; issuedAt: string; due: string; amount: string; received: string; credited: string; open: string; daysOverdue: number | null; bucket: StatementAgeBucket };
export type StatementUnapplied = { receiptId: string; code: string; date: string; reference: string; amount: string };
export type StatementRemit = { bankName: string; accountName: string; accountNo: string; swift: string };
export type StatementSection = { currency: string; lines: StatementLine[]; unapplied: StatementUnapplied[]; totalOpen: string; totalUnapplied: string; net: string; aging: Array<{ bucket: StatementAgeBucket; amount: string }>; remit: StatementRemit[] };
export type StatementContent = {
  customer: { id: string; name: string; code: string; city: string; country: string; terms: string };
  asOf: string; sections: StatementSection[];
  issuer: Pick<MistCompanyProfile, 'legalName' | 'englishName' | 'address' | 'englishAddress' | 'phone' | 'email'>;
};
export type StatementSnapshot = StatementContent & { statementNo: string; seq: number; templateVersion: number; generatedAt: string; generatedBy: string; generatedById: string };
export type CustomerStatementRecord = { id: string; customerId: string; statementNo: string; seq: number; asOf: string; totals: Array<{ currency: string; net: string }>; fileId: string; fileName: string; sha256: string; bytes: number; templateVersion: number; snapshotFingerprint: string; snapshot: StatementSnapshot; generatedAt: string; generatedBy: string; generatedById: string };
export type CustomerStatementFile = { id: string; name: string; mimeType: string; size: number; storageKey: string; createdAt: string; uploadedBy?: string };
/** 服务端渲染并写入私有存储后绑定到命令上下文；客户端 payload 不能提供。 */
export type CustomerStatementArtifact = { requestId: string; record: CustomerStatementRecord; file: CustomerStatementFile };
export type CustomerStatementCommand = { type: 'finance.statement.generate'; payload: { customerId: string } };
type Root = MistState & { customerStatements?: CustomerStatementRecord[] };

const fail = (message: string, code = 'PRECONDITION'): never => { throw new MistCommandError(code, message, code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : 422); };
const minor = (n: number) => Math.round(n * 100);
const fmt = (cents: number) => (cents / 100).toFixed(2);
const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
const validDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');

export const readCustomerStatements = (root: Pick<Root, 'customerStatements'>) => root.customerStatements || [];
export const customerStatementsOf = (root: Pick<Root, 'customerStatements'>, customerId: string) => readCustomerStatements(root).filter(s => s.customerId === customerId).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt) || b.seq - a.seq);
export const customerStatementFingerprint = (value: unknown) => creditDocumentFingerprint(value);
export const customerStatementFileName = (s: Pick<StatementSnapshot, 'statementNo' | 'customer'>) => `客户对账单-${s.statementNo}-${s.customer.code || s.customer.name}.pdf`.replace(/[\\/:*?"<>|]/g, '_');

export function statementAge(due: string, asOf: string): { days: number | null; bucket: StatementAgeBucket } {
  if (!validDay(due)) return { days: null, bucket: 'unknown' };
  const days = Math.max(0, Math.round((Date.parse(asOf + 'T00:00:00Z') - Date.parse(due + 'T00:00:00Z')) / 86400000));
  return { days, bucket: days === 0 ? 'not-due' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+' };
}
function invoiceOwner(root: MistState, inv: { devId?: string; orderId: string; customerId?: string }) { return mistInvoiceCustomerId(root, inv); }

/** 截至对账日的对账单内容（不含编号、生成人与时间）。 */
export function customerStatementContent(root: MistState, customerId: string, asOf: string): StatementContent {
  const c = root.customers.find(row => row.id === customerId) || fail('客户不存在', 'NOT_FOUND');
  const issuer = root.settings.companyProfile;
  const invoices = root.invoices.filter(i => isRecognizedMistInvoice(i) && minor(i.open) > 0 && invoiceOwner(root, i) === c.id && (!i.issuedAt || i.issuedAt <= asOf));
  const receipts = root.receipts.filter(r => minor(r.remaining) > 0 && sameName(r.payer, c.name) && r.date <= asOf);
  const currencies = [...new Set([...invoices.map(i => i.currency), ...receipts.map(r => r.currency)])].sort();
  const credits = root.platform?.creditApplications || [];
  const sections = currencies.map((currency): StatementSection => {
    const lines = invoices.filter(i => i.currency === currency).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.code.localeCompare(b.code)).map((i): StatementLine => {
      const received = root.allocations.filter(a => a.invoiceId === i.id && a.currency === currency).reduce((n, a) => n + minor(a.amount), 0);
      const credited = credits.filter(a => a.invoiceId === i.id).reduce((n, a) => n + minor(a.amount), 0), age = statementAge(i.due, asOf);
      const reference = i.devId ? (root.devs.find(d => d.id === i.devId)?.code || '') : (i.order || root.orders.find(o => o.id === i.orderId)?.code || '');
      return { invoiceId: i.id, code: i.code, reference, issuedAt: i.issuedAt || '', due: i.due || '', amount: fmt(minor(i.amount)), received: fmt(received), credited: fmt(credited), open: fmt(minor(i.open)), daysOverdue: age.days, bucket: age.bucket };
    });
    const unapplied = receipts.filter(r => r.currency === currency).sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code)).map(r => ({ receiptId: r.id, code: r.code, date: r.date, reference: r.ref || '', amount: fmt(minor(r.remaining)) }));
    const totalOpen = lines.reduce((n, l) => n + Math.round(Number(l.open) * 100), 0), totalUnapplied = unapplied.reduce((n, u) => n + Math.round(Number(u.amount) * 100), 0);
    const aging = STATEMENT_AGE_BUCKETS.map(bucket => ({ bucket, amount: fmt(lines.filter(l => l.bucket === bucket).reduce((n, l) => n + Math.round(Number(l.open) * 100), 0)) })).filter(a => a.bucket !== 'unknown' || a.amount !== '0.00');
    const accounts = (root.bankAccounts || []).filter(a => a.currency === currency && !a.closed).sort((a, b) => a.code.localeCompare(b.code));
    const remit = accounts.length ? accounts.map(a => ({ bankName: a.bankName, accountName: issuer?.englishName || issuer?.legalName || a.name, accountNo: a.accountNo, swift: issuer?.swift || '' }))
      : issuer?.bankAccount ? [{ bankName: issuer.bankName || '', accountName: issuer.englishName || issuer.legalName, accountNo: issuer.bankAccount, swift: issuer.swift || '' }] : [];
    return { currency, lines, unapplied, totalOpen: fmt(totalOpen), totalUnapplied: fmt(totalUnapplied), net: fmt(totalOpen - totalUnapplied), aging, remit };
  });
  return {
    customer: { id: c.id, name: c.name, code: c.code || '', city: c.city || '', country: c.country || '', terms: c.terms || '' }, asOf, sections,
    issuer: { legalName: issuer?.legalName || '', englishName: issuer?.englishName || '', address: issuer?.address || '', englishAddress: issuer?.englishAddress || '', phone: issuer?.phone || '', email: issuer?.email || '' },
  };
}

/** 截至对账日有未结应收或同名待核销到账（可出对账单）。 */
export const customerHasStatementItems = (root: MistState, customerId: string, asOf: string) => root.customers.some(c => c.id === customerId) && customerStatementContent(root, customerId, asOf).sections.length > 0;
/** 不能生成对账单的原因；可以生成时返回 null。 */
export function customerStatementBlocker(root: MistState, customerId: string, asOf: string): string | null {
  if (!root.customers.some(c => c.id === customerId)) return '客户不存在';
  if (!root.settings.companyProfile?.legalName) return '先在 设置 › 公司档案 填写公司抬头，才能生成对账单';
  if (!customerHasStatementItems(root, customerId, asOf)) return '该客户截至今天没有未结应收或待核销到账，无需对账单';
  return null;
}

/** 下一份对账单编号：SOA-年份-四位序号，按对账日所在年份连续。 */
export function nextCustomerStatementNo(root: Pick<Root, 'customerStatements'>, asOf: string) {
  const year = asOf.slice(0, 4), seq = readCustomerStatements(root).filter(s => s.statementNo.startsWith(`SOA-${year}-`)).reduce((n, s) => Math.max(n, s.seq), 0) + 1;
  return { seq, statementNo: `SOA-${year}-${String(seq).padStart(4, '0')}` };
}

export function prepareCustomerStatementSnapshot(root: MistState, payload: unknown, context: MistContext): StatementSnapshot {
  if (!payload || typeof payload !== 'object' || Object.keys(payload).some(k => k !== 'customerId')) fail('对账单内容只能由服务端按当前台账生成', 'VALIDATION');
  const customerId = String((payload as { customerId?: unknown }).customerId || ''), asOf = platformBusinessDate(context.now);
  const blocked = customerStatementBlocker(root, customerId, asOf); if (blocked) fail(blocked, blocked === '客户不存在' ? 'NOT_FOUND' : 'PRECONDITION');
  if (!context.actorId) fail('缺少真实生成人');
  return { ...customerStatementContent(root, customerId, asOf), ...nextCustomerStatementNo(root as Root, asOf), templateVersion: CUSTOMER_STATEMENT_TEMPLATE_VERSION, generatedAt: context.now, generatedBy: context.actorName, generatedById: context.actorId! };
}

export function customerStatementCommandPermission(_command: CustomerStatementCommand) { return 'invoices:write'; }

export function applyCustomerStatementCommand(root: MistState, command: CustomerStatementCommand, context: MistContext): { id: string; statementId: string; fileId: string } {
  if (command.type !== 'finance.statement.generate') fail('对账单操作无效', 'VALIDATION');
  const snapshot = prepareCustomerStatementSnapshot(root, command.payload, context), artifact = (context as MistContext & { customerStatement?: CustomerStatementArtifact }).customerStatement;
  if (!artifact || artifact.record.customerId !== snapshot.customer.id || artifact.record.statementNo !== snapshot.statementNo || artifact.record.snapshotFingerprint !== customerStatementFingerprint(snapshot) || customerStatementFingerprint(artifact.record.snapshot) !== artifact.record.snapshotFingerprint || artifact.record.fileId !== artifact.file.id) fail('对账单须由服务端按当前台账生成并归档');
  const record = artifact!.record, all = (root as Root).customerStatements ||= [];
  if (all.some(s => s.id === record.id || s.fileId === record.fileId || s.statementNo === record.statementNo) || root.files.some(f => f.id === artifact!.file.id)) fail('对账单记录或文件已存在', 'CONFLICT');
  root.files.push(structuredClone(artifact!.file) as MistState['files'][number]);
  all.push(structuredClone(record));
  const totals = record.totals.map(t => `${t.net} ${t.currency}`).join('、');
  root.events.unshift({ id: context.id(), entityType: 'invoice', entityId: record.customerId, actor: context.actorName, at: context.now, text: `生成客户对账单 ${record.statementNo}（截至 ${record.asOf}，净欠 ${totals}）`, fileIds: [record.fileId] });
  return { id: record.customerId, statementId: record.id, fileId: record.fileId };
}
