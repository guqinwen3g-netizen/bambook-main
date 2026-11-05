import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { extractActorFromRequest } from '../auth/middleware';
import { safeRouteError } from '../shared/routeError';
import { documentSourceJson } from '../shipping/shipmentDocumentSource';
import { getFabricCommissionDocument, listPendingFabricCommissionReceivables, registerFabricCommissionReceivable } from './fabricCommissionService';

const handler = (run: (req: Request) => Promise<unknown>, status = 200) => async (req: Request, res: Response) => {
  try { const value = await run(req); res.status(value && typeof value === 'object' && 'replayed' in value && value.replayed ? 200 : status)
    .json(documentSourceJson({ ok: true, ...value as object })); }
  catch (error) { const safe = safeRouteError(error, { fallbackCode: 'INTERNAL_ERROR', fallbackMessage: '佣金结果暂不可确认，请保留原请求核对实际来源。' });
    res.status(safe.status).json({ ok: false, error: { code: safe.code, message: safe.message } }); }
};
/** Mount below authenticated /finance/fabric-commission-cis. */
export function createFabricCommissionFinanceRouter({ prisma }: { prisma: PrismaClient }) {
  const router = Router();
  router.get('/', handler(req => listPendingFabricCommissionReceivables(prisma, extractActorFromRequest(req))));
  router.get('/:documentId', handler(req => getFabricCommissionDocument(prisma, extractActorFromRequest(req), req.params.documentId)));
  router.post('/:documentId/register', handler(req => registerFabricCommissionReceivable(prisma, extractActorFromRequest(req), req.params.documentId, req.body), 201));
  return router;
}
