-- DECISIONS.md #19: the ledger replaces the fixed monthly plan.

-- CreateEnum
CREATE TYPE "TradeSide" AS ENUM ('BUY', 'SELL');
CREATE TYPE "TradeSource" AS ENUM ('MANUAL', 'RECURRING', 'MIGRATED');
CREATE TYPE "CreditSource" AS ENUM ('SETUP', 'MONTHLY', 'MIGRATED');
CREATE TYPE "RunStatus" AS ENUM ('BOUGHT', 'SKIPPED');

-- AlterTable: a plan row is now the user's account; the old fixed-plan columns are legacy/derived
ALTER TABLE "plans" ALTER COLUMN "portfolioId" DROP NOT NULL;
ALTER TABLE "plans" ALTER COLUMN "contributionAmount" SET DEFAULT 0;
ALTER TABLE "plan_months" ADD COLUMN "hasPosition" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "side" "TradeSide" NOT NULL,
    "fundId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "source" "TradeSource" NOT NULL,
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cash_credits" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "source" "CreditSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_credits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "plan_holdings" (
    "planId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "costBasis" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "plan_holdings_pkey" PRIMARY KEY ("planId","fundId")
);

CREATE TABLE "recurring_rules" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "fundId" TEXT,
    "portfolioId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "startMonth" TIMESTAMP(3) NOT NULL,
    "endMonth" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurring_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "recurring_runs" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "status" "RunStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurring_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ledger_entries_planId_month_idx" ON "ledger_entries"("planId", "month");
CREATE UNIQUE INDEX "cash_credits_planId_month_key" ON "cash_credits"("planId", "month");
CREATE INDEX "recurring_rules_planId_idx" ON "recurring_rules"("planId");
CREATE UNIQUE INDEX "recurring_runs_ruleId_month_key" ON "recurring_runs"("ruleId", "month");

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_credits" ADD CONSTRAINT "cash_credits_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plan_holdings" ADD CONSTRAINT "plan_holdings_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plan_holdings" ADD CONSTRAINT "plan_holdings_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "funds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recurring_runs" ADD CONSTRAINT "recurring_runs_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "recurring_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
