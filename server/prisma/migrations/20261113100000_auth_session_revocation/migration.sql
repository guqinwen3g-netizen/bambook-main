CREATE TABLE "AuthSessionRevocation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthSessionRevocation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuthSessionRevocation_userId_idx" ON "AuthSessionRevocation"("userId");
CREATE INDEX "AuthSessionRevocation_expiresAt_idx" ON "AuthSessionRevocation"("expiresAt");
