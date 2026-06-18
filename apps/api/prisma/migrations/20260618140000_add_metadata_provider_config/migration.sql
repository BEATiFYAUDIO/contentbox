-- Node-local metadata provider configuration for optional Connect Work enrichment.
CREATE TABLE "MetadataProviderConfig" (
  "provider" TEXT NOT NULL PRIMARY KEY,
  "clientId" TEXT,
  "clientSecretCiphertext" TEXT,
  "clientSecretIv" TEXT,
  "clientSecretTag" TEXT,
  "lastTestedAt" DATETIME,
  "lastStatus" TEXT,
  "lastError" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
