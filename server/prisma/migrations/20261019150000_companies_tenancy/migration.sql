-- 多租户：公司（Company）与成员归属（CompanyMember）
-- 角色、部门、工作空间增加公司维度；账号增加平台级身份。
-- 全部为新增表 / 可空列，不修改既有数据。

CREATE TABLE "Company" (
  "id" UUID NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "legalName" TEXT,
  "englishName" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "plan" TEXT NOT NULL DEFAULT 'standard',
  "seatLimit" INTEGER,
  "trialEndsAt" TIMESTAMP(3),
  "settings" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");
CREATE INDEX "Company_status_idx" ON "Company"("status");
CREATE INDEX "Company_createdAt_idx" ON "Company"("createdAt");

CREATE TABLE "CompanyMember" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "jobTitle" TEXT,
  "invitedBy" TEXT,
  "joinedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyMember_companyId_userId_key" ON "CompanyMember"("companyId", "userId");
CREATE INDEX "CompanyMember_userId_idx" ON "CompanyMember"("userId");
CREATE INDEX "CompanyMember_companyId_status_idx" ON "CompanyMember"("companyId", "status");

ALTER TABLE "CompanyMember" ADD CONSTRAINT "CompanyMember_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyMember" ADD CONSTRAINT "CompanyMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "UserAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Role" ADD COLUMN "companyId" UUID;
ALTER TABLE "Role" ADD COLUMN "code" TEXT;
CREATE INDEX "Role_companyId_idx" ON "Role"("companyId");
CREATE INDEX "Role_code_idx" ON "Role"("code");
ALTER TABLE "Role" ADD CONSTRAINT "Role_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Department" ADD COLUMN "companyId" UUID;
CREATE INDEX "Department_companyId_idx" ON "Department"("companyId");
ALTER TABLE "Department" ADD CONSTRAINT "Department_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MistWorkspace" ADD COLUMN "companyId" UUID;
CREATE INDEX "MistWorkspace_companyId_idx" ON "MistWorkspace"("companyId");
ALTER TABLE "MistWorkspace" ADD CONSTRAINT "MistWorkspace_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UserAccount" ADD COLUMN "platformRole" TEXT;
