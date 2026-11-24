import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { AUTOMATION_FIELD, AUTOMATION_HASH, AUTOMATION_PREFIX, dueAutomations } from './agentAutomations';

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
          schemaVersion: 1, id: ruleIds[index], workspaceId, ownerId,
          enabled: index !== 51,
          ...(index >= 50 ? { authority: { ownerId, issuedAt: 1 } } : {}),
        } },
      })) });

      const first = await dueAutomations(prisma, 50);
      expect(first).toEqual({ jobs: [], next: receipts[49] });
      expect(await dueAutomations(prisma, 50, first.next)).toEqual({
        jobs: [{ id: ruleIds[50], workspaceId, authority: { ownerId, issuedAt: 1 } }],
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
});
