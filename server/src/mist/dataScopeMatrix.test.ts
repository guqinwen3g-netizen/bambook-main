import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createMistState, applyMistCommand, mistCommandPermission } from '../shared/mistWorkspace';
import { getDefaultScopeListForRole, SYSTEM_ROLE_IDS, type SystemRoleId } from '../_shared/rolePermissionMatrix';
import { MistRepository, type MistContract } from './repository';
import { MistPrivateFiles } from './files';
import { MemoryMistDatabase, testAuthority } from './__tests__/support';

// 规格 §2 / P3：岗位 × 越权读写矩阵。示例数据：customer-0、customer-2 跟进人 demo-sales，customer-1 跟进人 demo-buyer。
const COMPANY = '11111111-1111-4111-8111-111111111111';
const ALL_ORDERS = ['id-320', 'id-300', 'id-165', 'SO-G-2026-018', 'SO-G-2026-017', 'SO-G-2026-015', 'SO-G-2026-012', 'SO-G-2026-009'];
const contract: MistContract = { createMistState, applyMistCommand, mistCommandPermission };
const PEOPLE: Record<string, { role: SystemRoleId | 'owner' }> = {
  boss: { role: 'owner' }, finance: { role: SYSTEM_ROLE_IDS.FINANCE }, qc: { role: SYSTEM_ROLE_IDS.QC }, logistics: { role: SYSTEM_ROLE_IDS.LOGISTICS },
  head: { role: SYSTEM_ROLE_IDS.SALES_MANAGER }, 'demo-sales': { role: SYSTEM_ROLE_IDS.SALES }, 'demo-buyer': { role: SYSTEM_ROLE_IDS.SALES }, teammate: { role: SYSTEM_ROLE_IDS.SALES }, loner: { role: SYSTEM_ROLE_IDS.SALES },
};
let root: string, db: MemoryMistDatabase, repo: MistRepository, workspaceId: string, auth: ReturnType<typeof testAuthority>;
const actor = (userId: string): any => { const role = PEOPLE[userId].role; return role === 'owner' ? { userId, displayName: userId, roles: ['owner'], departmentIds: [], companyId: COMPANY } : { userId, displayName: userId, roles: [], roleIds: [`${role}@${COMPANY}`], departmentIds: [], companyId: COMPANY, authorizationLoaded: true }; };
const orders = async (userId: string) => (await repo.get(actor(userId), workspaceId)).state.orders.map(o => o.id).sort();
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mist-scope-matrix-'));
  db = new MemoryMistDatabase(); auth = testAuthority();
  for (const [userId, { role }] of Object.entries(PEOPLE)) { auth.users.set(userId, { active: true, permissions: role === 'owner' ? getDefaultScopeListForRole(SYSTEM_ROLE_IDS.SUPER_ADMIN) : getDefaultScopeListForRole(role) }); db.companyMembers.push({ companyId: COMPANY, userId, status: 'active' }); }
  // 部门：业务部（负责人 head）→ 二组（demo-buyer 所在）。
  db.departments.push({ id: 'sales-dept', companyId: COMPANY, parentId: null, headId: 'head' }, { id: 'sales-2', companyId: COMPANY, parentId: 'sales-dept', headId: null });
  db.userDepartments.set('demo-buyer', 'sales-2');
  // 小组：teammate 在「Maison Lune 组」，范围为 customer-2 全部。
  db.teams.push({ id: 'team-lune', name: 'Maison Lune 组', companyId: COMPANY }); db.teamMembers.push({ teamId: 'team-lune', userId: 'teammate' });
  let n = 0; const state: any = createMistState({ id: () => `id-${++n}`, now: '2026-10-13T00:00:00Z', actorName: 'boss' } as any, 'demo');
  state.teamScopes = [{ teamId: 'team-lune', teamName: 'Maison Lune 组', conditions: [{ id: 'c1', customerId: 'customer-2' }], picks: [], exclusions: [], updatedAt: '', updatedById: 'boss', updatedBy: 'boss', history: [] }];
  workspaceId = randomUUID();
  db.workspaces.set(workspaceId, { id: workspaceId, ownerId: 'boss', companyId: COMPANY, slug: `company@${COMPANY}`, name: '公司', revision: 0, state, createdAt: new Date(), updatedAt: new Date() });
  repo = new MistRepository(db, contract, new MistPrivateFiles(root), auth.authorize, () => new Date('2026-10-13T04:00:00Z'));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('row-level data scope by role', () => {
  it.each(['boss', 'finance', 'qc', 'logistics'])('%s sees every order company-wide', async userId => {
    expect(await orders(userId)).toEqual([...ALL_ORDERS].sort());
  });
  it('a salesperson sees own orders and orders of customers they follow, with their downstream only', async () => {
    expect(await orders('demo-sales')).toEqual(['SO-G-2026-009', 'SO-G-2026-012', 'SO-G-2026-015', 'SO-G-2026-018', 'id-165']);
    const state = (await repo.get(actor('demo-sales'), workspaceId)).state;
    expect(state.orderLines.every(line => ['SO-G-2026-009', 'SO-G-2026-012', 'SO-G-2026-015', 'SO-G-2026-018', 'id-165'].includes(line.orderId))).toBe(true);
    expect(state.fulfillment.purchases.every(p => p.orderId !== 'SO-G-2026-017')).toBe(true);
    expect(state.tasks.some(task => task.target?.view === 'orders/detail' && task.target.id === 'SO-G-2026-017' && !task.assigneeIds?.includes('demo-sales'))).toBe(false); // 指派给本人的待办保留
    expect(state.customers).toHaveLength(6); // 档案全公司共享
  });
  it.each(['demo-sales', 'demo-buyer', 'loner'])('%s can read company marketing and seasonal materials while orders stay scoped', async userId => {
    const raw = db.workspaces.get(workspaceId)!.state;
    const view = (await repo.get(actor(userId), workspaceId)).state;
    expect(view.market.leads).toEqual(raw.market.leads);
    expect(view.market.campaigns).toEqual(raw.market.campaigns);
    expect(view.market.lookbooks).toEqual(raw.market.lookbooks);
    expect(view.market.seasons).toEqual(raw.market.seasons);
    expect(view.market.trends).toEqual(raw.market.trends);
    expect(view.market.shows).toEqual(raw.market.shows);
    expect(view.orders.length).toBeLessThan(raw.orders.length);
  });
  it('a salesperson without customers, orders or groups sees no business records', async () => {
    const state = (await repo.get(actor('loner'), workspaceId)).state;
    expect(state.orders).toEqual([]); expect(state.devs).toEqual([]); expect(state.market.quotations).toEqual([]); expect(state.crm.opportunities).toEqual([]);
    expect(state.invoices).toEqual([]); expect(state.fulfillment.shipments).toEqual([]);
  });
  it('a department head sees members of the department and its sub-departments', async () => {
    expect(await orders('head')).toEqual(expect.arrayContaining(['SO-G-2026-017', 'id-320', 'id-300']));
    expect(await orders('head')).not.toContain('SO-G-2026-018');
  });
  it('a group member sees the group scope and nothing else', async () => {
    expect(await orders('teammate')).toEqual(['SO-G-2026-012']);
    db.teamMembers[0].leftAt = new Date();
    expect(await orders('teammate')).toEqual([]);
  });
  it('rejects writes to records outside the scope and keeps the data unchanged', async () => {
    const before = structuredClone(db.workspaces.get(workspaceId));
    const update = (userId: string, orderId: string) => repo.execute(actor(userId), workspaceId, { requestId: `${userId}-${orderId}`, expectedRevision: 0, command: { type: 'order.checklist', payload: { orderId, itemId: `${orderId}-check-0`, done: false } } as any });
    await expect(update('demo-sales', 'SO-G-2026-017')).rejects.toMatchObject({ status: 404 });
    await expect(update('teammate', 'SO-G-2026-018')).rejects.toMatchObject({ status: 404 });
    expect(db.workspaces.get(workspaceId)).toEqual(before);
    const response = await update('demo-buyer', 'SO-G-2026-017');
    expect(response.receipt.revision).toBe(1);
    expect(response.workspace.state.orders.map(o => o.id)).not.toContain('SO-G-2026-018');
  });
  it('does not expose an out-of-scope credit through document endpoints', async () => {
    const row = db.workspaces.get(workspaceId)!;
    row.state.platform.credits = [{ id: 'private-credit', claimId: 'private-claim', printVersions: [], sourceVersions: [] }];
    await expect(repo.previewCreditDocument(actor('loner'), workspaceId, 'private-credit', 'version')).rejects.toMatchObject({ code: 'CREDIT_DOCUMENT_NOT_FOUND', status: 404 });
    await expect(repo.downloadCreditDocument(actor('loner'), workspaceId, 'private-credit', 'version')).rejects.toMatchObject({ code: 'CREDIT_DOCUMENT_NOT_FOUND', status: 404 });
  });
  it('returns only the visible allocations of a shared receipt in the authenticated workspace', async () => {
    const state: any = db.workspaces.get(workspaceId)!.state;
    state.invoices.push({id:'mine-invoice',orderId:'SO-G-2026-018'}, {id:'private-invoice',orderId:'SO-G-2026-017'});
    state.receipts.push({id:'shared-receipt',code:'SHARED',date:'2026-10-01',payer:'客户',amount:1000,remaining:0,currency:'USD',ref:'private reference',state:'matched'});
    state.allocations.push({id:'mine-allocation',receiptId:'shared-receipt',invoiceId:'mine-invoice',amount:400,currency:'USD'}, {id:'private-allocation',receiptId:'shared-receipt',invoiceId:'private-invoice',amount:600,currency:'USD'});
    const view = (await repo.get(actor('demo-sales'), workspaceId)).state;
    expect(view.receipts.some(row=>row.id==='shared-receipt')).toBe(false);
    expect(view.partialReceipts?.find(row=>row.id==='shared-receipt')).toMatchObject({visibleAllocatedAmount:400,hiddenCount:1});
    expect(view.allocations.some(row=>row.id==='private-allocation')).toBe(false);
    expect(JSON.stringify(view.partialReceipts)).not.toContain('private reference');
  });
  it('rejects generating an original customer statement containing out-of-scope facts before writing a file', async () => {
    const source = db.workspaces.get(workspaceId)!.state as any;
    const customer = source.customers.find((row:any)=>row.ownerId==='demo-buyer');
    source.orders.push({ ...source.orders[0], id:'visible-order', customerId:customer.id, ownerId:'demo-sales' });
    source.orders.push({ ...source.orders[0], id:'private-order', customerId:customer.id, ownerId:'other-person' });
    source.invoices.push({ ...source.invoices[0], id:'private-customer-invoice', orderId:'private-order', customerId:customer.id });
    auth.users.get('demo-sales')!.permissions.push('invoices:write');
    const before=structuredClone(db.workspaces.get(workspaceId));
    await expect(repo.execute(actor('demo-sales'),workspaceId,{requestId:'partial-statement',expectedRevision:0,command:{type:'finance.statement.generate',payload:{customerId:customer.id}} as any})).rejects.toMatchObject({status:403});
    expect(db.workspaces.get(workspaceId)).toEqual(before);
    expect(db.receipts.size).toBe(0);
  });
  it('hides files referenced only by records outside the scope', async () => {
    const full = (await repo.get(actor('boss'), workspaceId)).state.files.length, scoped = (await repo.get(actor('loner'), workspaceId)).state.files.length;
    expect(scoped).toBeLessThan(full);
  });
});
