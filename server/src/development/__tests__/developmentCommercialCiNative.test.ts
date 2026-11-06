import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { developmentCiCommercialStorage } from './developmentCiCommercialStorage';

// Policy and independent side effects are seams; createInvoice and every CI/Billing producer stay real.
vi.mock('../../auth/tokenHelpers', () => ({ loadUserWithRoles: async (tx: any, id: string) => tx.auth.active ? { id, status: 'active' } : null,
  buildLoadedAuthTokenPayload: async (tx: any, user: any) => ({ userId: user.id, roles: [], permissions: tx.auth.scopes, permissionCeiling: undefined, authorizationLoaded: true }) }));
vi.mock('../../auth/permissionService', () => ({ hasScope: (actor: any, scope: string) => actor.permissions.includes(scope) && (actor.permissionCeiling === undefined || actor.permissionCeiling.includes(scope)),
  createPermissionService: ({ prisma }: any) => ({ getDataScopeResolver: async () => ({ rule: { kind: 'all' } }),
    getUserPermissionContext: async (id: string) => prisma.auth.active ? { userId: id, scopes: prisma.auth.scopes, legacyRoleCodes: [], roleIds: [], departmentIds: [] } : null }) }));
vi.mock('../../entities/sync', () => ({ syncInvoiceReferences: vi.fn(async () => undefined) }));
vi.mock('../../credit/creditService', () => ({ notifyCustomerCreditRecalc: vi.fn(async () => undefined) }));
vi.mock('../../events/businessEventBus', () => ({ publishBusinessEvent: vi.fn(async () => undefined) }));
vi.mock('../../finance/shipmentBatchSettlementHook', () => ({ notifyShipmentBatchSettlementRecalc: vi.fn(async () => undefined) }));
vi.mock('../../templates/docTemplates/financeInvoice', () => ({ currentExporterProfileSnapshot: async () => ({ nameEn: 'Seller Ltd', addressEn: 'Seller address' }) }));
vi.mock('../../shared/businessNumberService', () => ({ nextBusinessNumber: async (tx: any, kind: string) => `${kind}-TEST-${tx.state.billingItem.length + 1}` }));
vi.mock('../../lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { commandDevelopmentCommercialBilling, listDevelopmentCommercialBillings, readDevelopmentCommercialOptions, normalizeDevelopmentCommercialCommand } from '../developmentCommercialBillingService';
import { confirmDevelopmentExpenseReview, previewDevelopmentExpenseReview } from '../developmentClosureService';
import { ciHash, developmentCiRef, developmentCiSnapshot } from '../developmentCiSource';
import { developmentCiInvoiceLines } from '../../finance/developmentCiArMembers';
import { createInvoice, updateInvoice } from '../../finance/invoiceMutationService';
import { invoiceBillingItem } from '../../finance/billingItemService';
import { renderDevelopmentCiDocument } from '../developmentCiDocument';

const sales: any = { userId: 'sales', permissionCeiling: ['products:read', 'products:write'] };
const finance: any = { userId: 'finance', permissionCeiling: ['invoices:read', 'invoices:write'] };
const fields = { issueDate: '2026-10-12', dueDate: null, paymentTerms: 'TT', note: 'Customer agreed development services',
  billTo: { name: 'Buyer Ltd', address: 'Buyer address' }, exporter: { nameEn: 'Seller Ltd', addressEn: 'Seller address' } };
const line = (id: string, order: number, amount: string, round = 1) => ({ id, displayOrder: order, purpose: round === 1 ? 'Initial sample' : 'Revision sample',
  description: `Customer agreed service ${id}`, sourceType: 'DevelopmentSampleRound', sourceId: `round-${round}`, amount, currency: 'USD' });
function unrelatedProblemCosts(f: ReturnType<typeof developmentCiCommercialStorage>) {
  f.state.sample.push({ id: 'historical-production', sourceCaseId: 'case', type: 'production', sourceOrderId: null, updatedAt: 1n, deletedAt: null });
  f.state.costRecord.push(...[
    { id: 'unsupported', sourceType: 'DevelopmentCase', sourceId: 'case', amount: '3', currency: 'EUR' },
    { id: 'unresolved', sourceType: 'Sample', sourceId: 'historical-production', amount: '4', currency: 'CNY' },
    { id: 'invalid-amount', sourceType: 'DevelopmentCase', sourceId: 'case', amount: 'unknown', currency: 'USD' },
  ].map(row => ({ ...row, costType: 'sample_making', incurredAt: '2026-10-12', bearerType: 'internal', updatedAt: 1n, deletedAt: null })));
}
async function currentReview(f: ReturnType<typeof developmentCiCommercialStorage>) {
  f.state.developmentLifecycleEvent.push({ id: 'closed', developmentCaseId: 'case', state: 'closed', revision: 1 });
  const context = { prisma: f.prisma, actorId: 'sales', authorize: async () => undefined };
  const preview = await previewDevelopmentExpenseReview(context, 'case');
  return confirmDevelopmentExpenseReview(context, 'case', { expectedFingerprint: preview.fingerprint, requestKey: 'review', note: 'Actual complete review' });
}
function legacyBilling(id = 'legacy', amount = '60') {
  return { id, itemNo: id, sourceType: 'DevelopmentCase', sourceId: 'case', chargeType: 'development_fee', amount,
    waivedAmount: '0', offsetAmount: '0', currency: 'USD', bearerType: 'customer', bearerRelationId: 'customer', bearerName: 'Buyer Ltd',
    status: 'confirmed', developmentWorkflowState: null, developmentWorkflowVersion: 0, updatedAt: 1n, invoiceId: null,
    developmentExpenseReviewId: null, costRecordId: null, deletedAt: null };
}
const legacyManual = (amount = '100') => ({ invoiceNumber: 'LEGACY-MANUAL', type: 'Receivable', status: 'Draft', amount,
  currency: 'USD', customerRelationId: 'customer', customerName: 'Buyer Ltd', sourceType: 'Manual', sourceId: 'manual-explicit',
  invoiceLines: [{ sourceType: 'BillingItem', sourceId: 'legacy1', amount: '60', currency: 'USD', description: 'First' },
    { sourceType: 'BillingItem', sourceId: 'legacy2', amount: '40', currency: 'USD', description: 'Second' }] });
async function ready() {
  const f = developmentCiCommercialStorage(), context = { prisma: f.prisma, actor: sales };
  for (const [id, amount, round] of [['b1', '60', 1], ['b2', '40', 2]] as const) {
    f.state.billingItem.push({ id, itemNo: id.toUpperCase(), sourceType: 'DevelopmentCase', sourceId: 'case', chargeType: 'development_fee', amount,
      waivedAmount: '0', offsetAmount: '0', currency: 'USD', bearerType: 'customer', bearerRelationId: 'customer', status: 'draft',
      developmentWorkflowState: 'business_ci_draft', developmentWorkflowVersion: 0, updatedAt: 1n, invoiceId: null, deletedAt: null });
    f.state.costRecord.push({ id: `c${round}`, recordNo: `CR-${round}`, sourceType: 'DevelopmentCase', sourceId: 'case', costType: 'sample_making',
      amount: round === 1 ? '10' : '7', currency: 'CNY', incurredAt: '2026-10-12', bearerType: 'internal', updatedAt: 1n, evidence: [], deletedAt: null });
    await commandDevelopmentCommercialBilling(context, 'case', id, { action: 'save', requestKey: `commercial-${id}`, expectedVersion: 0,
      chargeLines: id === 'b1' ? [line('l1', 0, '25'), line('l2', 1, '35')] : [line('l3', 0, '40', 2)], costRecordIds: [`c${round}`] });
  }
  return { ...f, context };
}
beforeEach(() => vi.clearAllMocks());

describe('Explicit commercial multi-member CI through actual invoice producer', () => {
  it('recovers the exact successful legacy DevelopmentCase BI invoice without consuming its own line twice', async () => {
    const f = developmentCiCommercialStorage(); f.state.billingItem.push(legacyBilling());
    const first = await invoiceBillingItem({ prisma: f.prisma, id: 'legacy', actorId: 'finance', trustedActor: finance });
    expect(first.ok).toBe(true);
    const again = await invoiceBillingItem({ prisma: f.prisma, id: 'legacy', actorId: 'finance', trustedActor: finance });
    expect(again).toMatchObject({ ok: true, data: { recovered: true, invoice: { id: first.data!.invoice.id } } });
    expect(f.state.invoice).toHaveLength(1); expect(f.state.invoiceLine).toHaveLength(1);
    // Recover the original-source seam when an old writer missed its BI backfill.
    f.state.billingItem[0].status = 'confirmed'; f.state.billingItem[0].invoiceId = null;
    expect(await invoiceBillingItem({ prisma: f.prisma, id: 'legacy', actorId: 'finance', trustedActor: finance }))
      .toMatchObject({ ok: true, data: { recovered: true, invoice: { id: first.data!.invoice.id } } });
    expect(f.state.invoice).toHaveLength(1); expect(f.state.invoiceLine).toHaveLength(1);
  });
  it('rejects a damaged or foreign legacy invoice instead of relaxing cross-invoice occupancy on recovery', async () => {
    for (const damage of ['header', 'line', 'source', 'foreign-line']) {
      const f = developmentCiCommercialStorage(); f.state.billingItem.push(legacyBilling());
      expect((await invoiceBillingItem({ prisma: f.prisma, id: 'legacy', actorId: 'finance', trustedActor: finance })).ok).toBe(true);
      if (damage === 'header') f.state.invoice[0].amount = '1';
      if (damage === 'line') f.state.invoiceLine[0].amount = '1';
      if (damage === 'source') f.state.invoice[0].sourceId = 'foreign-billing';
      if (damage === 'foreign-line') f.state.invoiceLine[0].invoiceId = 'foreign-invoice';
      const result = await invoiceBillingItem({ prisma: f.prisma, id: 'legacy', actorId: 'finance', trustedActor: finance });
      expect(result.ok).toBe(false); expect(f.state.invoice).toHaveLength(1); expect(f.state.invoiceLine).toHaveLength(1);
    }
  });
  it('reloads actual permission after locking the legacy original invoice during recovery', async () => {
    const f = developmentCiCommercialStorage(); f.state.billingItem.push(legacyBilling());
    expect((await invoiceBillingItem({ prisma: f.prisma, id: 'legacy', actorId: 'finance', trustedActor: finance })).ok).toBe(true);
    const raw = f.tx.$queryRaw.getMockImplementation()!;
    f.tx.$queryRaw.mockImplementation(async (query: any) => {
      const result = await raw(query);
      if (query.strings.join('').includes('FROM "Invoice"')) f.tx.auth.scopes = [];
      return result;
    });
    expect(await invoiceBillingItem({ prisma: f.prisma, id: 'legacy', actorId: 'finance', trustedActor: finance }))
      .toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(f.state.invoice).toHaveLength(1); expect(f.state.invoiceLine).toHaveLength(1);
  });
  it('rejects exact legacy BI manual lines whose total exceeds the invoice header before any financial write', async () => {
    const f = developmentCiCommercialStorage(); f.state.billingItem.push(legacyBilling('legacy1'), legacyBilling('legacy2', '40'));
    const result = await createInvoice({ prisma: f.prisma, actor: finance, actorId: 'finance', input: legacyManual('60') });
    expect(result).toMatchObject({ ok: false, error: { code: 'HANDOFF_CONFLICT' } });
    expect(f.state.invoice).toEqual([]); expect(f.state.invoiceLine).toEqual([]);
  });
  it('keeps legacy BI and manual BillingItem-line financial totals during generic invoice updates', async () => {
    for (const manual of [false, true]) {
      const f = developmentCiCommercialStorage();
      f.state.billingItem.push(...(manual ? [legacyBilling('legacy1'), legacyBilling('legacy2', '40')] : [legacyBilling()]));
      const created = manual ? await createInvoice({ prisma: f.prisma, actor: finance, actorId: 'finance', input: legacyManual() })
        : await invoiceBillingItem({ prisma: f.prisma, id: 'legacy', actorId: 'finance', trustedActor: finance });
      expect(created.ok).toBe(true);
      const invoiceId = created.data!.invoice.id, total = String(f.state.invoice[0].amount);
      const result = await updateInvoice({ prisma: f.prisma, invoiceId, actor: finance, actorId: 'finance', input: { amount: '1' } });
      expect(result).toMatchObject({ ok: false, error: { code: 'HANDOFF_CONFLICT' } });
      expect(String(f.state.invoice[0].amount)).toBe(total);
      expect(f.state.invoiceLine.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0)).eq(total)).toBe(true);
      expect((await updateInvoice({ prisma: f.prisma, invoiceId, actor: finance, actorId: 'finance', input: { notes: 'Legitimate legacy note' } })).ok).toBe(true);
      expect((await updateInvoice({ prisma: f.prisma, invoiceId, actor: finance, actorId: 'finance',
        input: { amount: total, currency: 'USD', customerRelationId: 'customer', status: 'Issued' } })).ok).toBe(true);
      for (const input of [{ currency: 'CNY' }, { customerRelationId: 'foreign-customer' }, { type: 'Payable' }])
        expect(await updateInvoice({ prisma: f.prisma, invoiceId, actor: finance, actorId: 'finance', input }))
          .toMatchObject({ ok: false, error: { code: 'HANDOFF_CONFLICT' } });
      expect(String(f.state.invoice[0].amount)).toBe(total); expect(f.state.invoice[0].status).toBe('Issued');
    }
  });
  it('creates several commercial billing drafts before a first invoice without deriving price from costs', async () => {
    const f = developmentCiCommercialStorage(), context = { prisma: f.prisma, actor: sales };
    for (const index of [1, 2]) {
      const input = { requestKey: `new-${index}`, amount: '30.0001', currency: 'USD', note: 'Actual customer agreement',
        chargeLines: [line(`new-line-${index}`, 0, '30.0001', index)], costRecordIds: [] };
      const created = await commandDevelopmentCommercialBilling(context, 'case', null, input);
      expect(created.chargeLines[0]).toMatchObject({ amount: '30.0001', roundLabel: `R${index}` });
      expect(await commandDevelopmentCommercialBilling(context, 'case', null, input)).toMatchObject({ replayed: true, receipt: created.receipt });
    }
    expect(f.state.billingItem).toHaveLength(2); expect(f.state.costRecord).toHaveLength(0);
  });
  it('rejects explicitly selected unsupported/unresolved costs and rolls back all commercial writes', async () => {
    for (const costId of ['unsupported', 'unresolved', 'invalid-amount']) {
      const f = developmentCiCommercialStorage(), context = { prisma: f.prisma, actor: sales }; unrelatedProblemCosts(f);
      await expect(commandDevelopmentCommercialBilling(context, 'case', null, { requestKey: `problem-${costId}`, amount: '30', currency: 'USD',
        note: 'Explicit customer agreement', chargeLines: [line('problem-line', 0, '30')], costRecordIds: [costId] })).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(f.state.billingItem).toEqual([]); expect(f.state.developmentBillingChargeLine).toEqual([]); expect(f.state.billingItemCostCoverage).toEqual([]);
    }
  });
  it('rejects unconfirmed development BI members on a manual invoice before business has signed a CI', async () => {
    const f = await ready();
    const result = await createInvoice({ prisma: f.prisma, actor: finance, actorId: 'finance', input: { invoiceNumber: 'UNCONFIRMED', type: 'Receivable', status: 'Draft', amount: '60',
      currency: 'USD', issueDate: fields.issueDate, customerRelationId: 'customer', invoiceLines: [{ sourceType: 'BillingItem', sourceId: 'b1', amount: '60', currency: 'USD' }] } });
    expect(result.ok).toBe(false); expect(f.state.invoice).toEqual([]); expect(f.state.invoiceLine).toEqual([]);
  });
  it('rejects revoked current grants even when replaying a commercial acknowledgement', async () => {
    const f = await ready(); f.tx.auth.scopes = ['products:read'];
    await expect(commandDevelopmentCommercialBilling(f.context, 'case', 'b1', { action: 'confirm', expectedVersion: 1, requestKey: 'confirm' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await listDevelopmentCommercialBillings(f.context, 'case')).billingItems).toHaveLength(2);
  });
});
