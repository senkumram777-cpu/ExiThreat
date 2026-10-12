-- CreateIndex
CREATE INDEX "GroupMember_userId_idx" ON "GroupMember"("userId");

-- CreateIndex
CREATE INDEX "Post_currentGroupId_idx" ON "Post"("currentGroupId");

-- CreateIndex
CREATE INDEX "Post_ocUserId_idx" ON "Post"("ocUserId");

-- CreateIndex
CREATE INDEX "PostHistory_postId_idx" ON "PostHistory"("postId");

-- CreateIndex
CREATE INDEX "Comment_postId_createdAt_idx" ON "Comment"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_groupId_createdAt_idx" ON "ChatMessage"("groupId", "createdAt");

