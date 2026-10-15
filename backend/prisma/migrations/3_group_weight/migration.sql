-- A group's weight from how active its members are.
ALTER TABLE "Group" ADD COLUMN "loginScore" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN "reviewScore" DOUBLE PRECISION,
ADD COLUMN "weightUpdatedAt" TIMESTAMP(3);

ALTER TABLE "ViewRecord" ADD COLUMN "redactedSeenAt" TIMESTAMP(3);

-- Looks finished before this was recorded: the reader was shown the redacted version.
UPDATE "ViewRecord" SET "redactedSeenAt" = "completedAt" WHERE "completedAt" IS NOT NULL;

CREATE TABLE "UserActiveDay" (
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,

    CONSTRAINT "UserActiveDay_pkey" PRIMARY KEY ("userId","day")
);

CREATE INDEX "UserActiveDay_day_idx" ON "UserActiveDay"("day");
