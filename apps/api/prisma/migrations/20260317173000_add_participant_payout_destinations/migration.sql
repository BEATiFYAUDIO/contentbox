CREATE TABLE "ParticipantPayoutDestination" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "destinationType" TEXT NOT NULL,
  "destinationValue" TEXT NOT NULL,
  "destinationSummary" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isVerified" BOOLEAN NOT NULL DEFAULT false,
  "lastVerifiedAt" DATETIME,
  "verificationStatus" TEXT,
  "verificationError" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ParticipantPayoutDestination_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ParticipantPayoutDestination_userId_idx" ON "ParticipantPayoutDestination"("userId");
CREATE INDEX "ParticipantPayoutDestination_userId_isActive_isPrimary_idx" ON "ParticipantPayoutDestination"("userId", "isActive", "isPrimary");
CREATE INDEX "ParticipantPayoutDestination_userId_isActive_isVerified_idx" ON "ParticipantPayoutDestination"("userId", "isActive", "isVerified");
