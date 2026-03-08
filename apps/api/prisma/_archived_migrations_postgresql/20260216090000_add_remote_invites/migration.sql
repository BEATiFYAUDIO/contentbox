-- CreateTable
CREATE TABLE "RemoteInvite" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "remoteOrigin" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "inviteUrl" TEXT,
  "contentId" TEXT,
  "contentTitle" TEXT,
  "contentType" TEXT,
  "splitVersionNum" INTEGER,
  "role" TEXT,
  "percent" DECIMAL(10,3),
  "participantEmail" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "remoteUserId" TEXT,
  "remoteNodeUrl" TEXT,
  "remoteVerified" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RemoteInvite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RemoteInvite_userId_idx" ON "RemoteInvite"("userId");

-- CreateIndex
CREATE INDEX "RemoteInvite_remoteOrigin_idx" ON "RemoteInvite"("remoteOrigin");

-- CreateIndex
CREATE UNIQUE INDEX "RemoteInvite_remoteOrigin_tokenHash_key" ON "RemoteInvite"("remoteOrigin", "tokenHash");
