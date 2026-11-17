-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "topListedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Post_topListedAt_totalWeight_idx" ON "Post"("topListedAt", "totalWeight");
