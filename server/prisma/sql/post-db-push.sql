-- Indexes Prisma cannot express in schema.prisma; run after every `prisma db push` on an empty database.
-- Keep in sync with the migrations that create them. Idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS "OrderApprovalAuthority_unscoped_userId_businessLine_key"
  ON "OrderApprovalAuthority"("userId", "businessLine") WHERE "companyId" IS NULL;
