-- Store restricted LND macaroons by application role.
-- The legacy LightningNodeConfig macaroon remains only for operator/migration context.
CREATE TABLE "LightningNodeCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role" TEXT NOT NULL,
    "macaroonCiphertext" TEXT NOT NULL,
    "macaroonIv" TEXT NOT NULL,
    "macaroonTag" TEXT NOT NULL,
    "lastValidatedAt" DATETIME,
    "lastStatus" TEXT,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "LightningNodeCredential_role_key" ON "LightningNodeCredential"("role");
