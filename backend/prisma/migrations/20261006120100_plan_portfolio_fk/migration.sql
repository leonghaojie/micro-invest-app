-- The plan's portfolio is now optional (legacy), so deleting it clears the link instead of failing.
ALTER TABLE "plans" DROP CONSTRAINT "plans_portfolioId_fkey";
ALTER TABLE "plans" ADD CONSTRAINT "plans_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "portfolios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
