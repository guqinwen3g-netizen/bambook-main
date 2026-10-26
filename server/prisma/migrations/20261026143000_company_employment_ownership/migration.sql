BEGIN;
ALTER TABLE "EmployeeProfile" ADD COLUMN "companyId" UUID;
ALTER TABLE "EmploymentEvent" ADD COLUMN "companyId" UUID, ADD COLUMN "fromStatus" TEXT, ADD COLUMN "toStatus" TEXT;

-- A position gives explicit company ownership. Otherwise only a unique
-- historical membership is safe evidence; never choose the first company.
UPDATE "EmployeeProfile" p SET "companyId" = d."companyId"
FROM "JobPosition" j JOIN "Department" d ON d.id = j."departmentId"
WHERE p."positionId" = j.id AND d."companyId" IS NOT NULL;
WITH ownership AS (
  SELECT "userId", (array_agg(DISTINCT "companyId"))[1] AS "companyId"
  FROM "CompanyMember" GROUP BY "userId" HAVING count(DISTINCT "companyId") = 1
)
UPDATE "EmployeeProfile" p SET "companyId" = o."companyId"
FROM ownership o WHERE p."userId" = o."userId" AND p."companyId" IS NULL;

WITH candidates AS (
  SELECT e.id, d."companyId" FROM "EmploymentEvent" e JOIN "Department" d ON d.id IN (e."fromDeptId", e."toDeptId") WHERE d."companyId" IS NOT NULL
  UNION
  SELECT e.id, d."companyId" FROM "EmploymentEvent" e JOIN "JobPosition" j ON j.id IN (e."fromPositionId", e."toPositionId")
    JOIN "Department" d ON d.id = j."departmentId" WHERE d."companyId" IS NOT NULL
), ownership AS (
  SELECT id, (array_agg(DISTINCT "companyId"))[1] AS "companyId" FROM candidates GROUP BY id HAVING count(DISTINCT "companyId") = 1
)
UPDATE "EmploymentEvent" e SET "companyId" = o."companyId" FROM ownership o WHERE e.id = o.id;
WITH ownership AS (
  SELECT "userId", (array_agg(DISTINCT "companyId"))[1] AS "companyId"
  FROM "CompanyMember" GROUP BY "userId" HAVING count(DISTINCT "companyId") = 1
)
UPDATE "EmploymentEvent" e SET "companyId" = o."companyId"
FROM ownership o WHERE e."userId" = o."userId" AND e."companyId" IS NULL;

-- Abort before changing uniqueness if company records cannot be attributed.
-- Records belonging to genuinely unscoped accounts remain unscoped.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "EmployeeProfile" p WHERE p."companyId" IS NULL AND EXISTS (SELECT 1 FROM "CompanyMember" m WHERE m."userId" = p."userId"))
    OR EXISTS (SELECT 1 FROM "EmploymentEvent" e WHERE e."companyId" IS NULL AND EXISTS (SELECT 1 FROM "CompanyMember" m WHERE m."userId" = e."userId")) THEN
    RAISE EXCEPTION 'Employment ownership is ambiguous; resolve the listed profile/event ownership before migration';
  END IF;
END $$;

UPDATE "EmploymentEvent" SET "toStatus" = CASE type
  WHEN 'Onboard' THEN 'Probation' WHEN 'Regularize' THEN 'Regular'
  WHEN 'Suspend' THEN 'Suspended' WHEN 'Resign' THEN 'Resigned' WHEN 'Terminate' THEN 'Terminated' ELSE NULL END;
UPDATE "EmploymentEvent" e SET "fromStatus" = (
  SELECT CASE prior.type WHEN 'Onboard' THEN 'Probation' WHEN 'Regularize' THEN 'Regular' END
  FROM "EmploymentEvent" prior
  WHERE prior."userId" = e."userId" AND prior."companyId" IS NOT DISTINCT FROM e."companyId"
    AND prior.type IN ('Onboard', 'Regularize')
    AND (prior."effectiveDate", prior."createdAt", prior.id) < (e."effectiveDate", e."createdAt", e.id)
  ORDER BY prior."effectiveDate" DESC, prior."createdAt" DESC, prior.id DESC LIMIT 1
) WHERE e.type = 'Suspend';

DROP INDEX "EmployeeProfile_userId_key";
DROP INDEX "EmployeeProfile_employeeNo_key";
CREATE INDEX "EmployeeProfile_userId_idx" ON "EmployeeProfile"("userId");
CREATE UNIQUE INDEX "EmployeeProfile_companyId_userId_key" ON "EmployeeProfile"("companyId", "userId");
CREATE UNIQUE INDEX "EmployeeProfile_companyId_employeeNo_key" ON "EmployeeProfile"("companyId", "employeeNo");
CREATE UNIQUE INDEX "EmployeeProfile_unscoped_userId_key" ON "EmployeeProfile"("userId") WHERE "companyId" IS NULL;
CREATE UNIQUE INDEX "EmployeeProfile_unscoped_employeeNo_key" ON "EmployeeProfile"("employeeNo") WHERE "companyId" IS NULL;
CREATE INDEX "EmploymentEvent_companyId_userId_idx" ON "EmploymentEvent"("companyId", "userId");
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmploymentEvent" ADD CONSTRAINT "EmploymentEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
COMMIT;
