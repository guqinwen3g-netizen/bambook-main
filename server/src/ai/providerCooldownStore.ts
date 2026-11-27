import { Prisma, type PrismaClient } from '@prisma/client';
import type { LlmProviderCooldownStore } from './llmProviders';

type CooldownDb = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;

export function createProviderCooldownStore(db: CooldownDb): LlmProviderCooldownStore {
  return {
    async active(keys, now) {
      if (!keys.length) return new Map();
      const rows = await db.$queryRaw<Array<{ providerKey: string; retryNotBeforeMs: bigint }>>`
        SELECT "providerKey", "retryNotBeforeMs"
        FROM "AiProviderCooldown"
        WHERE "providerKey" IN (${Prisma.join(keys)}) AND "retryNotBeforeMs" > ${BigInt(now)}
      `;
      return new Map(rows.map(row => [row.providerKey, Number(row.retryNotBeforeMs)]));
    },
    async remember(key, until, now) {
      await db.$executeRaw`
        INSERT INTO "AiProviderCooldown" ("providerKey", "retryNotBeforeMs")
        VALUES (${key}, ${BigInt(until)})
        ON CONFLICT ("providerKey") DO UPDATE
        SET "retryNotBeforeMs" = GREATEST("AiProviderCooldown"."retryNotBeforeMs", EXCLUDED."retryNotBeforeMs")
      `;
      await db.$executeRaw`DELETE FROM "AiProviderCooldown" WHERE "retryNotBeforeMs" <= ${BigInt(now)}`;
    },
  };
}
