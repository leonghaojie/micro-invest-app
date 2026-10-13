/**
 * Insight cards (DECISIONS.md #32): cohort peers per card, the savings-rate card's
 * non-circular weights, the privacy floor, and wording that describes but never advises.
 */
import { buildInsightCards, INSIGHT_WEIGHTS, InsightCard, positionTitle } from "./insightCards";
import { buildPopulation, Member } from "./peerCohort";

function member(id: string, over: Partial<Member> = {}): Member {
  return {
    id,
    age: 28,
    income: 4000,
    expense: 2400,
    risk: "MEDIUM",
    contribution: 400,
    consistencyPct: 100,
    value: 5000,
    cash: 4800,
    holdings: [{ assetClass: "EQUITY", weight: 1 }],
    monthlyReturns: {},
    ...over,
  };
}

/** `n` peers whose value, expense and cash rise with their index, around the default member. */
function crowd(n: number, over: (i: number) => Partial<Member> = () => ({})): Member[] {
  return Array.from({ length: n }, (_, i) =>
    member(`p${String(i).padStart(3, "0")}`, { value: 1000 + i * 200, expense: 1500 + i * 30, cash: 1000 + i * 150, ...over(i) }),
  );
}

const byKey = (cards: InsightCard[], key: InsightCard["key"]) => cards.find((c) => c.key === key)!;
const MIN_GROUP = 10;

describe("buildInsightCards", () => {
  it("returns the three cards in a fixed order", () => {
    const me = member("me");
    const cards = buildInsightCards(buildPopulation([me, ...crowd(40)]), me, { minGroup: MIN_GROUP });
    expect(cards.map((c) => c.key)).toEqual(["value", "savingsRate", "cashBuffer"]);
    expect(cards.every((c) => c.status === "ok")).toBe(true);
  });

  it("reports the user's figure, the peer median, the middle half and the percentile", () => {
    const me = member("me", { value: 5000 });
    const peers = crowd(40); // values 1000, 1200, ..., 8800
    const card = byKey(buildInsightCards(buildPopulation([me, ...peers]), me, { minGroup: MIN_GROUP }), "value");
    expect(card.you).toBe(5000);
    expect(card.cohortSize).toBe(40);
    expect(card.median).toBe(4900);
    expect(card.p25).toBe(2950);
    expect(card.p75).toBe(6850);
    expect(card.percentile).toBe(51);
    expect(card.title).toBe("Portfolio value: in the middle of similar investors");
    expect(card.body).toContain("$5,000.00");
    expect(card.body).toContain("the median is $4,900.00");
  });

  it("works out the savings rate from the profile and the cash buffer in months of expenses", () => {
    const me = member("me", { income: 5000, expense: 2000, cash: 5000 });
    const cards = buildInsightCards(buildPopulation([me, ...crowd(40)]), me, { minGroup: MIN_GROUP });
    expect(byKey(cards, "savingsRate").you).toBe(60);
    expect(byKey(cards, "cashBuffer").you).toBe(2.5);
    expect(byKey(cards, "cashBuffer").body).toContain("2.5 months");
  });

  it("counts a negative cash balance as no buffer rather than a negative one", () => {
    const me = member("me", { cash: -300 });
    expect(byKey(buildInsightCards(buildPopulation([me, ...crowd(40)]), me, { minGroup: MIN_GROUP }), "cashBuffer").you).toBe(0);
  });

  describe("savings rate weights (not circular)", () => {
    it("leave investment capacity out, because capacity is the savings rate itself", () => {
      expect(INSIGHT_WEIGHTS.savingsRate.capacity ?? 0).toBe(0);
      expect(INSIGHT_WEIGHTS.value.capacity).toBeGreaterThan(0);
    });

    it("pick peers by income and life stage, not by having the same savings rate", () => {
      const me = member("me", { age: 28, expense: 2400 }); // 40%
      // Same savings rate as the user, but 20 years older.
      const sameRate = Array.from({ length: 30 }, (_, i) => member(`r${String(i).padStart(2, "0")}`, { age: 48, expense: 2400 }));
      // Same age, savings rates from 5% to 92%.
      const sameAge = Array.from({ length: 30 }, (_, i) => member(`a${String(i).padStart(2, "0")}`, { age: 28, expense: 3800 - i * 110 }));
      const card = byKey(buildInsightCards(buildPopulation([me, ...sameRate, ...sameAge]), me, { minGroup: MIN_GROUP, k: 30 }), "savingsRate");
      expect(card.basis).toBe("similar income and life stage");
      expect(card.cohortSize).toBe(30);
      // Matched on capacity, all 30 would be the same-rate group and the middle half would collapse to 40%.
      expect(card.p25).toBeLessThan(40);
      expect(card.p75).toBeGreaterThan(40);
    });
  });

  it("marks a card unavailable when the user has no figure for it", () => {
    const me = member("me", { value: undefined, cash: undefined });
    const cards = buildInsightCards(buildPopulation([me, ...crowd(40)]), me, { minGroup: MIN_GROUP });
    expect(byKey(cards, "value")).toMatchObject({ status: "unavailable", title: "Portfolio value" });
    expect(byKey(cards, "cashBuffer").status).toBe("unavailable");
    expect(byKey(cards, "value").median).toBeUndefined();
    expect(byKey(cards, "savingsRate").status).toBe("ok");
  });

  it("explains that a purchase made this month shows after the month-end, rather than asking for a first investment", () => {
    const bought = member("me", { value: undefined, cash: undefined });
    const cards = buildInsightCards(buildPopulation([bought, ...crowd(40)]), bought, { minGroup: MIN_GROUP });
    expect(byKey(cards, "value").body).toMatch(/once the month of your first purchase has ended/);
    expect(byKey(cards, "cashBuffer").body).toMatch(/once your first month with the app has ended/);

    const empty = member("me", { value: undefined, holdings: [], expense: 0 });
    const emptyCards = buildInsightCards(buildPopulation([empty, ...crowd(40)]), empty, { minGroup: MIN_GROUP });
    expect(byKey(emptyCards, "value").body).toMatch(/Make your first investment/);
    expect(byKey(emptyCards, "cashBuffer").body).toMatch(/Add your usual monthly expenses/);
  });

  it("withholds every peer figure when fewer comparable investors than the privacy floor exist", () => {
    const me = member("me");
    const cards = buildInsightCards(buildPopulation([me, ...crowd(MIN_GROUP - 1)]), me, { minGroup: MIN_GROUP });
    for (const c of cards) {
      expect(c.status).toBe("withheld");
      expect(c.median).toBeUndefined();
      expect(c.cohortSize).toBeUndefined();
      expect(c.body).toMatch(/too few comparable investors/);
    }
  });

  it("only counts peers who have the measure: holding cash only does not make someone a value peer", () => {
    const me = member("me");
    const peers = crowd(40, (i) => (i < 35 ? { value: undefined } : {}));
    const cards = buildInsightCards(buildPopulation([me, ...peers]), me, { minGroup: MIN_GROUP });
    expect(byKey(cards, "value").status).toBe("withheld");
    expect(byKey(cards, "savingsRate").status).toBe("ok");
  });

  it("describes and never advises", () => {
    const me = member("me", { value: 500, expense: 3900, cash: 0 }); // at the bottom on every card
    const cards = buildInsightCards(buildPopulation([me, ...crowd(40)]), me, { minGroup: MIN_GROUP });
    for (const c of cards) {
      expect(c.title).toMatch(/below the middle/);
      expect(c.body).not.toMatch(/\b(should|consider|try|raise|increase|trim|cut|reduce|boost|keep it up)\b/i);
      expect(c).not.toHaveProperty("showAdjustPlanAction");
    }
  });

  it("never returns another member's id", () => {
    const me = member("me");
    const json = JSON.stringify(buildInsightCards(buildPopulation([me, ...crowd(40)]), me, { minGroup: MIN_GROUP }));
    expect(json).not.toMatch(/"p0\d\d"/);
  });
});

describe("positionTitle", () => {
  it("says below, in or above the middle half, inclusive at the quartiles", () => {
    expect(positionTitle("Savings rate", 9, 10, 20)).toBe("Savings rate: below the middle of similar investors");
    expect(positionTitle("Savings rate", 10, 10, 20)).toBe("Savings rate: in the middle of similar investors");
    expect(positionTitle("Savings rate", 20, 10, 20)).toBe("Savings rate: in the middle of similar investors");
    expect(positionTitle("Savings rate", 21, 10, 20)).toBe("Savings rate: above the middle of similar investors");
  });
});
