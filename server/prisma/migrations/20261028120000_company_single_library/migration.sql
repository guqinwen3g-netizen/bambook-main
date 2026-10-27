-- 一家公司一个业务库（docs/design/03-业务规则/公司-部门-小组与数据范围-2026-10-28.md R1）。
-- 不自动合并、不删除任何数据：若某公司已有多个业务库，迁移直接失败并列出公司，
-- 由运营人员先用 server/scripts/check-company-single-library.ts 核对、决定保留哪一个并解除其余的公司归属后再执行。
DO $$
DECLARE duplicated TEXT;
BEGIN
  SELECT string_agg("companyId"::text || ' (' || n || ')', ', ') INTO duplicated
  FROM (SELECT "companyId", count(*) AS n FROM "MistWorkspace" WHERE "companyId" IS NOT NULL GROUP BY "companyId" HAVING count(*) > 1) AS d;
  IF duplicated IS NOT NULL THEN
    RAISE EXCEPTION 'COMPANY_SINGLE_LIBRARY: 以下公司有多个业务库，请先人工处理后再迁移：%', duplicated;
  END IF;
END $$;

DROP INDEX IF EXISTS "MistWorkspace_companyId_idx";
CREATE UNIQUE INDEX "MistWorkspace_companyId_key" ON "MistWorkspace"("companyId");
