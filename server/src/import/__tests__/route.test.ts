import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createImportRouter, ImportRouterOptions } from '../route';

import { TEST_PROFILE, syntheticPoPdf } from './helpers/syntheticPdf';

const PO_A = syntheticPoPdf('4500900001', 4);
const PO_B = syntheticPoPdf('4500900005', 2);

function makeApp(opts?: Partial<ImportRouterOptions>) {
  const app = express();
  app.use(
    '/api/v1/import',
    createImportRouter({
      requireAuth: false,
      apiKeys: new Set<string>(),
      loadDetectionProfiles: async () => [TEST_PROFILE],
      ...opts,
    }),
  );
  return app;
}

describe('POST /api/v1/import/order', () => {
  it('parses one PDF', async () => {
    const res = await request(makeApp())
      .post('/api/v1/import/order')
      .attach('files', PO_A, 'a.pdf');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    const r = res.body.results[0];
    expect(r.detection.customerId).toBe('peerless');
    expect(r.order.poNumber).toBe('4500900001');
    expect(r.order.lines).toHaveLength(4);
    expect(r.error).toBeNull();
  });

  it('parses multiple PDFs and reports each', async () => {
    const res = await request(makeApp())
      .post('/api/v1/import/order')
      .attach('files', PO_A, 'a.pdf')
      .attach('files', PO_B, 'b.pdf');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    const pos = res.body.results.map((r: any) => r.order.poNumber).sort();
    expect(pos).toEqual(['4500900001', '4500900005']);
  });

  it('without a profile loader ⇒ detection only', async () => {
    const res = await request(makeApp({ loadDetectionProfiles: undefined }))
      .post('/api/v1/import/order')
      .attach('files', PO_A, 'a.pdf');
    expect(res.status).toBe(200);
    expect(res.body.results[0].detection.customerId).toBeNull();
    expect(res.body.results[0].order).toBeNull();
  });

  it('500 when the customer profiles cannot be read', async () => {
    const res = await request(
      makeApp({ loadDetectionProfiles: async () => { throw new Error('db down'); } }),
    )
      .post('/api/v1/import/order')
      .attach('files', PO_A, 'a.pdf');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DETECTION_PROFILES_UNAVAILABLE');
  });

  it('400 when no file is attached', async () => {
    const res = await request(makeApp()).post('/api/v1/import/order');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('NO_FILES');
  });

  // Auth middleware runs before multer; sending a file body would just race with
  // the early-reject and trigger a flaky EPIPE. The auth check itself does not
  // depend on the body, so we omit it.
  it('401 when auth required and key missing', async () => {
    const res = await request(makeApp({ requireAuth: true, apiKeys: new Set(['k1']) }))
      .post('/api/v1/import/order');
    expect(res.status).toBe(401);
  });

  it('403 when key is wrong', async () => {
    const res = await request(makeApp({ requireAuth: true, apiKeys: new Set(['k1']) }))
      .post('/api/v1/import/order')
      .set('X-Bambook-API-Key', 'wrong');
    expect(res.status).toBe(403);
  });

  it('200 when auth required and key matches', async () => {
    const res = await request(makeApp({ requireAuth: true, apiKeys: new Set(['k1']) }))
      .post('/api/v1/import/order')
      .set('X-Bambook-API-Key', 'k1')
      .attach('files', PO_A, 'a.pdf');
    expect(res.status).toBe(200);
    expect(res.body.results[0].order.poNumber).toBe('4500900001');
  });
});
