-- CreateTable
CREATE TABLE "historical_returns" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "returnRate" DECIMAL(6,4) NOT NULL,

    CONSTRAINT "historical_returns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "historical_returns_templateId_year_key" ON "historical_returns"("templateId", "year");

-- AddForeignKey
ALTER TABLE "historical_returns" ADD CONSTRAINT "historical_returns_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "portfolio_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
