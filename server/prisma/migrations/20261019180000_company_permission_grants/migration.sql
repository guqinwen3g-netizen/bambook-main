ALTER TABLE "UserPermissionOverrides" ADD COLUMN "companyId" UUID;
CREATE INDEX "UserPermissionOverrides_companyId_idx" ON "UserPermissionOverrides"("companyId");
