import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MistRepository } from './repository';
import { MistPrivateFiles } from './files';
import { AGENT_AUDIT_FIELD, AGENT_AUDIT_PREFIX, agentAuditReceiptId, type AgentCommandAudit } from './agentAudit';
import { MemoryMistDatabase, testActor, testAuthority, testContract } from './__tests__/support';

let directory: string, db: MemoryMistDatabase, repo: MistRepository;
const authority = () => testAuthority().authorize;
const agent = () => ({ ...testActor(), actorKind: 'agent' as const, agentSessionId: 'external-session', agentMode: 'operate' as const });
const write = (requestId: string, expectedRevision = 0) => ({ requestId, expectedRevision, command: { type: 'notes.add', payload: { text: 'Received documents', apiKey: 'must-not-be-retained' } } } as any);
const audits = () => [...db.receipts.values()].filter(row => row.result[AGENT_AUDIT_FIELD]);
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'mist-agent-audit-')); db = new MemoryMistDatabase(); repo = new MistRepository(db, testContract, new MistPrivateFiles(directory), authority()); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe('Agent audit is part of the business receipt transaction', () => {
  it('cannot commit an Agent write whose originating session is missing', async () => {
    const workspace = await repo.create(testActor(), { name: 'Audit', seed: 'empty' });
    await expect(repo.execute({ ...agent(), agentSessionId: '' }, workspace.id, write('missing-session'))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(audits()).toHaveLength(0); expect(db.workspaces.get(workspace.id).revision).toBe(0);
  });

  it('durably saves actor/session/command and actual changes once while public write/read/replay receipts stay unchanged', async () => {
    const workspace = await repo.create(testActor(), { name: 'Audit', seed: 'empty' });
    const first = await repo.execute(agent(), workspace.id, write('one'));
    expect(audits()).toHaveLength(1);
    const audit = audits()[0].result[AGENT_AUDIT_FIELD] as AgentCommandAudit;
    expect(audit).toMatchObject({ workspaceId: workspace.id, requestId: 'one', actor: { id: 'owner', name: 'owner' }, source: 'agent', agentSessionId: 'external-session', phase: 'executed', requestedRevision: 0, baseRevision: 0, committedRevision: 1, command: { type: 'notes.add', payload: { apiKey: '[redacted]' } } });
    expect(audit.changes.some(change => change.path[0] === 'k:notes' && change.operation === 'add')).toBe(true);
    expect(JSON.stringify(audit)).not.toContain('must-not-be-retained');
    const replay = await repo.execute(agent(), workspace.id, write('one'));
    expect(replay.replayed).toBe(true); expect(audits()).toHaveLength(1);
    expect(replay.receipt).toEqual(first.receipt);
    const read = await repo.receipt(agent(), workspace.id, 'one');
    const alternateRead = await repo.reviewReceipt(agent(), workspace.id, 'one');
    for (const value of [first, replay, read, alternateRead]) expect(JSON.stringify(value)).not.toContain(AGENT_AUDIT_FIELD);
    expect(audits()[0].result[AGENT_AUDIT_FIELD]).toEqual(audit);
    expect(audits()[0].requestId).toBe(agentAuditReceiptId('one'));
    expect(db.receipts.get(workspace.id + ':one').result).not.toHaveProperty(AGENT_AUDIT_FIELD);
    await expect(repo.receipt(testActor(), workspace.id, agentAuditReceiptId('one'))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(repo.reviewReceipt(testActor(), workspace.id, agentAuditReceiptId('one'))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(repo.execute(testActor(), workspace.id, write(agentAuditReceiptId('spoof'), 1))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('writes no audit on preview and rolls both state and audit back if the receipt fails', async () => {
    const workspace = await repo.create(testActor(), { name: 'Audit', seed: 'empty' });
    await repo.preview(agent(), workspace.id, write('preview'));
    expect(audits()).toHaveLength(0); expect(db.workspaces.get(workspace.id).revision).toBe(0);
    db.failReceipt = true;
    await expect(repo.execute(agent(), workspace.id, write('failed'))).rejects.toThrow('transaction failed');
    expect(audits()).toHaveLength(0); expect(db.workspaces.get(workspace.id).revision).toBe(0);
    db.failReceipt = false;
    await repo.execute(agent(), workspace.id, write('failed'));
    expect(audits()).toHaveLength(1);
  });

  it('also rolls back the already-written business receipt if its separate audit cannot be saved', async () => {
    class AuditFailDatabase extends MemoryMistDatabase {
      failAudit = false;
      async $transaction<T>(run: (tx: any) => Promise<T>) {
        return super.$transaction(async tx => {
          const create = tx.mistCommandReceipt.create;
          tx.mistCommandReceipt.create = async (args: any) => {
            if (this.failAudit && args.data.requestId.startsWith(AGENT_AUDIT_PREFIX)) throw new Error('audit unavailable');
            return create(args);
          };
          return run(tx);
        });
      }
    }
    const database = new AuditFailDatabase(), repository = new MistRepository(database, testContract, new MistPrivateFiles(directory), authority());
    const workspace = await repository.create(testActor(), { name: 'Audit', seed: 'empty' });
    database.failAudit = true;
    await expect(repository.execute(agent(), workspace.id, write('no-partial-commit'))).rejects.toThrow('audit unavailable');
    expect(database.workspaces.get(workspace.id).revision).toBe(0);
    expect(database.receipts.has(workspace.id + ':no-partial-commit')).toBe(false);
    expect([...database.receipts.values()].some(row => row.result[AGENT_AUDIT_FIELD])).toBe(false);
  });

  it('audits the actual rebased version without attributing another command\'s changes to this Agent', async () => {
    const workspace = await repo.create(testActor(), { name: 'Audit', seed: 'empty' });
    await repo.execute(testActor(), workspace.id, { requestId: 'human', expectedRevision: 0, command: { type: 'money.add', payload: { cents: 5 } } } as any);
    await repo.execute(agent(), workspace.id, write('after-concurrent-save'));
    const audit = audits()[0].result[AGENT_AUDIT_FIELD] as AgentCommandAudit;
    expect(audit).toMatchObject({ requestedRevision: 0, baseRevision: 1, committedRevision: 2 });
    expect(audit.changes.every(change => change.path[0] !== 'k:money')).toBe(true);
    expect(db.workspaces.get(workspace.id).state.money.cents).toBe(5);
  });

  it('includes normalization changes actually committed by this command', async () => {
    let normalize = false;
    const contract = { ...testContract, normalizeMistState: (state: any) => { if (normalize) state.normalized = true; } };
    const repository = new MistRepository(db, contract, new MistPrivateFiles(directory), authority());
    const workspace = await repository.create(testActor(), { name: 'Audit', seed: 'empty' });
    normalize = true;
    await repository.execute(agent(), workspace.id, write('normalized'));
    expect(audits()[0].result[AGENT_AUDIT_FIELD].changes).toContainEqual({ path: ['k:normalized'], operation: 'add', after: true });
  });
});
