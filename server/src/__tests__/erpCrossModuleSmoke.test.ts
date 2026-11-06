/**
 * ERP OS 横向 smoke pack (task_mr3e5odm)
 *
 * 2026-11-06：主 API（index.ts）只保留 http/liveApiSurface.ts 列出的路径；旧业务路由及其路由文件已删除。
 * L1 部分因此从"必须挂载"反转为"不得挂载"，并保留在用接口、在线面守卫与旧定时任务守卫；
 * L2 部分只核对仍被 Mist 或保留接口使用的服务（源码契约断言，不连 DB）。
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function read(rel: string): string {
  // __dirname = server/src/__tests__，rel 形如 'finance/invoiceMutationService.ts'
  return fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf-8');
}

const MODULES = {
  finance: {
    invoiceSvc: read('finance/invoiceMutationService.ts'),
    allocationSvc: read('finance/allocationService.ts'),
  },
  relations: {
    svc: read('relations/relationMutationService.ts'),
  },
  orders: {
    lifecycleSvc: read('orders/orderLifecycleService.ts'),
  },
  development: {
    svc: read('development/convertService.ts'),
  },
  entities: {
    sync: read('entities/sync.ts'),
  },
  index: read('index.ts'),
};

describe('主 API 挂载面（index.ts 事实源）', () => {
  const IDX = MODULES.index;
  const code = IDX.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

  it('在线面守卫挂在 /api 上，保留的接口仍在原路径', () => {
    expect(IDX).toContain("app.use('/api', liveApiSurface)");
    expect(IDX).toContain("app.get('/api/health', createHealthHandler(");
    for (const mount of ["app.use('/api/auth', createAuthRouter(", "app.use('/api/admin', createAdminRouter(",
      "app.use('/api/platform', createPlatformRouter(", "app.use('/api/hr', createHRRouter(",
      "app.use('/api/dev', createDevPanelRouter("]) expect(IDX).toContain(mount);
  });

  it('Supplier approver lists stay mounted at their original path', () => {
    expect(IDX).toContain("app.use('/api/v1/procurement/contracts/approval-authority', createSupplierApprovalAuthorityRouter(");
  });

  // 旧 REST 业务面 2026-11-06 删除（Mist 走 /api/mist）。防回挂：谁重新挂载会当场咬红。
  it('旧业务路由不得再挂载（finance/shipping/relations/products/development/email/entities/knowledge/orders/approvals/procurement 等）', () => {
    for (const factory of ['createFinanceRouter', 'createShippingRouter', 'createRelationsRouter', 'createProductsRouter',
      'createDevelopmentRouter', 'createEmailRouter', 'createEntitiesRouter', 'createKnowledgeDocumentsRouter',
      'createAgentRouter', 'createAiRouter', 'createCustomerPortalRouter', 'createOrderLinesRouter',
      'createOrdersRouter', 'createOrdersV2Router', 'createProcurementRouter', 'createApprovalRouter', 'createApprovalKernelRouter',
      'createInternalFabricAllocationRouter', 'createFabricCommissionBusinessRouter', 'createOrderBusinessWorkspaceRouter',
      'createImportRouter']) expect(code).not.toContain(factory);
    for (const mount of ["'/api/v1/finance'", "'/api/v1/shipping'", "'/api/v1/relations'", "'/api/v1/products'",
      "'/api/v1/development'", "'/api/v1/email'", "'/api/v1/entities'", "'/api/v1/knowledge-documents'",
      "'/api/v1/orders'", "'/api/v2/orders'", "'/api/v1/approvals'", "'/api/v1/approvals-kernel'", "'/api/v1/procurement'",
      '/api/v1/import', "'/api/uploads'", "'/api/app'"]) expect(code).not.toContain(mount);
  });

  // 旧主 API 定时任务 2026-11-06 停止启动并删除（只扫空的旧业务表、写 Mist 不读的旧通知，且每天报错）。
  it('Legacy scheduler is not started by the main API', () => {
    expect(IDX).not.toMatch(/\bstartScheduler\b/);
    expect(IDX).not.toContain("from './scheduler'");
    expect(fs.existsSync(path.resolve(__dirname, '../scheduler'))).toBe(false);
  });

  it('旧事件联动、通知绑定、工作流与 PDML 同步不再随主 API 启动', () => {
    for (const startup of ['registerAllLinkages', 'initializeNotificationBindings', 'seedDefaultWorkflowDefinitions',
      'registerWorkflowEventTriggers', 'startPdmlSyncScheduler', 'createAiRuntime', 'createMacMiniChatRunner']) {
      expect(code).not.toContain(startup);
    }
  });
});

describe('ERP OS 横向 smoke · L2 service 事务/审计边界', () => {
  it('Finance: invoiceMutationService 含 writeRouteAuditLog', () => {
    expect(MODULES.finance.invoiceSvc).toContain('writeRouteAuditLog');
  });

  it('Finance: allocationService 含 writeRouteAuditLog', () => {
    expect(MODULES.finance.allocationSvc).toContain('writeRouteAuditLog');
  });

  it('Relations: relationMutationService delete 含 deactivateEntityLinks', () => {
    expect(MODULES.relations.svc).toContain('deactivateEntityLinks');
  });

  it('Development: convertService 导出 convertDevCaseToOrder', () => {
    expect(MODULES.development.svc).toMatch(/export async function convertDevCaseToOrder/);
  });

  it('Orders: orderLifecycleService 含 deactivateEntityLinks（delete 时清理）', () => {
    expect(MODULES.orders.lifecycleSvc).toContain('deactivateEntityLinks');
  });
});

describe('ERP OS 横向 smoke · entities sync 被多模块复用', () => {
  it('entities/sync.ts 导出 syncShipmentReferences / deactivateEntityLinks', () => {
    const sync = MODULES.entities.sync;
    expect(sync).toContain('syncShipmentReferences');
    expect(sync).toContain('deactivateEntityLinks');
  });

  it('relations + orders 都 import deactivateEntityLinks', () => {
    expect(MODULES.relations.svc).toContain('deactivateEntityLinks');
    expect(MODULES.orders.lifecycleSvc).toContain('deactivateEntityLinks');
  });
});
