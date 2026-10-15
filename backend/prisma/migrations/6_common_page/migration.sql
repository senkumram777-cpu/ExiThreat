-- Every member gets a pseudonym, shown with their posts instead of their username.
ALTER TABLE "User" ADD COLUMN "pseudonym" TEXT;
UPDATE "User" SET "pseudonym" = 'Voice-' || upper(substr(md5(random()::text || "id"), 1, 8));
ALTER TABLE "User" ALTER COLUMN "pseudonym" SET NOT NULL;
CREATE UNIQUE INDEX "User_pseudonym_key" ON "User"("pseudonym");

-- Forwarding in cycles, and each post's spread for the common page (filled in by the server
-- within the hour, and at the next push).
ALTER TABLE "Post" ADD COLUMN "cycleStartedAt" TIMESTAMP(3),
ADD COLUMN "cycle" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "reachedGroups" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "eligibleGroups" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "spreadScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "spreadUpdatedAt" TIMESTAMP(3),
ADD COLUMN "listedAt" TIMESTAMP(3);
CREATE INDEX "Post_listedAt_spreadScore_idx" ON "Post"("listedAt", "spreadScore");
