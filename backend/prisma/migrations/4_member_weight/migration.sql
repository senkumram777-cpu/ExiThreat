-- A member's own weightage from how they use ExiThreat.
ALTER TABLE "User" ADD COLUMN "weight" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN "activityScore" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN "postScore" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN "voteScore" DOUBLE PRECISION,
ADD COLUMN "weightUpdatedAt" TIMESTAMP(3);

-- Time on the site, per day.
ALTER TABLE "UserActiveDay" ADD COLUMN "seconds" INTEGER NOT NULL DEFAULT 0;
