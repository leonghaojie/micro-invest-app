/*
  Warnings:

  - You are about to drop the column `budgetBand` on the `user_profiles` table. All the data in the column will be lost.
  - You are about to drop the `contributions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `historical_returns` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `peer_group_stats` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `peer_groups` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `simulations` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `age` to the `user_profiles` table without a default value. This is not possible if the table is not empty.
  - Added the required column `monthlyExpense` to the `user_profiles` table without a default value. This is not possible if the table is not empty.
  - Added the required column `monthlyIncome` to the `user_profiles` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "contributions" DROP CONSTRAINT "contributions_simulationId_fkey";

-- DropForeignKey
ALTER TABLE "historical_returns" DROP CONSTRAINT "historical_returns_fundId_fkey";

-- DropForeignKey
ALTER TABLE "peer_group_stats" DROP CONSTRAINT "peer_group_stats_peerGroupId_fkey";

-- DropForeignKey
ALTER TABLE "simulations" DROP CONSTRAINT "simulations_portfolioId_fkey";

-- DropForeignKey
ALTER TABLE "simulations" DROP CONSTRAINT "simulations_userId_fkey";

-- AlterTable
ALTER TABLE "user_profiles" DROP COLUMN "budgetBand",
ADD COLUMN     "age" INTEGER NOT NULL,
ADD COLUMN     "monthlyExpense" DECIMAL(10,2) NOT NULL,
ADD COLUMN     "monthlyIncome" DECIMAL(10,2) NOT NULL;

-- DropTable
DROP TABLE "contributions";

-- DropTable
DROP TABLE "historical_returns";

-- DropTable
DROP TABLE "peer_group_stats";

-- DropTable
DROP TABLE "peer_groups";

-- DropTable
DROP TABLE "simulations";

-- DropEnum
DROP TYPE "BudgetBand";

-- DropEnum
DROP TYPE "ContributionFrequency";

-- DropEnum
DROP TYPE "ContributionMechanism";

-- DropEnum
DROP TYPE "PeerGroupTier";

-- CreateTable
CREATE TABLE "fund_monthly_returns" (
    "id" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "monthDate" TIMESTAMP(3) NOT NULL,
    "startPrice" DECIMAL(12,4) NOT NULL,
    "endPrice" DECIMAL(12,4) NOT NULL,
    "dividendAmount" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "returnPct" DECIMAL(8,6) NOT NULL,

    CONSTRAINT "fund_monthly_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "contributionAmount" DECIMAL(10,2) NOT NULL,
    "startMonth" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_months" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "monthDate" TIMESTAMP(3) NOT NULL,
    "portfolioReturnPct" DECIMAL(8,6) NOT NULL,
    "contribution" DECIMAL(10,2) NOT NULL,
    "endingBalance" DECIMAL(14,2) NOT NULL,
    "totalInvested" DECIMAL(12,2) NOT NULL,
    "walletBalance" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "plan_months_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fund_monthly_returns_fundId_monthDate_key" ON "fund_monthly_returns"("fundId", "monthDate");

-- CreateIndex
CREATE UNIQUE INDEX "plans_userId_key" ON "plans"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "plan_months_planId_monthDate_key" ON "plan_months"("planId", "monthDate");

-- AddForeignKey
ALTER TABLE "fund_monthly_returns" ADD CONSTRAINT "fund_monthly_returns_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "funds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_months" ADD CONSTRAINT "plan_months_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
