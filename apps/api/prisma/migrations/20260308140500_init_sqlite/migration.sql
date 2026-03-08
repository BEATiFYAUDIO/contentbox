-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "bio" TEXT,
    "avatarUrl" TEXT,
    "passwordHash" TEXT,
    "recoveryKeyHash" TEXT,
    "recoveryKeyCreatedAt" DATETIME,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Buyer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" DATETIME
);

-- CreateTable
CREATE TABLE "BuyerOtp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "BuyerSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "buyerId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BuyerSession_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PayoutMethod" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Identity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "payoutMethodId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "verifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Identity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Identity_payoutMethodId_fkey" FOREIGN KEY ("payoutMethodId") REFERENCES "PayoutMethod" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "featureOnProfile" BOOLEAN NOT NULL DEFAULT false,
    "storefrontStatus" TEXT NOT NULL DEFAULT 'DISABLED',
    "priceSats" BIGINT,
    "deliveryMode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "manifestId" TEXT,
    "currentSplitId" TEXT,
    "repoPath" TEXT,
    "deletedAt" DATETIME,
    "deletedReason" TEXT,
    CONSTRAINT "ContentItem_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContentItem_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ContentItem_currentSplitId_fkey" FOREIGN KEY ("currentSplitId") REFERENCES "SplitVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContentCredit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "userId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContentCredit_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContentFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "cipherSha256" TEXT,
    "encDek" TEXT NOT NULL,
    "encAlg" TEXT NOT NULL,
    "dekNonce" TEXT,
    "fileNonce" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContentFile_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Manifest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentId" TEXT NOT NULL,
    "json" JSONB NOT NULL,
    "sha256" TEXT NOT NULL,
    "parentManifestSha256" TEXT,
    "lineageRelation" TEXT,
    "encAlg" TEXT,
    "keyId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ContentLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parentContentId" TEXT NOT NULL,
    "childContentId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "upstreamBps" INTEGER NOT NULL,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" DATETIME,
    "approvedByUserId" TEXT,
    CONSTRAINT "ContentLink_parentContentId_fkey" FOREIGN KEY ("parentContentId") REFERENCES "ContentItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContentLink_childContentId_fkey" FOREIGN KEY ("childContentId") REFERENCES "ContentItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContentLink_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClearanceRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentLinkId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reviewGrantedAt" DATETIME,
    "reviewGrantedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClearanceRequest_contentLinkId_fkey" FOREIGN KEY ("contentLinkId") REFERENCES "ContentLink" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApprovalToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentLinkId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "approverEmail" TEXT NOT NULL,
    "weightBps" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "decision" TEXT,
    "upstreamRatePercent" DECIMAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApprovalToken_contentLinkId_fkey" FOREIGN KEY ("contentLinkId") REFERENCES "ContentLink" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DerivativeAuthorization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "derivativeLinkId" TEXT NOT NULL,
    "parentContentId" TEXT NOT NULL,
    "requiredApprovers" INTEGER NOT NULL,
    "approvedApprovers" INTEGER NOT NULL DEFAULT 0,
    "approveWeightBps" INTEGER NOT NULL DEFAULT 0,
    "rejectWeightBps" INTEGER NOT NULL DEFAULT 0,
    "approvalPolicy" TEXT NOT NULL,
    "approvalBpsTarget" INTEGER,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DerivativeAuthorization_derivativeLinkId_fkey" FOREIGN KEY ("derivativeLinkId") REFERENCES "ContentLink" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DerivativeApprovalVote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "authorizationId" TEXT NOT NULL,
    "approverUserId" TEXT NOT NULL,
    "approverSplitParticipantId" TEXT,
    "decision" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DerivativeApprovalVote_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "DerivativeAuthorization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SplitVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" DATETIME,
    "lockedManifestSha256" TEXT,
    "lockedFileObjectKey" TEXT,
    "lockedFileSha256" TEXT,
    CONSTRAINT "SplitVersion_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SplitVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SplitParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "splitVersionId" TEXT NOT NULL,
    "participantEmail" TEXT,
    "participantUserId" TEXT,
    "role" TEXT NOT NULL,
    "roleCode" TEXT NOT NULL DEFAULT 'writer',
    "percent" DECIMAL NOT NULL,
    "bps" INTEGER NOT NULL DEFAULT 0,
    "payoutIdentityId" TEXT,
    "acceptedAt" DATETIME,
    "verifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SplitParticipant_payoutIdentityId_fkey" FOREIGN KEY ("payoutIdentityId") REFERENCES "Identity" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SplitParticipant_splitVersionId_fkey" FOREIGN KEY ("splitVersionId") REFERENCES "SplitVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "splitParticipantId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "acceptedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invitation_splitParticipantId_fkey" FOREIGN KEY ("splitParticipantId") REFERENCES "SplitParticipant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShareLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    CONSTRAINT "ShareLink_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublishEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentId" TEXT NOT NULL,
    "publishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publicUrl" TEXT NOT NULL,
    "targetHash" TEXT,
    "splitVersionId" TEXT,
    "clearanceId" TEXT,
    "priceSats" BIGINT,
    "publisherNodeId" TEXT,
    "status" TEXT NOT NULL,
    CONSTRAINT "PublishEvent_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "contentDeletedAt" DATETIME,
    "splitVersionNum" INTEGER,
    "role" TEXT,
    "percent" DECIMAL,
    "participantEmail" TEXT,
    "acceptedAt" DATETIME,
    "remoteUserId" TEXT,
    "remoteNodeUrl" TEXT,
    "remoteVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RemoteInvite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payloadJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CreditPurchase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "proofHash" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "splitVersion" INTEGER NOT NULL,
    "rateSatsPerUnit" INTEGER NOT NULL,
    "unitsPurchased" INTEGER NOT NULL,
    "amountSats" INTEGER NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paymentHash" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unpaid',
    "expiresAt" DATETIME NOT NULL,
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CreditPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CreditReceiptRef" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchaseId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "receiptPath" TEXT NOT NULL,
    "issuedAt" DATETIME NOT NULL,
    CONSTRAINT "CreditReceiptRef_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "CreditPurchase" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CreditSpend" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "receiptId" TEXT NOT NULL,
    "unitIndex" INTEGER NOT NULL,
    "spentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT
);

-- CreateTable
CREATE TABLE "PaymentIntent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "buyerUserId" TEXT,
    "contentId" TEXT NOT NULL,
    "manifestSha256" TEXT,
    "amountSats" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "purpose" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "memo" TEXT,
    "paidVia" TEXT,
    "bolt11" TEXT,
    "providerId" TEXT,
    "lightningExpiresAt" DATETIME,
    "onchainAddress" TEXT,
    "onchainDerivationIndex" INTEGER,
    "onchainTxid" TEXT,
    "onchainVout" INTEGER,
    "confirmations" INTEGER,
    "receiptToken" TEXT,
    "receiptTokenExpiresAt" DATETIME,
    "ipHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "paidAt" DATETIME,
    CONSTRAINT "PaymentIntent_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PaymentIntent_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "intentId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "sellerUserId" TEXT NOT NULL,
    "amountSats" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAT',
    "rail" TEXT NOT NULL,
    "memo" TEXT,
    "recognizedAt" DATETIME NOT NULL,
    "confirmedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Sale_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "PaymentIntent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Sale_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Sale_sellerUserId_fkey" FOREIGN KEY ("sellerUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Sale_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LightningNodeConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "restUrl" TEXT NOT NULL,
    "network" TEXT NOT NULL DEFAULT 'mainnet',
    "macaroonCiphertext" TEXT NOT NULL,
    "macaroonIv" TEXT NOT NULL,
    "macaroonTag" TEXT NOT NULL,
    "tlsCertPem" TEXT,
    "lastTestedAt" DATETIME,
    "lastStatus" TEXT,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Entitlement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "buyerId" TEXT,
    "buyerUserId" TEXT,
    "contentId" TEXT NOT NULL,
    "manifestSha256" TEXT NOT NULL,
    "paymentIntentId" TEXT,
    "grantedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Entitlement_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Entitlement_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Entitlement_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Entitlement_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentId" TEXT NOT NULL,
    "splitVersionId" TEXT NOT NULL,
    "netAmountSats" BIGINT NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Settlement_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Settlement_splitVersionId_fkey" FOREIGN KEY ("splitVersionId") REFERENCES "SplitVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Settlement_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SettlementLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "settlementId" TEXT NOT NULL,
    "participantId" TEXT,
    "participantEmail" TEXT,
    "role" TEXT,
    "amountSats" BIGINT NOT NULL,
    CONSTRAINT "SettlementLine_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "ProofRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "witnessIdentityId" TEXT,
    "proofType" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "claimJson" JSONB NOT NULL,
    "signature" TEXT,
    "status" TEXT NOT NULL,
    "verificationMethod" TEXT NOT NULL,
    "location" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "verifiedAt" DATETIME,
    "revokedAt" DATETIME,
    "failureReason" TEXT,
    CONSTRAINT "ProofRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProofRecord_witnessIdentityId_fkey" FOREIGN KEY ("witnessIdentityId") REFERENCES "WitnessIdentity" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Buyer_email_key" ON "Buyer"("email");

-- CreateIndex
CREATE INDEX "Buyer_email_idx" ON "Buyer"("email");

-- CreateIndex
CREATE INDEX "BuyerOtp_email_createdAt_idx" ON "BuyerOtp"("email", "createdAt");

-- CreateIndex
CREATE INDEX "BuyerOtp_expiresAt_idx" ON "BuyerOtp"("expiresAt");

-- CreateIndex
CREATE INDEX "BuyerSession_buyerId_idx" ON "BuyerSession"("buyerId");

-- CreateIndex
CREATE INDEX "BuyerSession_expiresAt_idx" ON "BuyerSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutMethod_code_key" ON "PayoutMethod"("code");

-- CreateIndex
CREATE INDEX "Identity_userId_idx" ON "Identity"("userId");

-- CreateIndex
CREATE INDEX "Identity_payoutMethodId_idx" ON "Identity"("payoutMethodId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentItem_manifestId_key" ON "ContentItem"("manifestId");

-- CreateIndex
CREATE INDEX "ContentItem_ownerUserId_idx" ON "ContentItem"("ownerUserId");

-- CreateIndex
CREATE INDEX "ContentItem_repoPath_idx" ON "ContentItem"("repoPath");

-- CreateIndex
CREATE INDEX "ContentItem_deletedAt_idx" ON "ContentItem"("deletedAt");

-- CreateIndex
CREATE INDEX "ContentCredit_contentId_sortOrder_idx" ON "ContentCredit"("contentId", "sortOrder");

-- CreateIndex
CREATE INDEX "ContentFile_contentId_idx" ON "ContentFile"("contentId");

-- CreateIndex
CREATE INDEX "ContentFile_sha256_idx" ON "ContentFile"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "ContentFile_contentId_objectKey_key" ON "ContentFile"("contentId", "objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "Manifest_contentId_key" ON "Manifest"("contentId");

-- CreateIndex
CREATE UNIQUE INDEX "Manifest_sha256_key" ON "Manifest"("sha256");

-- CreateIndex
CREATE INDEX "Manifest_parentManifestSha256_idx" ON "Manifest"("parentManifestSha256");

-- CreateIndex
CREATE INDEX "ContentLink_parentContentId_idx" ON "ContentLink"("parentContentId");

-- CreateIndex
CREATE INDEX "ContentLink_childContentId_idx" ON "ContentLink"("childContentId");

-- CreateIndex
CREATE INDEX "ClearanceRequest_contentLinkId_idx" ON "ClearanceRequest"("contentLinkId");

-- CreateIndex
CREATE INDEX "ClearanceRequest_requestedByUserId_idx" ON "ClearanceRequest"("requestedByUserId");

-- CreateIndex
CREATE INDEX "ClearanceRequest_status_idx" ON "ClearanceRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalToken_tokenHash_key" ON "ApprovalToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ApprovalToken_contentLinkId_idx" ON "ApprovalToken"("contentLinkId");

-- CreateIndex
CREATE INDEX "ApprovalToken_approverEmail_idx" ON "ApprovalToken"("approverEmail");

-- CreateIndex
CREATE INDEX "ApprovalToken_expiresAt_idx" ON "ApprovalToken"("expiresAt");

-- CreateIndex
CREATE INDEX "DerivativeAuthorization_derivativeLinkId_idx" ON "DerivativeAuthorization"("derivativeLinkId");

-- CreateIndex
CREATE INDEX "DerivativeAuthorization_parentContentId_idx" ON "DerivativeAuthorization"("parentContentId");

-- CreateIndex
CREATE INDEX "DerivativeAuthorization_status_idx" ON "DerivativeAuthorization"("status");

-- CreateIndex
CREATE INDEX "DerivativeApprovalVote_authorizationId_idx" ON "DerivativeApprovalVote"("authorizationId");

-- CreateIndex
CREATE INDEX "DerivativeApprovalVote_approverUserId_idx" ON "DerivativeApprovalVote"("approverUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DerivativeApprovalVote_authorizationId_approverUserId_key" ON "DerivativeApprovalVote"("authorizationId", "approverUserId");

-- CreateIndex
CREATE INDEX "SplitVersion_contentId_idx" ON "SplitVersion"("contentId");

-- CreateIndex
CREATE INDEX "SplitVersion_createdByUserId_idx" ON "SplitVersion"("createdByUserId");

-- CreateIndex
CREATE INDEX "SplitVersion_lockedFileSha256_idx" ON "SplitVersion"("lockedFileSha256");

-- CreateIndex
CREATE UNIQUE INDEX "SplitVersion_contentId_versionNumber_key" ON "SplitVersion"("contentId", "versionNumber");

-- CreateIndex
CREATE INDEX "SplitParticipant_splitVersionId_idx" ON "SplitParticipant"("splitVersionId");

-- CreateIndex
CREATE INDEX "SplitParticipant_participantEmail_idx" ON "SplitParticipant"("participantEmail");

-- CreateIndex
CREATE INDEX "SplitParticipant_payoutIdentityId_idx" ON "SplitParticipant"("payoutIdentityId");

-- CreateIndex
CREATE UNIQUE INDEX "SplitParticipant_splitVersionId_participantEmail_key" ON "SplitParticipant"("splitVersionId", "participantEmail");

-- CreateIndex
CREATE INDEX "Invitation_splitParticipantId_idx" ON "Invitation"("splitParticipantId");

-- CreateIndex
CREATE INDEX "Invitation_tokenHash_idx" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_token_key" ON "ShareLink"("token");

-- CreateIndex
CREATE INDEX "ShareLink_contentId_idx" ON "ShareLink"("contentId");

-- CreateIndex
CREATE INDEX "ShareLink_status_idx" ON "ShareLink"("status");

-- CreateIndex
CREATE INDEX "PublishEvent_contentId_idx" ON "PublishEvent"("contentId");

-- CreateIndex
CREATE INDEX "PublishEvent_status_idx" ON "PublishEvent"("status");

-- CreateIndex
CREATE INDEX "PublishEvent_splitVersionId_idx" ON "PublishEvent"("splitVersionId");

-- CreateIndex
CREATE INDEX "RemoteInvite_userId_idx" ON "RemoteInvite"("userId");

-- CreateIndex
CREATE INDEX "RemoteInvite_remoteOrigin_idx" ON "RemoteInvite"("remoteOrigin");

-- CreateIndex
CREATE UNIQUE INDEX "RemoteInvite_remoteOrigin_tokenHash_key" ON "RemoteInvite"("remoteOrigin", "tokenHash");

-- CreateIndex
CREATE INDEX "AuditEvent_userId_idx" ON "AuditEvent"("userId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "CreditPurchase_userId_idx" ON "CreditPurchase"("userId");

-- CreateIndex
CREATE INDEX "CreditPurchase_proofHash_idx" ON "CreditPurchase"("proofHash");

-- CreateIndex
CREATE INDEX "CreditPurchase_contentId_idx" ON "CreditPurchase"("contentId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditReceiptRef_purchaseId_key" ON "CreditReceiptRef"("purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditReceiptRef_receiptId_key" ON "CreditReceiptRef"("receiptId");

-- CreateIndex
CREATE INDEX "CreditReceiptRef_purchaseId_idx" ON "CreditReceiptRef"("purchaseId");

-- CreateIndex
CREATE INDEX "CreditReceiptRef_receiptId_idx" ON "CreditReceiptRef"("receiptId");

-- CreateIndex
CREATE INDEX "CreditSpend_receiptId_idx" ON "CreditSpend"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditSpend_receiptId_unitIndex_key" ON "CreditSpend"("receiptId", "unitIndex");

-- CreateIndex
CREATE INDEX "PaymentIntent_contentId_idx" ON "PaymentIntent"("contentId");

-- CreateIndex
CREATE INDEX "PaymentIntent_buyerUserId_idx" ON "PaymentIntent"("buyerUserId");

-- CreateIndex
CREATE INDEX "PaymentIntent_manifestSha256_idx" ON "PaymentIntent"("manifestSha256");

-- CreateIndex
CREATE INDEX "PaymentIntent_status_idx" ON "PaymentIntent"("status");

-- CreateIndex
CREATE INDEX "PaymentIntent_receiptToken_idx" ON "PaymentIntent"("receiptToken");

-- CreateIndex
CREATE INDEX "PaymentIntent_ipHash_idx" ON "PaymentIntent"("ipHash");

-- CreateIndex
CREATE INDEX "PaymentIntent_purpose_subjectType_subjectId_idx" ON "PaymentIntent"("purpose", "subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_intentId_key" ON "Sale"("intentId");

-- CreateIndex
CREATE INDEX "Sale_sellerUserId_recognizedAt_idx" ON "Sale"("sellerUserId", "recognizedAt");

-- CreateIndex
CREATE INDEX "Sale_contentId_idx" ON "Sale"("contentId");

-- CreateIndex
CREATE INDEX "Entitlement_buyerId_idx" ON "Entitlement"("buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "Entitlement_buyerUserId_contentId_manifestSha256_key" ON "Entitlement"("buyerUserId", "contentId", "manifestSha256");

-- CreateIndex
CREATE UNIQUE INDEX "Entitlement_buyerId_contentId_key" ON "Entitlement"("buyerId", "contentId");

-- CreateIndex
CREATE UNIQUE INDEX "Entitlement_buyerId_contentId_manifestSha256_key" ON "Entitlement"("buyerId", "contentId", "manifestSha256");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_paymentIntentId_key" ON "Settlement"("paymentIntentId");

-- CreateIndex
CREATE INDEX "Settlement_contentId_idx" ON "Settlement"("contentId");

-- CreateIndex
CREATE INDEX "Settlement_splitVersionId_idx" ON "Settlement"("splitVersionId");

-- CreateIndex
CREATE INDEX "SettlementLine_settlementId_idx" ON "SettlementLine"("settlementId");

-- CreateIndex
CREATE UNIQUE INDEX "WitnessIdentity_userId_key" ON "WitnessIdentity"("userId");

-- CreateIndex
CREATE INDEX "WitnessIdentity_fingerprint_idx" ON "WitnessIdentity"("fingerprint");

-- CreateIndex
CREATE INDEX "ProofRecord_userId_proofType_status_idx" ON "ProofRecord"("userId", "proofType", "status");

-- CreateIndex
CREATE INDEX "ProofRecord_subject_idx" ON "ProofRecord"("subject");

-- CreateIndex
CREATE UNIQUE INDEX "ProofRecord_userId_proofType_subject_key" ON "ProofRecord"("userId", "proofType", "subject");

