-- One account per email address and per mobile number, kept as fingerprints only.
ALTER TABLE "User" ADD COLUMN "emailHash" TEXT,
ADD COLUMN "phoneHash" TEXT;

CREATE UNIQUE INDEX "User_emailHash_key" ON "User"("emailHash");
CREATE UNIQUE INDEX "User_phoneHash_key" ON "User"("phoneHash");

-- Codes sent to prove an email address or mobile number.
CREATE TABLE "ContactVerification" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "targetHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "ContactVerification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContactVerification_targetHash_createdAt_idx" ON "ContactVerification"("targetHash", "createdAt");
