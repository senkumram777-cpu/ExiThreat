-- A post can be in several groups at once (up to five).
CREATE TABLE "PostPlacement" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "arrivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "arrivedBy" TEXT NOT NULL DEFAULT 'start',
    "fromGroupId" TEXT,

    CONSTRAINT "PostPlacement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PostPlacement_postId_groupId_key" ON "PostPlacement"("postId", "groupId");
CREATE INDEX "PostPlacement_groupId_idx" ON "PostPlacement"("groupId");

ALTER TABLE "PostPlacement" ADD CONSTRAINT "PostPlacement_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostPlacement" ADD CONSTRAINT "PostPlacement_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Each post's current group becomes its first placement; it arrived when it left the group
-- before, or when it was created.
INSERT INTO "PostPlacement" ("id", "postId", "groupId", "arrivedAt")
SELECT gen_random_uuid()::text, p."id", p."currentGroupId",
       COALESCE((SELECT MAX(h."movedAt") FROM "PostHistory" h WHERE h."postId" = p."id"), p."createdAt")
FROM "Post" p;

-- History records when the post reached each group, not only when it left.
ALTER TABLE "PostHistory" ADD COLUMN "arrivedAt" TIMESTAMP(3);
UPDATE "PostHistory" h SET "arrivedAt" = COALESCE(
    (SELECT MAX(h2."movedAt") FROM "PostHistory" h2 WHERE h2."postId" = h."postId" AND h2."movedAt" < h."movedAt"),
    (SELECT p."createdAt" FROM "Post" p WHERE p."id" = h."postId"));
ALTER TABLE "PostHistory" ALTER COLUMN "arrivedAt" SET NOT NULL,
ALTER COLUMN "arrivedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- Where it came from. Until now a post was in one group at a time, so it came from the group
-- it left just before, pushed on by that group's votes or by its author.
ALTER TABLE "PostHistory" ADD COLUMN "arrivedBy" TEXT NOT NULL DEFAULT 'start',
ADD COLUMN "fromGroupId" TEXT;
UPDATE "PostHistory" h SET "fromGroupId" = prev."groupId",
       "arrivedBy" = CASE WHEN prev."wasManualPush" THEN 'author' ELSE 'group' END
FROM "PostHistory" prev
WHERE prev."id" = (SELECT h2."id" FROM "PostHistory" h2
                   WHERE h2."postId" = h."postId" AND h2."movedAt" < h."movedAt"
                   ORDER BY h2."movedAt" DESC LIMIT 1);
UPDATE "PostPlacement" pl SET "fromGroupId" = prev."groupId",
       "arrivedBy" = CASE WHEN prev."wasManualPush" THEN 'author' ELSE 'group' END
FROM "PostHistory" prev
WHERE prev."id" = (SELECT h2."id" FROM "PostHistory" h2
                   WHERE h2."postId" = pl."postId" ORDER BY h2."movedAt" DESC LIMIT 1);

ALTER TABLE "Post" DROP CONSTRAINT "Post_currentGroupId_fkey";
DROP INDEX "Post_currentGroupId_idx";
ALTER TABLE "Post" DROP COLUMN "currentGroupId";
