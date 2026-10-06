/**
 * PortfolioService unit tests — FR04, plus the DECISIONS.md #1 second
 * amendment (multi-fund portfolios). Prisma is mocked so these run
 * without a live Postgres connection.
 */
import { prisma } from "../config/prisma";
import { portfolioService, summarizeHistory } from "./portfolio.service";
import { MonthlyRow } from "../utils/fundStats";

jest.mock("../config/prisma", () => ({
  prisma: {
    fund: { findMany: jest.fn(), findUnique: jest.fn() },
    portfolio: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
    fundMonthlyReturn: { groupBy: jest.fn(), findMany: jest.fn() },
  },
}));

const mockedPrisma = prisma as unknown as {
  fund: { findMany: jest.Mock; findUnique: jest.Mock };
  portfolio: { findMany: jest.Mock; create: jest.Mock; findUnique: jest.Mock };
  fundMonthlyReturn: { groupBy: jest.Mock; findMany: jest.Mock };
};

beforeEach(() => {
  mockedPrisma.fundMonthlyReturn.findMany.mockResolvedValue([]); // no history unless a test gives some
});

/** Stored months for a fund: `n` months from `start`, each returning `r` (a fraction). */
function months(fundId: string, start: string, n: number, r: number) {
  const [y, m] = start.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    return { fundId, monthDate: d, endPrice: String(100 + i), dividendAmount: "0", returnPct: String(r) };
  });
}

describe("PortfolioService", () => {
  describe("listFunds", () => {
    it("summarises each fund with months available and its latest monthly return", async () => {
      mockedPrisma.fund.findMany.mockResolvedValue([
        {
          id: "fund-1",
          ticker: "ES3.SI",
          name: "SPDR Straits Times Index ETF",
          assetClass: "EQUITY",
          exchange: "SGX",
          currency: "SGD",
          monthlyReturns: [
            { monthDate: new Date("2026-08-01T00:00:00Z"), returnPct: "0.0281" },
            { monthDate: new Date("2026-07-01T00:00:00Z"), returnPct: "0.0221" },
          ],
        },
      ]);

      const result = await portfolioService.listFunds();

      expect(result).toEqual([
        {
          id: "fund-1",
          ticker: "ES3.SI",
          name: "SPDR Straits Times Index ETF",
          assetClass: "EQUITY",
          exchange: "SGX",
          currency: "SGD",
          monthsAvailable: 2,
          earliestMonth: "2026-07",
          latestMonth: "2026-08",
          latestMonthlyReturn: 0.0281,
        },
      ]);
    });

    it("reports null latestMonthlyReturn for a fund with no data yet", async () => {
      mockedPrisma.fund.findMany.mockResolvedValue([
        {
          id: "fund-2",
          ticker: "NEW",
          name: "New Fund",
          assetClass: "EQUITY",
          exchange: "US",
          currency: "USD",
          monthlyReturns: [],
        },
      ]);

      const result = await portfolioService.listFunds();

      expect(result[0]).toEqual(expect.objectContaining({ monthsAvailable: 0, earliestMonth: null, latestMonth: null, latestMonthlyReturn: null }));
    });
  });

  describe("listPortfolios", () => {
    it("returns presets and the user's own custom portfolios", async () => {
      mockedPrisma.portfolio.findMany.mockResolvedValue([
        {
          id: "pf-1",
          name: "Conservative",
          isPreset: true,
          riskLevel: "LOW",
          allocations: [{ fundId: "fund-1", weightPct: "100.00", fund: { ticker: "A35", name: "ABF Sg Bond" } }],
        },
      ]);

      mockedPrisma.fundMonthlyReturn.groupBy.mockResolvedValue([{ fundId: "fund-1", _min: { monthDate: new Date("2008-02-01T00:00:00Z") } }]);

      const result = await portfolioService.listPortfolios("user-1");

      expect(mockedPrisma.portfolio.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { OR: [{ isPreset: true }, { userId: "user-1" }] } })
      );
      expect(result).toEqual([
        {
          id: "pf-1",
          name: "Conservative",
          isPreset: true,
          riskLevel: "LOW",
          tagline: null, // a retired name: no page text
          history: null, // no stored months in this test
          earliestStartMonth: "2008-02",
          allocations: [{ fundId: "fund-1", ticker: "A35", fundName: "ABF Sg Bond", weightPct: 100 }],
        },
      ]);
    });

    describe("earliestStartMonth (the earliest month a plan on the portfolio can start)", () => {
      const portfolioOf = (id: string, fundIds: string[]) => ({
        id,
        name: id,
        isPreset: true,
        riskLevel: "MEDIUM",
        allocations: fundIds.map((fundId) => ({ fundId, weightPct: "50.00", fund: { ticker: fundId.toUpperCase(), name: fundId } })),
      });
      const first = (fundId: string, month: string) => ({ fundId, _min: { monthDate: new Date(`${month}-01T00:00:00Z`) } });

      it("is the LATEST of the funds' first months, because a plan needs every fund's real return", async () => {
        mockedPrisma.portfolio.findMany.mockResolvedValue([portfolioOf("mix", ["old", "mid", "young"])]);
        mockedPrisma.fundMonthlyReturn.groupBy.mockResolvedValue([first("old", "1993-02"), first("mid", "2011-10"), first("young", "2017-11")]);

        const [mix] = await portfolioService.listPortfolios("user-1");

        expect(mix.earliestStartMonth).toBe("2017-11");
      });

      it("is computed per portfolio, with one query for all of them", async () => {
        mockedPrisma.fundMonthlyReturn.groupBy.mockClear();
        mockedPrisma.portfolio.findMany.mockResolvedValue([portfolioOf("a", ["old", "young"]), portfolioOf("b", ["old", "mid"])]);
        mockedPrisma.fundMonthlyReturn.groupBy.mockResolvedValue([first("old", "1993-02"), first("mid", "2011-10"), first("young", "2017-11")]);

        const result = await portfolioService.listPortfolios("user-1");

        expect(result.map((p) => [p.name, p.earliestStartMonth])).toEqual([
          ["a", "2017-11"],
          ["b", "2011-10"],
        ]);
        expect(mockedPrisma.fundMonthlyReturn.groupBy).toHaveBeenCalledTimes(1);
        expect(mockedPrisma.fundMonthlyReturn.groupBy.mock.calls[0][0].where.fundId.in.sort()).toEqual(["mid", "old", "young"]);
      });

      it("is null when any fund has no data yet (the portfolio cannot start anywhere)", async () => {
        mockedPrisma.portfolio.findMany.mockResolvedValue([portfolioOf("mix", ["old", "empty"])]);
        mockedPrisma.fundMonthlyReturn.groupBy.mockResolvedValue([first("old", "1993-02")]);

        expect((await portfolioService.listPortfolios("user-1"))[0].earliestStartMonth).toBeNull();
      });

      it("does not query for first months when there are no portfolios", async () => {
        mockedPrisma.fundMonthlyReturn.groupBy.mockClear();
        mockedPrisma.portfolio.findMany.mockResolvedValue([]);
        expect(await portfolioService.listPortfolios("user-1")).toEqual([]);
        expect(mockedPrisma.fundMonthlyReturn.groupBy).not.toHaveBeenCalled();
      });
    });
  });

  describe("createPortfolio", () => {
    it("creates a custom portfolio when weights sum to exactly 100", async () => {
      const fund1 = "11111111-1111-1111-1111-111111111111";
      const fund2 = "22222222-2222-2222-2222-222222222222";
      mockedPrisma.fund.findMany.mockResolvedValue([{ id: fund1 }, { id: fund2 }]);
      mockedPrisma.fundMonthlyReturn.groupBy.mockResolvedValue([
        { fundId: fund1, _min: { monthDate: new Date("2008-02-01T00:00:00Z") } },
        { fundId: fund2, _min: { monthDate: new Date("2012-06-01T00:00:00Z") } },
      ]);
      mockedPrisma.portfolio.create.mockResolvedValue({
        id: "pf-new",
        name: "My mix",
        isPreset: false,
        riskLevel: null,
        allocations: [
          { fundId: fund1, weightPct: "60.00", fund: { ticker: "ES3", name: "SPDR STI ETF" } },
          { fundId: fund2, weightPct: "40.00", fund: { ticker: "A35", name: "ABF Sg Bond" } },
        ],
      });

      const result = await portfolioService.createPortfolio("user-1", {
        name: "My mix",
        allocations: [
          { fundId: fund1, weightPct: 60 },
          { fundId: fund2, weightPct: 40 },
        ],
      });

      expect(result.allocations).toHaveLength(2);
      expect(result.earliestStartMonth).toBe("2012-06");
      expect(mockedPrisma.portfolio.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: "user-1", name: "My mix", isPreset: false }),
        })
      );
    });

    it("rejects weights that don't sum to 100", async () => {
      await expect(
        portfolioService.createPortfolio("user-1", {
          name: "Bad mix",
          allocations: [
            { fundId: "11111111-1111-1111-1111-111111111111", weightPct: 60 },
            { fundId: "22222222-2222-2222-2222-222222222222", weightPct: 30 },
          ],
        })
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(mockedPrisma.portfolio.create).not.toHaveBeenCalled();
    });

    it("accepts weights within floating-point rounding tolerance of 100", async () => {
      mockedPrisma.fund.findMany.mockResolvedValue([{ id: "fund-1" }, { id: "fund-2" }, { id: "fund-3" }]);
      mockedPrisma.fundMonthlyReturn.groupBy.mockResolvedValue([]);
      mockedPrisma.portfolio.create.mockResolvedValue({
        id: "pf-new",
        name: "Thirds",
        isPreset: false,
        riskLevel: null,
        allocations: [],
      });

      await expect(
        portfolioService.createPortfolio("user-1", {
          name: "Thirds",
          allocations: [
            { fundId: "11111111-1111-1111-1111-111111111111", weightPct: 33.34 },
            { fundId: "22222222-2222-2222-2222-222222222222", weightPct: 33.33 },
            { fundId: "33333333-3333-3333-3333-333333333333", weightPct: 33.33 },
          ],
        })
      ).resolves.toBeDefined();
    });

    it("rejects a duplicate fund within the same portfolio", async () => {
      await expect(
        portfolioService.createPortfolio("user-1", {
          name: "Dup",
          allocations: [
            { fundId: "11111111-1111-1111-1111-111111111111", weightPct: 50 },
            { fundId: "11111111-1111-1111-1111-111111111111", weightPct: 50 },
          ],
        })
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("rejects a fund id that doesn't exist", async () => {
      mockedPrisma.fund.findMany.mockResolvedValue([{ id: "fund-1" }]); // only 1 of 2 requested exists

      await expect(
        portfolioService.createPortfolio("user-1", {
          name: "Missing fund",
          allocations: [
            { fundId: "11111111-1111-1111-1111-111111111111", weightPct: 50 },
            { fundId: "22222222-2222-2222-2222-222222222222", weightPct: 50 },
          ],
        })
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("rejects an empty allocations list", async () => {
      await expect(portfolioService.createPortfolio("user-1", { name: "Empty", allocations: [] })).rejects.toThrow();
    });
  });
});

describe("PortfolioService.getFundDetail (DECISIONS.md #14)", () => {
  const FUND_ID = "11111111-1111-4111-8111-111111111111";

  /** n consecutive months from 2024-01 as database rows. */
  function dbRows(n: number, returnPct = "0.010000") {
    return Array.from({ length: n }, (_, i) => ({
      monthDate: new Date(Date.UTC(2024, i, 1)),
      endPrice: "10.0000",
      dividendAmount: "0.0500",
      returnPct,
    }));
  }

  function fundWith(rows: ReturnType<typeof dbRows>) {
    return { id: FUND_ID, ticker: "ES3.SI", name: "SPDR STI", assetClass: "EQUITY", exchange: "SGX", currency: "SGD", monthlyReturns: rows };
  }

  it("returns the fund's identity with its history and statistics", async () => {
    mockedPrisma.fund.findUnique.mockResolvedValue(fundWith(dbRows(24)));

    const detail = await portfolioService.getFundDetail(FUND_ID, "max");

    expect(detail.fund).toEqual({
      id: FUND_ID,
      ticker: "ES3.SI",
      name: "SPDR STI",
      assetClass: "EQUITY",
      exchange: "SGX",
      currency: "SGD",
      monthsAvailable: 24,
      earliestMonth: "2024-01",
    });
    expect(detail.range).toBe("max");
    expect(detail.series).toHaveLength(25);
    expect(detail.stats.totalReturnPct).toBeCloseTo((Math.pow(1.01, 24) - 1) * 100, 1);
    expect(detail.latestPrice).toBe(10);
  });

  it("asks the database for the months oldest first, and nothing about any user", async () => {
    mockedPrisma.fund.findUnique.mockResolvedValue(fundWith(dbRows(3)));
    await portfolioService.getFundDetail(FUND_ID, "max");

    expect(mockedPrisma.fund.findUnique).toHaveBeenCalledWith({
      where: { id: FUND_ID },
      include: { monthlyReturns: { orderBy: { monthDate: "asc" } } },
    });
  });

  it("defaults to a 5 year range, or everything if the fund is younger", async () => {
    mockedPrisma.fund.findUnique.mockResolvedValue(fundWith(dbRows(24)));
    const young = await portfolioService.getFundDetail(FUND_ID);
    expect(young.range).toBe("max");
    expect(young.months).toBe(24);

    mockedPrisma.fund.findUnique.mockResolvedValue(fundWith(dbRows(84)));
    const old = await portfolioService.getFundDetail(FUND_ID);
    expect(old.range).toBe("5y");
    expect(old.months).toBe(60);
  });

  it("honours a requested range", async () => {
    mockedPrisma.fund.findUnique.mockResolvedValue(fundWith(dbRows(84)));
    expect((await portfolioService.getFundDetail(FUND_ID, "1y")).months).toBe(12);
  });

  it("404s for an unknown fund", async () => {
    mockedPrisma.fund.findUnique.mockResolvedValue(null);
    await expect(portfolioService.getFundDetail(FUND_ID, "max")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("404s for a fund with no history yet", async () => {
    mockedPrisma.fund.findUnique.mockResolvedValue(fundWith([]));
    await expect(portfolioService.getFundDetail(FUND_ID, "max")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects a malformed id and an unknown range before touching the database", async () => {
    mockedPrisma.fund.findUnique.mockClear();
    await expect(portfolioService.getFundDetail("not-a-uuid", "max")).rejects.toThrow();
    await expect(portfolioService.getFundDetail(FUND_ID, "2y")).rejects.toThrow();
    await expect(portfolioService.getFundDetail(FUND_ID, "constructor")).rejects.toThrow();
    expect(mockedPrisma.fund.findUnique).not.toHaveBeenCalled();
  });

  describe("history on the list and the portfolio page (DECISIONS.md #28)", () => {
    const pf = (over: object = {}) => ({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Global 60/40",
      isPreset: true,
      userId: null,
      riskLevel: "MEDIUM",
      allocations: [
        { fundId: "vt", weightPct: "60.00", fund: { ticker: "VT", name: "World stocks", assetClass: "EQUITY", exchange: "US", currency: "USD" } },
        { fundId: "agg", weightPct: "40.00", fund: { ticker: "AGG", name: "US bonds", assetClass: "BOND", exchange: "US", currency: "USD" } },
      ],
      ...over,
    });
    const ID = "11111111-1111-4111-8111-111111111111";

    it("gives a preset its tagline and a one-line history on the list, from the months its funds share", async () => {
      mockedPrisma.portfolio.findMany.mockResolvedValue([pf()]);
      mockedPrisma.fundMonthlyReturn.groupBy.mockResolvedValue([]);
      mockedPrisma.fundMonthlyReturn.findMany.mockResolvedValue([...months("vt", "2020-01", 24, 0.01), ...months("agg", "2020-01", 24, 0.005)]);

      const [p] = await portfolioService.listPortfolios("user-1");

      expect(p.tagline).toMatch(/60%/);
      expect(p.history!.months).toBe(24);
      // 60% of +1% and 40% of +0.5% is +0.8% a month: about 10% a year
      expect(p.history!.annualizedReturnPct).toBeCloseTo((1.008 ** 12 - 1) * 100, 1);
      expect(p.history!.maxDrawdownPct).toBe(0);
    });

    it("loads every fund's months once for the whole list, not once per portfolio", async () => {
      mockedPrisma.fundMonthlyReturn.findMany.mockClear();
      mockedPrisma.portfolio.findMany.mockResolvedValue([pf(), pf({ id: "other" })]);
      mockedPrisma.fundMonthlyReturn.groupBy.mockResolvedValue([]);
      await portfolioService.listPortfolios("user-1");
      expect(mockedPrisma.fundMonthlyReturn.findMany).toHaveBeenCalledTimes(1);
    });

    it("has no history, and no annualised figure, when there is too little to go on", async () => {
      mockedPrisma.portfolio.findMany.mockResolvedValue([pf()]);
      mockedPrisma.fundMonthlyReturn.groupBy.mockResolvedValue([]);
      mockedPrisma.fundMonthlyReturn.findMany.mockResolvedValue([...months("vt", "2026-01", 6, 0.01), ...months("agg", "2026-01", 6, 0.005)]);
      const [p] = await portfolioService.listPortfolios("user-1");
      expect(p.history).toMatchObject({ months: 6, annualizedReturnPct: null });
    });

    describe("getPortfolioDetail", () => {
      beforeEach(() => {
        mockedPrisma.portfolio.findUnique.mockResolvedValue(pf());
        mockedPrisma.fundMonthlyReturn.findMany.mockResolvedValue([...months("vt", "2015-01", 120, 0.01), ...months("agg", "2018-01", 84, 0.004)]);
      });

      it("describes a preset, lists its funds largest first and gives its history over the months they share", async () => {
        const d = await portfolioService.getPortfolioDetail("user-1", ID, "max");

        expect(d.portfolio).toMatchObject({ name: "Global 60/40", isPreset: true, riskLevel: "MEDIUM" });
        expect(d.portfolio.highlights).toHaveLength(3);
        expect(d.portfolio.suits).toBeTruthy();
        expect(d.composition.map((c) => [c.ticker, c.weightPct])).toEqual([["VT", 60], ["AGG", 40]]);
        expect(d.assetMix).toEqual([{ assetClass: "EQUITY", pct: 60 }, { assetClass: "BOND", pct: 40 }]);
        expect(d.months).toBe(84); // AGG starts later, so the blend starts when it does
        expect(d.startMonth).toBe("2018-01");
        expect(d.limitedBy).toEqual({ ticker: "AGG", earliestMonth: "2018-01" });
        expect(d.availableRanges).toContain("5y");
      });

      it("always gives the whole history's figures too (the list's), whatever range is chosen", async () => {
        const d = await portfolioService.getPortfolioDetail("user-1", ID, "1y");
        expect(d.months).toBe(12);
        expect(d.overall.months).toBe(84);
        expect(d.overall).toMatchObject({ startMonth: "2018-01", endMonth: "2024-12" });
        const [listed] = await (async () => {
          mockedPrisma.portfolio.findMany.mockResolvedValue([pf()]);
          mockedPrisma.fundMonthlyReturn.groupBy.mockResolvedValue([]);
          return portfolioService.listPortfolios("user-1");
        })();
        expect(d.overall.annualizedReturnPct).toBe(listed.history!.annualizedReturnPct);
        expect(d.overall.maxDrawdownPct).toBe(listed.history!.maxDrawdownPct);
      });

      it("uses the range asked for, 5 years by default", async () => {
        expect((await portfolioService.getPortfolioDetail("user-1", ID)).months).toBe(60);
        expect((await portfolioService.getPortfolioDetail("user-1", ID, "3y")).months).toBe(36);
        await expect(portfolioService.getPortfolioDetail("user-1", ID, "forever")).rejects.toThrow();
      });

      it("gives no dividend yield (the funds' dividends are inside their returns), and warns when the funds are in mixed currencies", async () => {
        const d = await portfolioService.getPortfolioDetail("user-1", ID, "max");
        expect(d.trailingYieldPct).toBeNull();
        expect(d.mixedCurrencies).toBe(false); // both USD

        mockedPrisma.portfolio.findUnique.mockResolvedValue(
          pf({ allocations: [{ fundId: "vt", weightPct: "50.00", fund: { ticker: "VT", name: "x", assetClass: "EQUITY", exchange: "US", currency: "USD" } }, { fundId: "agg", weightPct: "50.00", fund: { ticker: "A35.SI", name: "y", assetClass: "BOND", exchange: "SGX", currency: "SGD" } }] })
        );
        expect((await portfolioService.getPortfolioDetail("user-1", ID, "max")).mixedCurrencies).toBe(true);
      });

      it("says nothing about the limit when the funds start together", async () => {
        mockedPrisma.fundMonthlyReturn.findMany.mockResolvedValue([...months("vt", "2018-01", 84, 0.01), ...months("agg", "2018-01", 84, 0.004)]);
        expect((await portfolioService.getPortfolioDetail("user-1", ID, "max")).limitedBy).toBeNull();
      });

      it("shows a custom mix to its owner without any preset text, and to nobody else (the same 404 as a missing one)", async () => {
        mockedPrisma.portfolio.findUnique.mockResolvedValue(pf({ isPreset: false, userId: "user-1", name: "Global 60/40" })); // a custom mix that borrows a preset's name
        const mine = await portfolioService.getPortfolioDetail("user-1", ID, "max");
        expect(mine.portfolio).toMatchObject({ isPreset: false, tagline: null, highlights: null, suits: null, riskNote: null });

        await expect(portfolioService.getPortfolioDetail("user-2", ID, "max")).rejects.toMatchObject({ statusCode: 404, message: "Portfolio not found" });
        mockedPrisma.portfolio.findUnique.mockResolvedValue(null);
        await expect(portfolioService.getPortfolioDetail("user-1", ID, "max")).rejects.toMatchObject({ statusCode: 404, message: "Portfolio not found" });
      });

      it("404s when its funds share no month, and rejects an id that is not a uuid", async () => {
        mockedPrisma.fundMonthlyReturn.findMany.mockResolvedValue([...months("vt", "2010-01", 12, 0.01), ...months("agg", "2020-01", 12, 0.004)]);
        await expect(portfolioService.getPortfolioDetail("user-1", ID, "max")).rejects.toMatchObject({ statusCode: 404 });
        await expect(portfolioService.getPortfolioDetail("user-1", "nope", "max")).rejects.toThrow();
      });
    });
  });
});

describe("summarizeHistory", () => {
  const rows = (month0: string, returns: number[]): MonthlyRow[] => {
    const [y, m] = month0.split("-").map(Number);
    return returns.map((r, i) => ({ month: new Date(Date.UTC(y, m - 1 + i, 1)).toISOString().slice(0, 7), endPrice: 100, dividend: 0, returnPct: r }));
  };

  it("is null when any fund has no months", () => {
    expect(summarizeHistory([{ fundId: "a", weightPct: 50 }, { fundId: "b", weightPct: 50 }], new Map([["a", rows("2020-01", [0.01])]]))).toBeNull();
  });

  it("reports the worst fall of the blended path", () => {
    const r = [0.1, -0.2, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05];
    const h = summarizeHistory([{ fundId: "a", weightPct: 100 }], new Map([["a", rows("2020-01", r)]]))!;
    expect(h.maxDrawdownPct).toBe(-20);
    expect(h.months).toBe(12);
    expect(h.annualizedReturnPct).not.toBeNull();
  });
});
