import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../devPanel/activeDb', () => ({ getActiveDb: () => 'panda_hub_dev' }));
vi.mock('../../audit/routeAudit', () => ({ writeRouteAuditLog: vi.fn(async () => 'audit-clock') }));
import { FIXED_BUSINESS_TIME_ISO } from '../businessClock';
import { nextBusinessNumber } from '../businessNumberService';
import { renderFormatTemplate } from '../../sequence/sequenceService';
import { evaluateLcEligibility } from '../../customs/lcGate';
import { resolveCreditException } from '../../credit/creditExceptionGate';
import type { ExceptionService } from '../../exceptions/exceptionService';

const WALL_TIME = new Date('2034-12-31T18:00:00.000Z');
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('BAMBOOK_DEV_PANEL', '1');
  vi.stubEnv('DATABASE_URL', 'postgresql://clock-test:unused@127.0.0.1:1/panda_hub_dev');
  vi.stubEnv('BAMBOOK_DEV_BUSINESS_TIME', FIXED_BUSINESS_TIME_ISO); vi.stubEnv('TZ', 'UTC');
  vi.useFakeTimers(); vi.setSystemTime(WALL_TIME);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('business consumers retain the development as-of date when process time changes', () => {
  it('uses the business date in new numbers while preserving explicit history and wall-clock sequence metadata', async () => {
    const sequence = { upsert: vi.fn(async () => ({ seq: 0 })), update: vi.fn(async () => ({ seq: 1 })),
      findUnique: vi.fn(async () => null), deleteMany: vi.fn(async () => ({ count: 0 })) };
    expect(await nextBusinessNumber({ businessSequence: sequence }, 'INV')).toBe('INV-2026-0001');
    expect(sequence.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({
      year: 2026, updatedAt: BigInt(WALL_TIME.getTime()),
    }) }));
    expect(renderFormatTemplate('{prefix}-{year}{month}{day}-{seq}', { prefix: 'PO', seq: 1 })).toBe('PO-20261008-0001');
    const historical = new Date('2024-02-28T17:00:00.000Z');
    expect(renderFormatTemplate('{year}{month}{day}', { prefix: 'PO', seq: 1, date: historical })).toBe('20240229');
    expect(historical.toISOString()).toBe('2024-02-28T17:00:00.000Z');
  });

  it('keeps LC valid under the fixed date and enforces Shanghai end-of-day independently of the host timezone', () => {
    const lc = { id: 'LC-1', lcNumber: 'LC-1', status: 'Issued', expiryDate: '2026-10-09', shipmentDeadline: '2026-10-09' };
    expect(evaluateLcEligibility({ stage: 'shipment:release', orderInstrument: 'L/C', lc })).toMatchObject({ eligible: true });
    vi.stubEnv('TZ', 'UTC');
    expect(evaluateLcEligibility({ stage: 'shipment:release', orderInstrument: 'L/C',
      lc: { ...lc, expiryDate: '2026-10-08', shipmentDeadline: '2026-10-08' }, at: new Date('2026-10-08T16:00:00Z') }))
      .toMatchObject({ eligible: false, blockingReasons: ['LC_EXPIRED', 'LC_SHIPMENT_DEADLINE_PASSED'] });
    expect(evaluateLcEligibility({ stage: 'order:confirm', orderInstrument: 'L/C', lc: { ...lc, expiryDate: '2026-02-30' } }))
      .toMatchObject({ eligible: false, blockingReasons: ['LC_EXPIRY_UNREADABLE'] });
  });

  it('opens the credit-exception business window from the fixed instant without extending it to process time', async () => {
    const createRequest = vi.fn(async () => ({ ok: true as const, data: { exception: { id: 'EXC-1', approvalRequestId: 'APR-1' } } }));
    const exceptionService = { hasActiveException: vi.fn(async () => ({ active: false as const })),
      createExceptionRequest: createRequest } as unknown as ExceptionService;
    await expect(resolveCreditException({ exceptionService, actorId: 'U-1', blockReason: '信用冻结',
      scope: { targetType: 'Order', targetId: 'O-1', action: 'order:confirm' } })).resolves.toMatchObject({ passed: false });
    expect(createRequest).toHaveBeenCalledWith(expect.objectContaining({
      validUntil: new Date('2026-10-15T00:18:00.000Z'), maxUses: 1, targetId: 'O-1',
    }));
    expect(Date.now()).toBe(WALL_TIME.getTime());
  });
  // 2026-11-06: order schedule, sample room and email follow-up consumers were deleted with the legacy main API.
});
