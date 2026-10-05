/**
 * The fund data's clock: how far the monthly history runs. A separate module (rather than
 * living in fundDataUpdate.service) so the ledger can use it without a circular import:
 * the update job recomputes accounts, and accounts need to know the data's latest month.
 */
import { prisma } from "../config/prisma";
import { monthKey } from "../utils/fundIngest";

/** The month the laggard fund has data to: min over funds of their newest month. */
export async function oldestLatestMonth(): Promise<string | null> {
  const funds = await prisma.fund.findMany({
    select: { monthlyReturns: { orderBy: { monthDate: "desc" }, take: 1, select: { monthDate: true } } },
  });
  const latest = funds.map((f) => (f.monthlyReturns[0] ? monthKey(f.monthlyReturns[0].monthDate) : null));
  if (latest.length === 0 || latest.some((m) => m === null)) return null;
  return (latest as string[]).reduce((min, m) => (m < min ? m : min));
}
