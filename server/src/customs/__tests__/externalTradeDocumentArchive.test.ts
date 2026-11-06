import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import JSZip from 'jszip';
import { createAuthService } from '../../auth/service';
import { createCustomsService } from '../customsService';
import { generateTradeDocumentFile, generateTradeDocumentsFromShipment, renderTradeDocumentServerHtml } from '../tradeDocumentLifecycleService';
import { storage, actor } from './ciCentralHttpStorage';

const auth = createAuthService();
const readOnlyToken = auth.signToken({ ...actor, permissions: ['customs:read'], permissionCeiling: ['customs:read'], departmentIds: [] });
const originalUploadRoot = process.env.BAMBOOK_UPLOAD_DIR;
let uploadRoot = '';

function externalDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'TD_EXTERNAL', documentNumber: 'BL-2026-0001', domain: 'customs', type: 'BillOfLading', status: 'Draft',
    shipmentId: null, declarationId: null, orderId: null, relationId: null, sourceRef: null,
    sourceInvoiceId: null, filePath: null, fileName: null, createdAt: BigInt(1), updatedAt: BigInt(1), deletedAt: null,
    ...overrides,
  };
}

function finalRouteHandler(router: any, method: 'get' | 'post', routePath: string) {
  const layer = router.stack.find((candidate: any) => candidate.route?.path === routePath && candidate.route?.methods?.[method]);
  if (!layer) throw new Error(`Route not found: ${method} ${routePath}`);
  return layer.route.stack.at(-1).handle;
}

async function invokeRoute(router: any, method: 'get' | 'post', routePath: string, input: { params?: any; query?: any; body?: any } = {}) {
  const res: any = { statusCode: 200, headers: {}, body: undefined, sent: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    setHeader(name: string, value: string) { this.headers[name] = value; return this; },
    send(body: unknown) { this.sent = body; return this; },
  };
  const req: any = { params: input.params ?? {}, query: input.query ?? {}, body: input.body ?? {}, actor, authSource: 'user-session', headers: {} };
  await finalRouteHandler(router, method, routePath)(req, res, () => {});
  return res;
}

beforeEach(() => {
  uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bambook-external-doc-'));
  process.env.BAMBOOK_UPLOAD_DIR = uploadRoot;
});
afterEach(() => {
  if (originalUploadRoot === undefined) delete process.env.BAMBOOK_UPLOAD_DIR;
  else process.env.BAMBOOK_UPLOAD_DIR = originalUploadRoot;
  fs.rmSync(uploadRoot, { recursive: true, force: true });
});

describe('external trade document archive-only workflow', () => {

  it('links an external document to the exact existing LetterOfCredit and derives the linked parties', async () => {
    const f = storage();
    f.tables.letterOfCredit.push({ id: 'LC-EXACT', lcNumber: 'LC-2026-1', orderId: 'O', relationId: 'R', deletedAt: null });
    const service = createCustomsService(f.db as any);
    const created = await service.createTradeDocument({ type: 'BillOfLading', sourceRef: 'LC-EXACT' }, actor.userId);
    expect(created).toMatchObject({ sourceRef: 'LC-EXACT', orderId: 'O', relationId: 'R' });
    await expect(service.createTradeDocument({ type: 'BillOfLading', sourceRef: 'MISSING-LC' }, actor.userId)).rejects.toThrow('信用证不存在');
    await expect(service.createTradeDocument({ type: 'BillOfLading', sourceRef: 'LC-EXACT', relationId: 'OTHER' }, actor.userId)).rejects.toThrow('客户必须与所关联信用证');
    expect(f.tables.tradeDocument).toHaveLength(1);
  });

  it('blocks template generation and preview for external customs documents', async () => {
    const types = ['CertificateOfOrigin', 'BillOfLading', 'AirWaybill', 'InsuranceCert', 'InspectionCert', 'PhytosanitaryCert', 'ExportDeclarationProof', 'Other'];
    for (const type of types) {
      const doc = externalDocument({ type });
      const prisma: any = { tradeDocument: { findFirst: async () => doc } };
      await expect(generateTradeDocumentFile(prisma, { id: doc.id, html: '<h1>fake template</h1>', actorId: actor.userId })).rejects.toThrow('不可由系统模板生成');
      await expect(renderTradeDocumentServerHtml(prisma, doc as any)).rejects.toThrow('不从订单数据预览或生成模板');
      await expect(generateTradeDocumentsFromShipment(prisma, { shipmentId: 'S-1', types: [type] as any, actorId: actor.userId })).rejects.toThrow('只生成我方商业发票和装箱单');
    }
  });
});
