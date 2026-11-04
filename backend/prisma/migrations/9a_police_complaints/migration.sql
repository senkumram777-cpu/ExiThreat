-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phoneSealed" TEXT;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "subcategory" TEXT;

-- AlterTable
ALTER TABLE "ContactVerification" ADD COLUMN     "sealed" TEXT;

-- CreateTable
CREATE TABLE "OfficerDetailRequest" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "officerId" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "OfficerDetailRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfficerDetailRequest_postId_status_idx" ON "OfficerDetailRequest"("postId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OfficerDetailRequest_postId_officerId_key" ON "OfficerDetailRequest"("postId", "officerId");

-- AddForeignKey
ALTER TABLE "OfficerDetailRequest" ADD CONSTRAINT "OfficerDetailRequest_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
