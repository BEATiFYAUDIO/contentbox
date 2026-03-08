-- CreateTable
CREATE TABLE "LightningNodeConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "restUrl" TEXT NOT NULL,
    "network" TEXT NOT NULL DEFAULT 'mainnet',
    "macaroonCiphertext" TEXT NOT NULL,
    "macaroonIv" TEXT NOT NULL,
    "macaroonTag" TEXT NOT NULL,
    "lastTestedAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LightningNodeConfig_pkey" PRIMARY KEY ("id")
);

