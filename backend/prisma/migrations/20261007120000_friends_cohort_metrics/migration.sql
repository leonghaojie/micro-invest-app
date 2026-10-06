-- DECISIONS.md #22: friends rank on the cohort comparison's measures.
-- The portfolio's value, savings rate and emergency buffer are no longer offered at all, so their
-- sharing flags go. The contribution rate becomes the investment rate (same meaning, renamed; an
-- existing choice carries over). The new measures start OFF for everyone (privacy by default).

ALTER TABLE "friend_sharing" DROP COLUMN "shareValue";
ALTER TABLE "friend_sharing" DROP COLUMN "shareSavingsRate";
ALTER TABLE "friend_sharing" DROP COLUMN "shareEmergencyBuffer";

ALTER TABLE "friend_sharing" RENAME COLUMN "shareContributionRate" TO "shareInvestmentRate";

ALTER TABLE "friend_sharing" ADD COLUMN "shareConsistency" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "friend_sharing" ADD COLUMN "shareDiversification" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "friend_sharing" ADD COLUMN "shareReturnPerRisk" BOOLEAN NOT NULL DEFAULT false;
