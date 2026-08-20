-- DropForeignKey
ALTER TABLE "historical_returns" DROP CONSTRAINT "historical_returns_templateId_fkey";

-- DropForeignKey
ALTER TABLE "simulations" DROP CONSTRAINT "simulations_templateId_fkey";

-- DropIndex
DROP INDEX "historical_returns_templateId_year_key";

-- AlterTable
ALTER TABLE "historical_returns" DROP COLUMN "templateId",
ADD COLUMN     "fundId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "simulations" DROP COLUMN "templateId",
ADD COLUMN     "portfolioId" TEXT NOT NULL;

-- DropTable
DROP TABLE "portfolio_templates";

-- CreateTable
CREATE TABLE "funds" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "dataSource" TEXT NOT NULL,

    CONSTRAINT "funds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolios" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "riskLevel" "RiskLevel",
    "isPreset" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_allocations" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "fundId" TEXT NOT NULL,
    "weightPct" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "portfolio_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "funds_ticker_exchange_key" ON "funds"("ticker", "exchange");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_allocations_portfolioId_fundId_key" ON "portfolio_allocations"("portfolioId", "fundId");

-- CreateIndex
CREATE UNIQUE INDEX "historical_returns_fundId_year_key" ON "historical_returns"("fundId", "year");

-- AddForeignKey
ALTER TABLE "historical_returns" ADD CONSTRAINT "historical_returns_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "funds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_allocations" ADD CONSTRAINT "portfolio_allocations_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_allocations" ADD CONSTRAINT "portfolio_allocations_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "simulations" ADD CONSTRAINT "simulations_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

