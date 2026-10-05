/** attemptLimiter (DECISIONS.md #17): a fixed number of wrong guesses per window, then a block that expires. */
import { createAttemptLimiter } from "./attemptLimiter";

describe("createAttemptLimiter", () => {
  const MIN = 60_000;
  let t = 0;
  const make = () => createAttemptLimiter({ maxFailures: 3, windowMs: 15 * MIN, now: () => t });

  beforeEach(() => {
    t = 1_000_000;
  });

  it("allows attempts until the limit of failures is reached", () => {
    const l = make();
    expect(l.blockedForMs("u")).toBe(0);
    l.recordFailure("u");
    l.recordFailure("u");
    expect(l.blockedForMs("u")).toBe(0); // 2 of 3
    l.recordFailure("u");
    expect(l.blockedForMs("u")).toBeGreaterThan(0); // 3 of 3: blocked
  });

  it("says how long the block lasts, counted from the oldest failure that still counts", () => {
    const l = make();
    l.recordFailure("u"); // t0
    t += 2 * MIN;
    l.recordFailure("u"); // t0+2
    t += 3 * MIN;
    l.recordFailure("u"); // t0+5
    t += 1 * MIN; // now t0+6

    // the first failure leaves the window at t0+15, i.e. 9 minutes from now
    expect(l.blockedForMs("u")).toBe(9 * MIN);
  });

  it("unblocks once old failures age out of the window", () => {
    const l = make();
    l.recordFailure("u");
    l.recordFailure("u");
    l.recordFailure("u");
    t += 15 * MIN + 1;
    expect(l.blockedForMs("u")).toBe(0);
  });

  it("forgets everything after a correct guess", () => {
    const l = make();
    l.recordFailure("u");
    l.recordFailure("u");
    l.reset("u");
    l.recordFailure("u");
    l.recordFailure("u");
    expect(l.blockedForMs("u")).toBe(0); // only 2 since the reset
  });

  it("keeps accounts separate", () => {
    const l = make();
    for (let i = 0; i < 3; i++) l.recordFailure("alice");
    expect(l.blockedForMs("alice")).toBeGreaterThan(0);
    expect(l.blockedForMs("bob")).toBe(0);
  });

  it("does not let failures pile up unbounded beyond the window", () => {
    const l = make();
    for (let i = 0; i < 50; i++) {
      l.recordFailure("u");
      t += 20 * MIN; // each failure expires before the next
    }
    expect(l.blockedForMs("u")).toBe(0);
  });
});
