-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "GoalType" AS ENUM ('LEARN', 'HABIT', 'GROWTH');

-- CreateEnum
CREATE TYPE "BudgetBand" AS ENUM ('B1', 'B2', 'B3', 'B4');

-- CreateEnum
CREATE TYPE "ContributionFrequency" AS ENUM ('WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "PeerGroupTier" AS ENUM ('FULL', 'RISK_BUDGET', 'RISK_ONLY');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isSynthetic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "goalType" "GoalType" NOT NULL,
    "budgetBand" "BudgetBand" NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "expectedReturn" DECIMAL(6,4) NOT NULL,
    "volatility" DECIMAL(6,4) NOT NULL,

    CONSTRAINT "portfolio_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "frequency" "ContributionFrequency" NOT NULL,
    "contributionAmount" DECIMAL(12,2) NOT NULL,
    "durationMonths" INTEGER NOT NULL,
    "finalValue" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simulations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contributions" (
    "id" TEXT NOT NULL,
    "simulationId" TEXT NOT NULL,
    "periodIndex" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "portfolioValue" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "peer_groups" (
    "id" TEXT NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "budgetBand" "BudgetBand",
    "goalType" "GoalType",
    "tier" "PeerGroupTier" NOT NULL,

    CONSTRAINT "peer_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "peer_group_stats" (
    "id" TEXT NOT NULL,
    "peerGroupId" TEXT NOT NULL,
    "medianValue" DECIMAL(14,2) NOT NULL,
    "p25" DECIMAL(14,2) NOT NULL,
    "p50" DECIMAL(14,2) NOT NULL,
    "p75" DECIMAL(14,2) NOT NULL,
    "medianConsistency" DECIMAL(5,2),
    "memberCount" INTEGER NOT NULL,
    "lastComputedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "peer_group_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_userId_key" ON "user_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "contributions_simulationId_periodIndex_key" ON "contributions"("simulationId", "periodIndex");

-- CreateIndex
CREATE UNIQUE INDEX "peer_group_stats_peerGroupId_key" ON "peer_group_stats"("peerGroupId");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulations" ADD CONSTRAINT "simulations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulations" ADD CONSTRAINT "simulations_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "portfolio_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "simulations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peer_group_stats" ADD CONSTRAINT "peer_group_stats_peerGroupId_fkey" FOREIGN KEY ("peerGroupId") REFERENCES "peer_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
