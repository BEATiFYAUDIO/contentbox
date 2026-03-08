CREATE TABLE "WitnessIdentity" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "algorithm" TEXT NOT NULL,
  "publicKey" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" DATETIME,
  CONSTRAINT "WitnessIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WitnessIdentity_userId_key" ON "WitnessIdentity"("userId");
CREATE INDEX "WitnessIdentity_fingerprint_idx" ON "WitnessIdentity"("fingerprint");
