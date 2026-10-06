-- DECISIONS.md #24: return per unit of risk is no longer a comparison measure, so its sharing flag goes;
-- the monthly portfolio return takes its place, off by default like every other choice.

ALTER TABLE "friend_sharing" DROP COLUMN "shareReturnPerRisk";
ALTER TABLE "friend_sharing" ADD COLUMN "shareMonthlyReturn" BOOLEAN NOT NULL DEFAULT false;
