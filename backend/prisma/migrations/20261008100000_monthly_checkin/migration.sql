-- DECISIONS.md #31: a monthly check-in. A month's cash credit can now come from what the user says they
-- earned and spent that month (so it may be negative, covered by cash), without changing the usual figures
-- on the profile. The check-in is stored per month so the app knows which months have been confirmed.

ALTER TYPE "CreditSource" ADD VALUE 'CHECKIN';

CREATE TABLE "monthly_checkins" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "income" DECIMAL(12,2) NOT NULL,
    "expense" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monthly_checkins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "monthly_checkins_planId_month_key" ON "monthly_checkins"("planId", "month");

ALTER TABLE "monthly_checkins" ADD CONSTRAINT "monthly_checkins_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
