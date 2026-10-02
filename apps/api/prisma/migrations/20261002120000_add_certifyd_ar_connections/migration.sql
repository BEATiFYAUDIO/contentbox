CREATE TABLE "CertifydArConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "witnessIdentityId" TEXT NOT NULL,
    "witnessPublicKey" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "authorizationText" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    CONSTRAINT "CertifydArConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CertifydArConnection_witnessIdentityId_fkey" FOREIGN KEY ("witnessIdentityId") REFERENCES "WitnessIdentity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CertifydArConnection_publicKey_key" ON "CertifydArConnection"("publicKey");
CREATE INDEX "CertifydArConnection_userId_revokedAt_idx" ON "CertifydArConnection"("userId", "revokedAt");
CREATE INDEX "CertifydArConnection_witnessIdentityId_revokedAt_idx" ON "CertifydArConnection"("witnessIdentityId", "revokedAt");
