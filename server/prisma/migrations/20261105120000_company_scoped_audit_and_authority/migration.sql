-- 审计日志与审批资格按公司隔离（公司后台只看、只管本公司）。
-- 只新增列/索引并回填可无歧义确定的归属；不删除任何数据。无法确定归属的行保持 NULL
-- （NULL = 平台级或无公司上下文的历史单租户记录，公司账号读不到）。可重复执行。
BEGIN;

ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "companyId" UUID;
ALTER TABLE "OrderApprovalAuthority" ADD COLUMN IF NOT EXISTS "companyId" UUID;

-- ── AuditLog 回填 ──
-- 1) detail 已记录公司（公司账号生命周期、岗位分配、人事等写入）。
UPDATE "AuditLog" a SET "companyId" = c.id
FROM "Company" c
WHERE a."companyId" IS NULL
  AND jsonb_typeof(a.detail) = 'object'
  AND a.detail->>'companyId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND c.id = (a.detail->>'companyId')::uuid;
-- 2) 操作对象就是某家公司（平台开户、进入公司后台、公司设置等）。
UPDATE "AuditLog" a SET "companyId" = c.id
FROM "Company" c
WHERE a."companyId" IS NULL
  AND a."targetType" = 'Company'
  AND a."targetId" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND c.id = a."targetId"::uuid;
-- 3) 操作人只在一家公司有过成员关系且仍在职；调动过公司或已无在职关系的都不猜。
WITH ownership AS (
  -- 只认“一生只属于一家公司”的账号：停用/退出的成员关系也计入，调动过公司的账号一律不猜。
  SELECT "userId", (array_agg(DISTINCT "companyId"))[1] AS "companyId"
  FROM "CompanyMember"
  GROUP BY "userId" HAVING count(DISTINCT "companyId") = 1 AND bool_or(status = 'active')
)
UPDATE "AuditLog" a SET "companyId" = o."companyId"
FROM ownership o
WHERE a."companyId" IS NULL AND a."actorId" = o."userId";

-- ── OrderApprovalAuthority 回填：被授权人只在一家公司有过成员关系且仍在职 ──
WITH ownership AS (
  -- 只认“一生只属于一家公司”的账号：停用/退出的成员关系也计入，调动过公司的账号一律不猜。
  SELECT "userId", (array_agg(DISTINCT "companyId"))[1] AS "companyId"
  FROM "CompanyMember"
  GROUP BY "userId" HAVING count(DISTINCT "companyId") = 1 AND bool_or(status = 'active')
)
UPDATE "OrderApprovalAuthority" r SET "companyId" = o."companyId"
FROM ownership o
WHERE r."companyId" IS NULL AND r."userId" = o."userId";

-- 唯一性：公司内 (companyId,userId,businessLine) 唯一；无公司的历史配置保留原 (userId,businessLine) 唯一。
-- 同一账号可属于多家公司，各公司的审批资格互不占用，所以不能保留全局 (userId,businessLine) 唯一。
-- Postgres 中 NULL 互不相等，故无公司行用局部唯一索引约束。
-- 注意：上一版代码按 (userId,businessLine) upsert，在本结构上会失败；发布放行须设 rollback = "stop"。
DROP INDEX IF EXISTS "OrderApprovalAuthority_userId_businessLine_key";
CREATE UNIQUE INDEX IF NOT EXISTS "OrderApprovalAuthority_companyId_userId_businessLine_key"
  ON "OrderApprovalAuthority"("companyId", "userId", "businessLine");
CREATE UNIQUE INDEX IF NOT EXISTS "OrderApprovalAuthority_unscoped_userId_businessLine_key"
  ON "OrderApprovalAuthority"("userId", "businessLine") WHERE "companyId" IS NULL;
CREATE INDEX IF NOT EXISTS "OrderApprovalAuthority_companyId_businessLine_active_idx"
  ON "OrderApprovalAuthority"("companyId", "businessLine", "active");
CREATE INDEX IF NOT EXISTS "AuditLog_companyId_createdAt_idx" ON "AuditLog"("companyId", "createdAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AuditLog_companyId_fkey' AND conrelid = '"AuditLog"'::regclass) THEN
    ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrderApprovalAuthority_companyId_fkey' AND conrelid = '"OrderApprovalAuthority"'::regclass) THEN
    ALTER TABLE "OrderApprovalAuthority" ADD CONSTRAINT "OrderApprovalAuthority_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 供应商承诺审批名单（SystemConfig）──
-- 公司名单存于 scope = 'company:<companyId>'、id = 'company:<companyId>::<key>'。
-- 改动前公司会话实际生效的名单 = 全局名单 ∩ 本公司在职成员；这里为每家有在职成员在名单上的公司复制这份交集，
-- 沿用全局行的版本号（已冻结的 configVersions 仍可比对），保留全局行，已有公司行不覆盖。
-- 名单是现行配置而非历史记录，所以按当前在职关系计算（与审计回填只认单一公司的口径不同）。
WITH parsed AS (
  -- 名单可能存为 JSON 对象，也可能经通用配置接口存为 JSON 字符串；两种都解析，解析不了的跳过。
  SELECT s.id, s.key, s.version, s."updatedBy", s."auditReason",
         CASE WHEN jsonb_typeof(s.value) = 'object' THEN s.value
              WHEN jsonb_typeof(s.value) = 'string' AND pg_input_is_valid(s.value #>> '{}', 'jsonb') THEN (s.value #>> '{}')::jsonb END AS doc
  FROM "SystemConfig" s
  WHERE s.scope = 'global' AND s.key LIKE 'supplierCommitment.approvers.%'
), listed AS (
  -- 只复制改动前就有效的名单（schemaVersion = 1 且 userIds 为数组），无效名单不因复制变有效。
  SELECT p.id, p.key, p.version, p."updatedBy", p."auditReason", u.user_id
  FROM parsed p CROSS JOIN LATERAL jsonb_array_elements_text(p.doc->'userIds') AS u(user_id)
  WHERE p.doc->>'schemaVersion' = '1' AND jsonb_typeof(p.doc->'userIds') = 'array'
), per_company AS (
  SELECT l.key, l.version, l."updatedBy", l."auditReason", m."companyId",
         jsonb_agg(DISTINCT to_jsonb(l.user_id)) AS user_ids
  FROM listed l JOIN "CompanyMember" m ON m."userId" = l.user_id AND m.status = 'active'
  GROUP BY l.key, l.version, l."updatedBy", l."auditReason", m."companyId"
)
INSERT INTO "SystemConfig" (id, scope, key, "group", label, "valueType", value, encrypted, version, "updatedBy", "auditReason", "createdAt", "updatedAt")
SELECT 'company:' || c."companyId" || '::' || c.key, 'company:' || c."companyId", c.key, 'rbac', '供应商承诺审批资格', 'json',
       jsonb_build_object('schemaVersion', 1, 'userIds', (SELECT jsonb_agg(v ORDER BY v) FROM jsonb_array_elements_text(c.user_ids) v)), false,
       c.version, c."updatedBy", c."auditReason", now(), (extract(epoch FROM now()) * 1000)::bigint
FROM per_company c
ON CONFLICT DO NOTHING;

COMMIT;
