import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMistState, applyMistCommand, mistCommandPermission } from '../shared/mistWorkspace';
import { MistRepository, type MistContract } from './repository';
import { MistPrivateFiles } from './files';
import { MIST_READ_SECTIONS } from './access';
import { MemoryMistDatabase, testActor, testAuthority } from './__tests__/support';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const contract: MistContract = { createMistState, applyMistCommand, mistCommandPermission };
let root: string, db: MemoryMistDatabase, auth: ReturnType<typeof testAuthority>, repo: MistRepository;
const member = (id: string) => ({ ...testActor(id), roles: [], companyId: COMPANY });
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mist-team-scope-'));
  db = new MemoryMistDatabase(); auth = testAuthority();
  auth.users.set('hr', { active: true, permissions: ['hr:write'] });
  auth.users.get('owner')!.permissions.push(mistCommandPermission({ type: 'market.customer.create', payload: {} } as any)!);
  for (const userId of ['owner', 'hr']) db.companyMembers.push({ companyId: COMPANY, userId, status: 'active' });
  db.teams.push({ id: 'team-c', name: '服装组 C', companyId: COMPANY }, { id: 'foreign', name: '别家小组', companyId: '22222222-2222-4222-8222-222222222222' }, { id: 'gone', name: '已解散', companyId: COMPANY, deletedAt: 1n });
  repo = new MistRepository(db, contract, new MistPrivateFiles(root), auth.authorize, () => new Date('2026-10-28T04:00:00Z'));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('team scopes in the company library', () => {
  it('lists only this company active teams, previews without writing, and saves with a receipt', async () => {
    const library = await repo.create(member('owner'), { name: '公司' }, true);
    const customerId = (await repo.execute(member('owner'), library.id, { requestId: 'customer', expectedRevision: 0, command: { type: 'market.customer.create', payload: { input: { name: 'H&M', country: 'SE', city: '', industry: '服装', ownerId: 'owner', grade: 'A', currency: 'USD', terms: '', incoterm: 'FOB', categories: '', creditLimit: 0, since: '2026-01-01' } } } as any })).receipt.result.id as string;
    expect((await repo.teamScopes(member('hr'), library.id)).teams.map(t => t.id)).toEqual(['team-c']);
    const draft = { teamId: 'team-c', conditions: [{ customerId, season: 'SS27' }], picks: [], exclusions: [] };
    const before = structuredClone(db.workspaces.get(library.id));
    expect((await repo.previewTeamScope(member('hr'), library.id, draft)).preview.counts).toEqual({ opportunity: 0, development: 0, quotation: 0, order: 0 });
    expect(db.workspaces.get(library.id)).toEqual(before);
    const saved = await repo.execute(member('hr'), library.id, { requestId: 'scope', expectedRevision: 1, command: { type: 'teamScope.save', payload: draft } as any });
    expect(saved.receipt.result).toMatchObject({ teamId: 'team-c' });
    const listed = (await repo.teamScopes(member('hr'), library.id)).teams[0];
    expect(listed.scope).toMatchObject({ teamName: '服装组 C', conditions: [{ customerId, season: 'SS27' }] });
    expect(listed.counts).toEqual({ opportunity: 0, development: 0, quotation: 0, order: 0 });
  });
  it('keeps saved scope details out of the ordinary workspace view without management rights', async () => {
    const library = await repo.create(member('owner'), { name: '公司' }, true);
    await repo.execute(member('hr'), library.id, { requestId: 'scope-private', expectedRevision: 0, command: { type: 'teamScope.save', payload: { teamId: 'team-c', conditions: [{ line: 'garment' }], note: 'internal', picks: [], exclusions: [] } } as any });
    const regular = await repo.get(member('owner'), library.id);
    expect(regular.state.teamScopes ?? []).toEqual([]);
    const manager = await repo.get(member('hr'), library.id);
    expect(manager.state.teamScopes).toHaveLength(1);
    expect(manager.state.teamScopes?.[0].history[0].note).toBe('internal');
    auth.users.set('reader', { active: true, permissions: [...new Set(MIST_READ_SECTIONS.flatMap(section => section.permissions))] });
    db.companyMembers.push({ companyId: COMPANY, userId: 'reader', status: 'active' });
    const fullReader = await repo.get(member('reader'), library.id);
    expect(fullReader.state.teamScopes ?? []).toEqual([]);
    expect(fullReader.state.events.some(event => event.entityType === 'teamScope')).toBe(false);
  });
  it('rejects teams of other companies or dissolved teams, and accounts without team management rights', async () => {
    const library = await repo.create(member('owner'), { name: '公司' }, true);
    for (const teamId of ['foreign', 'gone']) await expect(repo.previewTeamScope(member('hr'), library.id, { teamId, conditions: [{ line: 'garment' }] })).rejects.toMatchObject({ status: 422 });
    await expect(repo.execute(member('hr'), library.id, { requestId: 'foreign', expectedRevision: 0, command: { type: 'teamScope.save', payload: { teamId: 'foreign', conditions: [{ line: 'garment' }] } } as any })).rejects.toMatchObject({ status: 422 });
    auth.users.set('clerk', { active: true, permissions: ['orders:write'] }); db.companyMembers.push({ companyId: COMPANY, userId: 'clerk', status: 'active' });
    await expect(repo.teamScopes(member('clerk'), library.id)).rejects.toMatchObject({ status: 403 });
    await expect(repo.execute(member('clerk'), library.id, { requestId: 'clerk', expectedRevision: 0, command: { type: 'teamScope.save', payload: { teamId: 'team-c', conditions: [{ line: 'garment' }] } } as any })).rejects.toMatchObject({ status: 403 });
  });
});
