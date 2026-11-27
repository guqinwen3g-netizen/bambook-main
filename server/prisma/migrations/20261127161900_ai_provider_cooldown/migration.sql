CREATE TABLE "AiProviderCooldown" (
    "providerKey" VARCHAR(64) NOT NULL,
    "retryNotBeforeMs" BIGINT NOT NULL,
    CONSTRAINT "AiProviderCooldown_pkey" PRIMARY KEY ("providerKey")
);

CREATE INDEX "AiProviderCooldown_retryNotBeforeMs_idx" ON "AiProviderCooldown"("retryNotBeforeMs");
