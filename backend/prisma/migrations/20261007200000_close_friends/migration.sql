-- DECISIONS.md #27: close friends. Each sharing choice becomes an audience (NONE, CLOSE, ALL) instead of
-- on/off: an existing "on" becomes ALL (every friend, as before) and "off" becomes NONE, so nothing
-- changes for anyone until they use the new option. A new table holds each person's private
-- close-friends list.

CREATE TYPE "ShareAudience" AS ENUM ('NONE', 'CLOSE', 'ALL');

ALTER TABLE "friend_sharing" ALTER COLUMN "shareInvestmentRate" DROP DEFAULT;
ALTER TABLE "friend_sharing" ALTER COLUMN "shareInvestmentRate" TYPE "ShareAudience" USING (CASE WHEN "shareInvestmentRate" THEN 'ALL' ELSE 'NONE' END)::"ShareAudience";
ALTER TABLE "friend_sharing" ALTER COLUMN "shareInvestmentRate" SET DEFAULT 'NONE';
ALTER TABLE "friend_sharing" ALTER COLUMN "shareConsistency" DROP DEFAULT;
ALTER TABLE "friend_sharing" ALTER COLUMN "shareConsistency" TYPE "ShareAudience" USING (CASE WHEN "shareConsistency" THEN 'ALL' ELSE 'NONE' END)::"ShareAudience";
ALTER TABLE "friend_sharing" ALTER COLUMN "shareConsistency" SET DEFAULT 'NONE';
ALTER TABLE "friend_sharing" ALTER COLUMN "shareDiversification" DROP DEFAULT;
ALTER TABLE "friend_sharing" ALTER COLUMN "shareDiversification" TYPE "ShareAudience" USING (CASE WHEN "shareDiversification" THEN 'ALL' ELSE 'NONE' END)::"ShareAudience";
ALTER TABLE "friend_sharing" ALTER COLUMN "shareDiversification" SET DEFAULT 'NONE';
ALTER TABLE "friend_sharing" ALTER COLUMN "shareReturn" DROP DEFAULT;
ALTER TABLE "friend_sharing" ALTER COLUMN "shareReturn" TYPE "ShareAudience" USING (CASE WHEN "shareReturn" THEN 'ALL' ELSE 'NONE' END)::"ShareAudience";
ALTER TABLE "friend_sharing" ALTER COLUMN "shareReturn" SET DEFAULT 'NONE';
ALTER TABLE "friend_sharing" ALTER COLUMN "shareMonthlyReturn" DROP DEFAULT;
ALTER TABLE "friend_sharing" ALTER COLUMN "shareMonthlyReturn" TYPE "ShareAudience" USING (CASE WHEN "shareMonthlyReturn" THEN 'ALL' ELSE 'NONE' END)::"ShareAudience";
ALTER TABLE "friend_sharing" ALTER COLUMN "shareMonthlyReturn" SET DEFAULT 'NONE';
ALTER TABLE "friend_sharing" ALTER COLUMN "shareHoldings" DROP DEFAULT;
ALTER TABLE "friend_sharing" ALTER COLUMN "shareHoldings" TYPE "ShareAudience" USING (CASE WHEN "shareHoldings" THEN 'ALL' ELSE 'NONE' END)::"ShareAudience";
ALTER TABLE "friend_sharing" ALTER COLUMN "shareHoldings" SET DEFAULT 'NONE';

CREATE TABLE "close_friends" (
    "id" TEXT NOT NULL,
    "friendshipId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "close_friends_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "close_friends_friendshipId_ownerId_key" ON "close_friends"("friendshipId", "ownerId");

ALTER TABLE "close_friends" ADD CONSTRAINT "close_friends_friendshipId_fkey" FOREIGN KEY ("friendshipId") REFERENCES "friendships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
