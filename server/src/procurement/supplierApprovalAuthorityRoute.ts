/**
 * 供应商承诺审批名单（公司管理 › 审批资格 使用）。
 *
 * 旧 `/api/v1/procurement` 采购与合同 REST 已退役（Mist 不再调用，现网零流量）；这两个端点仍是公司配置面，
 * 所以单独挂载在原路径 `/api/v1/procurement/contracts/approval-authority/:kind/:family`，行为不变：
 * 读写都先重载当前账号（freshSupplierActor 'config'），名单按会话公司存放（supplierCommitmentAuthority）。
 */
import { Router, type Request, type Response, type RequestHandler } from 'express';
import { Prisma, type PrismaClient } from '@prisma/client';
import { extractActorFromRequest } from '../auth/middleware';
import { createModuleAuthGuard, requireJwtForWrite } from '../auth/moduleGuard';
import { logger } from '../lib/logger';
import { setSupplierApprovalAuthority, supplierAuthorityConfigId, supplierAuthorityKey } from './supplierCommitmentAuthority';
import { freshSupplierActor } from './supplierContractAccess';
import { SupplierContractError, supplierFail, supplierObject, supplierText, type SupplierContractKind } from './supplierContractPolicy';

export function createSupplierApprovalAuthorityRouter(options: { prisma: PrismaClient; requireAuth: boolean; apiKeys: Set<string> }): Router {
  const router = Router();
  router.use(createModuleAuthGuard({ requireAuth: options.requireAuth, apiKeys: options.apiKeys }));
  const write = requireJwtForWrite(options);
  const actorOf = (req: Request) => extractActorFromRequest(req) ?? supplierFail('UNAUTHORIZED', '请使用真实账号登录供应商公司。', 401);
  const kindOf = (req: Request): SupplierContractKind => req.params.kind === 'purchase' || req.params.kind === 'processing' ? req.params.kind : supplierFail('INVALID_CONTRACT_KIND', '请选择采购或加工合同。');
  const familyOf = (req: Request): 'fabric' | 'garment' => req.params.family === 'fabric' || req.params.family === 'garment' ? req.params.family : supplierFail('INVALID_INPUT', '请选择准确业务域。');
  const run = (work: (req: Request, res: Response) => Promise<unknown>): RequestHandler => async (req, res) => {
    try { await work(req, res); } catch (error) {
      if (error instanceof SupplierContractError) { res.status(error.statusCode).json({ ok: false, error: error.message, code: error.code }); return; }
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) {
        res.status(409).json({ ok: false, error: '审批名单已被其他操作更新，请刷新后核对。', code: 'CONCURRENT_UPDATE' }); return;
      }
      logger.error('[SupplierApprovalAuthority] failed', { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ ok: false, error: '审批名单暂不可读取或保存，请稍后重试。', code: 'SUPPLIER_COMMAND_UNAVAILABLE' });
    }
  };
  router.get('/:kind/:family', run(async (req, res) => {
    const kind = kindOf(req), family = familyOf(req), actor = actorOf(req);
    const item = await options.prisma.$transaction(async tx => {
      await freshSupplierActor(tx, actor, 'config');
      const key = supplierAuthorityKey(kind, family), row = await tx.systemConfig.findUnique({ where: { id: supplierAuthorityConfigId(key, actor.companyId ?? null) } });
      let value: unknown = row?.value; if (typeof value === 'string') { try { value = JSON.parse(value); } catch { value = null; } }
      return { key, version: row?.version ?? 0, userIds: Array.isArray(supplierObject(value).userIds) ? supplierObject(value).userIds : [] };
    });
    res.json({ ok: true, item });
  }));
  router.put('/:kind/:family', write, run(async (req, res) => {
    const row = supplierObject(req.body), result = await setSupplierApprovalAuthority({ prisma: options.prisma, actor: actorOf(req), kind: kindOf(req), family: familyOf(req),
      requestKey: supplierText(row.requestKey, '原请求标识', 150), userIds: row.userIds as string[], expectedConfigVersion: row.expectedConfigVersion as number, reason: supplierText(row.reason, '配置理由', 2000) });
    res.json(result);
  }));
  return router;
}
