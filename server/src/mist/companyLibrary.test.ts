import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MistPrivateFiles } from './files';
import { MistRepository, type MistContract } from './repository';
import { MemoryMistDatabase, testActor, testAuthority, testContract } from './__tests__/support';

// 公司-部门-小组与数据范围 R1/R2：一家公司一个业务库，进入只看公司在职成员身份。
const COMPANY = '11111111-1111-4111-8111-111111111111', OTHER_COMPANY = '22222222-2222-4222-8222-222222222222';
const contract: MistContract = {
  ...testContract,
  mistCommandPermission: (command: any) => command.type === 'settings.update' ? null : testContract.mistCommandPermission(command),
  applyMistCommand: (state: any, command: any, context: any) => {
    if (command.type === 'settings.update') { state.settings.workspaceName = command.payload.workspaceName; return { state, result: {} }; }
    return testContract.applyMistCommand(state, command, context);
  },
};
let root: string, db: MemoryMistDatabase, auth: ReturnType<typeof testAuthority>, repo: MistRepository;
const member = (id: string, companyId = COMPANY) => ({ ...testActor(id), roles: [], companyId });
const money = (requestId: string, expectedRevision: number) => ({ requestId, expectedRevision, command: { type: 'money.add', payload: { cents: 5 } } });
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mist-company-'));
  db = new MemoryMistDatabase(); auth = testAuthority();
  auth.users.set('clerk', { active: true, permissions: ['finance:write'] });
  auth.users.set('admin', { active: true, permissions: ['users:write'] });
  for (const userId of ['owner', 'other', 'clerk', 'admin']) db.companyMembers.push({ companyId: COMPANY, userId, status: 'active' });
  repo = new MistRepository(db, contract, new MistPrivateFiles(root), auth.authorize);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('one company = one library', () => {
  it('lands every active member in the same library without grants, and never creates a second one', async () => {
    const first = await repo.create(member('owner'), { name: '公司' }, true);
    const second = await repo.create(member('clerk'), { name: '另一个' }, true);
    expect(second.id).toBe(first.id); expect(db.workspaces.size).toBe(1);
    expect([...db.workspaces.values()][0]).toMatchObject({ companyId: COMPANY, slug: `company@${COMPANY}` });
    expect(second.access).toMatchObject({ role: 'member', canManageMembers: false, canManageCompany: false });
    expect(second.state.memberIds).toEqual(['owner', 'other', 'clerk', 'admin']);
    expect((await repo.list(member('clerk'))).map(row => row.id)).toEqual([first.id]);
    expect((await repo.listSummaries(member('other'))).map(row => row.id)).toEqual([first.id]);
    expect((await repo.execute(member('clerk'), first.id, money('clerk-pay', 0))).receipt.revision).toBe(1);
    await expect(repo.create(member('owner'), { name: '新公司', slug: 'new', seed: 'empty' })).rejects.toMatchObject({ code: 'COMPANY_SINGLE_LIBRARY', status: 409 });
    expect(db.workspaces.size).toBe(1);
  });
  it('does not adopt a legacy demo seed for the company library', async () => {
    const library = await repo.create(member('owner'), { name: '公司', seed: 'demo' }, true);
    expect((library.state as any).money.cents).toBe(0);
  });
  it('drops departed members and the departed creator, and isolates other companies', async () => {
    const library = await repo.create(member('owner'), { name: '公司' }, true);
    db.companyMembers.find(m => m.userId === 'owner')!.status = 'left';
    db.accounts.set('other', { status: 'disabled' });
    const view = await repo.get(member('clerk'), library.id);
    expect(view.state.memberIds).toEqual(['clerk', 'admin']);
    await expect(repo.get(member('clerk', OTHER_COMPANY), library.id)).rejects.toMatchObject({ status: 404 });
    expect(await repo.list(member('clerk', OTHER_COMPANY))).toEqual([]);
    expect(await repo.revisionOf(member('clerk'), library.id)).toEqual({ id: library.id, revision: 0 });
  });
  it('has no recycle bin and no per-account grants', async () => {
    const library = await repo.create(member('owner'), { name: '公司' }, true);
    await expect(repo.changeArchive(member('owner'), library.id, { requestId: 'archive', expectedRevision: 0 }, 'archive')).rejects.toMatchObject({ code: 'COMPANY_SINGLE_LIBRARY' });
    await expect(repo.changeMember(member('owner'), library.id, { requestId: 'grant', expectedRevision: 0, action: 'add', account: 'outsider' })).rejects.toMatchObject({ code: 'COMPANY_SINGLE_LIBRARY' });
    expect(await repo.listArchived(member('owner'))).toEqual([]);
    db.workspaces.get(library.id)!.state.workspaceArchive = { at: '2026-10-27T00:00:00Z', actorId: 'owner' };
    expect((await repo.get(member('clerk'), library.id)).id).toBe(library.id);
  });
  it('lets company administrators, not the library creator, maintain company settings', async () => {
    const library = await repo.create(member('owner'), { name: '公司' }, true);
    const rename = (requestId: string, expectedRevision: number) => ({ requestId, expectedRevision, command: { type: 'settings.update', payload: { workspaceName: '改名' } } });
    await expect(repo.execute(member('owner'), library.id, rename('owner-rename', 0))).rejects.toMatchObject({ status: 403 });
    expect((await repo.get(member('admin'), library.id)).access).toMatchObject({ canManageCompany: true, canManageMembers: false });
    expect((await repo.execute(member('admin'), library.id, rename('admin-rename', 0))).receipt.revision).toBe(1);
  });
  it('lists only reviews assigned to the account; the library creator sees no others', async () => {
    const reviews = new MistRepository(db, { ...contract, getMistReviewTasks: () => [{ id: 'r1', kind: 'order', entityId: 'o1', status: 'pending', requesterId: 'clerk', reviewerIds: ['admin'], requiredPermission: 'users:write', title: '订单', fileIds: [], target: { id: 'o1' } } as any] }, new MistPrivateFiles(root), auth.authorize);
    const library = await reviews.create(member('owner'), { name: '公司' }, true);
    db.workspaces.get(library.id)!.state.reviewerIds = ['admin'];
    expect(await reviews.listReviews(member('owner'))).toEqual([]);
    expect((await reviews.listReviews(member('admin'))).map(row => row.id)).toEqual(['r1']);
  });
});
