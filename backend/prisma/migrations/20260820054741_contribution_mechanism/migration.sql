-- CreateEnum
CREATE TYPE "ContributionMechanism" AS ENUM ('SCHEDULED', 'ROUND_UP');

-- AlterTable
ALTER TABLE "simulations" ADD COLUMN     "avgRoundUpAmount" DECIMAL(6,2),
ADD COLUMN     "avgTransactionsPerWeek" INTEGER,
ADD COLUMN     "mechanism" "ContributionMechanism" NOT NULL DEFAULT 'SCHEDULED';
