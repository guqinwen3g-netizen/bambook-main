import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AUTOMATION_FIELD, AUTOMATION_HASH, AUTOMATION_PREFIX, dueAutomations } from './agentAutomations';
import { TASK_HASH } from './agentTasks';
import { MistRepository } from './repository';
import { MistPrivateFiles } from './files';
import { testActor, testAuthority } from './__tests__/support';
import * as contract from '../shared/mistWorkspace';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const url = process.env.MIST_PG_CONFLICT_TEST_URL;

describe.skipIf(!url)('PostgreSQL automation scan', () => {
  it('advances past a full page without usable grants and skips disabled rules', async () => {
    const prisma = new PrismaClient({ datasourceUrl: url });
    const workspaceId = randomUUID(), ownerId = randomUUID();
    const receipts = Array.from({ length: 52 }, () => randomUUID()).sort();
    const ruleIds = receipts.map(() => randomUUID());
    try {
      await prisma.mistWorkspace.create({
        data: { id: workspaceId, ownerId, slug: 'automation-scan', name: '自动规则调度测试', state: {} },
      });
      await prisma.mistCommandReceipt.createMany({ data: receipts.map((id, index) => ({
        id, workspaceId, actorId: ownerId,
        inputHash: AUTOMATION_HASH,
        requestId: AUTOMATION_PREFIX + ruleIds[index],
        expectedRevision: 0,
        result: { revision: 0, [AUTOMATION_FIELD]: {
          schemaVersion: 1, id: ruleIds[index], workspaceId, ownerId, version: 1,
          enabled: index !== 51,
          ...(index >= 50 ? { authority: { ownerId, issuedAt: 1 } } : {}),
        } },
      })) });

      const first = await dueAutomations(prisma, 50);
      expect(first).toEqual({ jobs: [], next: receipts[49] });
      expect(await dueAutomations(prisma, 50, first.next)).toEqual({
        jobs: [{ id: ruleIds[50], workspaceId, version: 1, authority: { ownerId, issuedAt: 1 } }],
        next: undefined,
      });
    } finally {
      try {
        await prisma.mistCommandReceipt.deleteMany({ where: { workspaceId } });
        await prisma.mistWorkspace.deleteMany({ where: { id: workspaceId } });
      } finally {
        await prisma.$disconnect();
      }
    }
  });

  it('commits one task and one history entry when two workers race from the same rule version', async () => {
    const prisma = new PrismaClient({ datasourceUrl: url });
    const directory = await mkdtemp(path.join(tmpdir(), 'mist-automation-pg-'));
    const owner = testActor('owner');
    const auth = testAuthority();
    auth.users.get(owner.userId)!.permissions.push('ai:chat');
    const repo = new MistRepository(prisma, contract, new MistPrivateFiles(directory), auth.authorize);
    repo.setPlatformTaskRuntime(() => true);
    let workspaceId: string | undefined;
    const boundary = repo as unknown as {transact: (run: (db: unknown) => Promise<unknown>) => Promise<unknown>};
    const transact = boundary.transact.bind(repo);
    const spy = vi.spyOn(boundary, 'transact');
    try {
      workspaceId = (await repo.create(owner, { name:'调度并发测试', slug:'automation-' + randomUUID(), seed:'empty' })).id;
      const rule = await repo.saveAutomation(owner, workspaceId, undefined, {
        name:'每日汇总', trigger:'daily', time:'00:00', instructions:'汇总待办',
      });
      let reads = 0;
      let open!: () => void;
      const ready = new Promise<void>(resolve => { open = resolve; });
      const readTogether = async (run: (db: unknown) => Promise<unknown>) => {
        try {
          return await transact(run);
        } finally {
          if (++reads === 2) open();
          await ready;
        }
      };
      spy.mockImplementationOnce(readTogether).mockImplementationOnce(readTogether);
      const launch = () => repo.runAutomation(owner, workspaceId!, rule.id, () => 'bma1_test', Date.now(), rule.version);
      const results = await Promise.all([launch(), launch()]);
      const fired = results.filter(result => result.fired);
      expect(fired).toHaveLength(1);
      expect(await prisma.mistCommandReceipt.count({ where:{workspaceId, inputHash:TASK_HASH} })).toBe(1);
      expect((await repo.listAutomations(owner, workspaceId)).items[0].runs).toEqual([
        expect.objectContaining({ taskId:fired[0].taskId }),
      ]);
    } finally {
      spy.mockRestore();
      try {
        if (workspaceId) {
          await prisma.mistCommandReceipt.deleteMany({ where:{workspaceId} });
          await prisma.mistWorkspace.deleteMany({ where:{id:workspaceId} });
        }
      } finally {
        await prisma.$disconnect();
        await rm(directory, {recursive:true, force:true});
      }
    }
  });
});
