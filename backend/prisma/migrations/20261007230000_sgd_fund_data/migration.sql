-- DECISIONS.md #29: fund prices, dividends and returns are stored in Singapore dollars.
-- The columns keep their names; two new ones keep the fund's own price and the exchange rate used.
-- Existing rows hold the old own-currency values: endPriceLocal starts as that price and fxRate as 1, and the
-- next fund data load (update-fund-data) replaces every USD fund's rows with converted ones.

ALTER TABLE "fund_monthly_returns" ADD COLUMN "endPriceLocal" DECIMAL(12,4);
UPDATE "fund_monthly_returns" SET "endPriceLocal" = "endPrice";
ALTER TABLE "fund_monthly_returns" ALTER COLUMN "endPriceLocal" SET NOT NULL;
ALTER TABLE "fund_monthly_returns" ADD COLUMN "fxRate" DECIMAL(12,6) NOT NULL DEFAULT 1;
