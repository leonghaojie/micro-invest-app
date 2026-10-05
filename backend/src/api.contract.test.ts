/**
 * HTTP-level black-box tests (Phase 8): every route is driven through the real
 * Express app with supertest — real routing, requireAuth, controllers, zod
 * validation and the error handler — while the services behind the controllers
 * are mocked. Services have their own unit suites (`*.service.test.ts`); this
 * file checks the contract a client actually sees:
 *   - the auth gate (no / malformed / bad-signature / expired token -> 401),
 *   - the controller passes the *token's* user id and the request body on,
 *   - success status codes,
 *   - error mapping: HttpError -> its status, ZodError -> 400, anything else
 *     -> 500 with no internal detail leaked,
 *   - unknown routes -> 404.
 */
import jwt from "jsonwebtoken";
import request from "supertest";
import { createApp } from "./app";
import { env } from "./config/env";
import { authService } from "./services/auth.service";
import { dashboardService } from "./services/dashboard.service";
import { friendsService } from "./services/friends.service";
import { insightService } from "./services/insight.service";
import { peerBenchmarkService } from "./services/peerBenchmark.service";
import { peerCohortService } from "./services/peerCohort.service";
import { peerGroupingService } from "./services/peerGrouping.service";
import { peerInsightsService } from "./services/peerInsights.service";
import { planService } from "./services/plan.service";
import { recurringService } from "./services/recurring.service";
import { tradeService } from "./services/trade.service";
import { portfolioService } from "./services/portfolio.service";
import { profileService } from "./services/profile.service";
import { HttpError } from "./utils/httpError";

jest.mock("./services/auth.service", () => ({
  authService: { register: jest.fn(), login: jest.fn(), requestPasswordReset: jest.fn(), resetPassword: jest.fn(), changePassword: jest.fn(), changeEmail: jest.fn(), getCurrentUser: jest.fn() },
}));
jest.mock("./services/dashboard.service", () => ({ dashboardService: { getSummary: jest.fn(), getGrowth: jest.fn() } }));
jest.mock("./services/insight.service", () => ({ insightService: { generate: jest.fn() } }));
jest.mock("./services/friends.service", () => ({
  friendsService: {
    getOverview: jest.fn(),
    getComparison: jest.fn(),
    getHoldings: jest.fn(),
    getHoldingsDetail: jest.fn(),
    updateSettings: jest.fn(),
    sendRequest: jest.fn(),
    acceptRequest: jest.fn(),
    removeFriendship: jest.fn(),
  },
}));
jest.mock("./services/peerBenchmark.service", () => ({
  peerBenchmarkService: { computeStats: jest.fn(), getMyMetrics: jest.fn() },
}));
// Keep the real parsePeerDimensions/describeTier so the controller's dimension
// validation is exercised; only the DB-touching instance is replaced.
jest.mock("./services/peerGrouping.service", () => ({
  ...jest.requireActual("./services/peerGrouping.service"),
  peerGroupingService: { assignPeerGroup: jest.fn(), resolveSegment: jest.fn() },
}));
jest.mock("./services/peerCohort.service", () => ({ peerCohortService: { getCohort: jest.fn() } }));
jest.mock("./services/peerInsights.service", () => ({
  ...jest.requireActual("./services/peerInsights.service"),
  peerInsightsService: { getDashboard: jest.fn() },
}));
jest.mock("./services/plan.service", () => ({ planService: { getActivePlan: jest.fn() } }));
jest.mock("./services/recurring.service", () => ({ recurringService: { list: jest.fn(), create: jest.fn(), pause: jest.fn(), resume: jest.fn(), changeAmount: jest.fn() } }));
jest.mock("./services/trade.service", () => ({ tradeService: { buy: jest.fn(), sell: jest.fn(), history: jest.fn() } }));
jest.mock("./services/portfolio.service", () => ({
  portfolioService: { listFunds: jest.fn(), getFundDetail: jest.fn(), listPortfolios: jest.fn(), createPortfolio: jest.fn() },
}));
jest.mock("./services/profile.service", () => ({ profileService: { getProfile: jest.fn(), upsertProfile: jest.fn() } }));

const app = createApp();
const USER_ID = "user-123";
const token = jwt.sign({ sub: USER_ID }, env.jwtSecret, { expiresIn: "1h" });
const auth = { Authorization: `Bearer ${token}` };

beforeEach(() => {
  jest.clearAllMocks();
});

interface RouteCase {
  name: string;
  method: "get" | "post" | "put" | "delete";
  path: string;
  body?: object;
  fn: jest.Mock;
  /** value the mocked service resolves with */
  returns: unknown;
  status: number;
  /** expected args the service receives */
  args: unknown[];
}

const body = { example: "payload" };

const protectedRoutes: RouteCase[] = [
  { name: "GET /user/profile", method: "get", path: "/user/profile", fn: profileService.getProfile as jest.Mock, returns: { id: "p" }, status: 200, args: [USER_ID] },
  { name: "POST /user/profile", method: "post", path: "/user/profile", body, fn: profileService.upsertProfile as jest.Mock, returns: { id: "p" }, status: 200, args: [USER_ID, body] },
  { name: "GET /portfolio/funds", method: "get", path: "/portfolio/funds", fn: portfolioService.listFunds as jest.Mock, returns: [], status: 200, args: [] },
  { name: "GET /portfolio/funds/:id", method: "get", path: "/portfolio/funds/abc", fn: portfolioService.getFundDetail as jest.Mock, returns: {}, status: 200, args: ["abc", undefined] },
  { name: "GET /portfolio/portfolios", method: "get", path: "/portfolio/portfolios", fn: portfolioService.listPortfolios as jest.Mock, returns: [], status: 200, args: [USER_ID] },
  { name: "POST /portfolio/portfolios", method: "post", path: "/portfolio/portfolios", body, fn: portfolioService.createPortfolio as jest.Mock, returns: { id: "pf" }, status: 201, args: [USER_ID, body] },
  { name: "POST /trades/buy", method: "post", path: "/trades/buy", body, fn: tradeService.buy as jest.Mock, returns: { side: "BUY" }, status: 201, args: [USER_ID, body] },
  { name: "GET /recurring", method: "get", path: "/recurring", fn: recurringService.list as jest.Mock, returns: { rules: [] }, status: 200, args: [USER_ID] },
  { name: "POST /recurring", method: "post", path: "/recurring", body, fn: recurringService.create as jest.Mock, returns: { rule: {} }, status: 201, args: [USER_ID, body] },
  { name: "POST /recurring/:id/pause", method: "post", path: "/recurring/r1/pause", fn: recurringService.pause as jest.Mock, returns: { id: "r1" }, status: 200, args: [USER_ID, "r1"] },
  { name: "POST /recurring/:id/resume", method: "post", path: "/recurring/r1/resume", fn: recurringService.resume as jest.Mock, returns: { rule: {} }, status: 200, args: [USER_ID, "r1"] },
  { name: "PUT /recurring/:id", method: "put", path: "/recurring/r1", body, fn: recurringService.changeAmount as jest.Mock, returns: { id: "r2" }, status: 200, args: [USER_ID, "r1", body] },
  { name: "POST /trades/sell", method: "post", path: "/trades/sell", body, fn: tradeService.sell as jest.Mock, returns: { side: "SELL" }, status: 201, args: [USER_ID, body] },
  { name: "GET /plan", method: "get", path: "/plan", fn: planService.getActivePlan as jest.Mock, returns: { planId: "pl" }, status: 200, args: [USER_ID] },
  { name: "GET /dashboard/summary", method: "get", path: "/dashboard/summary", fn: dashboardService.getSummary as jest.Mock, returns: {}, status: 200, args: [USER_ID] },
  { name: "GET /dashboard/growth", method: "get", path: "/dashboard/growth", fn: dashboardService.getGrowth as jest.Mock, returns: [], status: 200, args: [USER_ID] },
  { name: "GET /insights", method: "get", path: "/insights", fn: insightService.generate as jest.Mock, returns: [], status: 200, args: [USER_ID] },
  { name: "GET /friends", method: "get", path: "/friends", fn: friendsService.getOverview as jest.Mock, returns: {}, status: 200, args: [USER_ID] },
  { name: "GET /friends/comparison", method: "get", path: "/friends/comparison", fn: friendsService.getComparison as jest.Mock, returns: {}, status: 200, args: [USER_ID] },
  { name: "GET /friends/holdings", method: "get", path: "/friends/holdings", fn: friendsService.getHoldings as jest.Mock, returns: {}, status: 200, args: [USER_ID] },
  { name: "GET /friends/holdings/:id", method: "get", path: "/friends/holdings/abc", fn: friendsService.getHoldingsDetail as jest.Mock, returns: {}, status: 200, args: [USER_ID, "abc"] },
  { name: "PUT /friends/settings", method: "put", path: "/friends/settings", body, fn: friendsService.updateSettings as jest.Mock, returns: {}, status: 200, args: [USER_ID, body] },
  { name: "POST /friends/requests", method: "post", path: "/friends/requests", body, fn: friendsService.sendRequest as jest.Mock, returns: {}, status: 202, args: [USER_ID, body] },
  { name: "POST /friends/requests/:id/accept", method: "post", path: "/friends/requests/abc/accept", fn: friendsService.acceptRequest as jest.Mock, returns: undefined, status: 204, args: [USER_ID, "abc"] },
  { name: "DELETE /friends/:id", method: "delete", path: "/friends/abc", fn: friendsService.removeFriendship as jest.Mock, returns: undefined, status: 204, args: [USER_ID, "abc"] },
];

describe("authentication gate on protected routes", () => {
  const everyProtected = [
    ...protectedRoutes.map((r) => [r.name, r.method, r.path] as const),
    ["GET /auth/me", "get", "/auth/me"] as const,
    ["POST /auth/change-password", "post", "/auth/change-password"] as const,
    ["PUT /auth/email", "put", "/auth/email"] as const,
    ["GET /peers/summary", "get", "/peers/summary"] as const,
    ["GET /peers/distribution", "get", "/peers/distribution"] as const,
    ["GET /peers/dashboard", "get", "/peers/dashboard"] as const,
    ["GET /peers/cohort", "get", "/peers/cohort"] as const,
  ];

  it.each(everyProtected)("%s -> 401 with no Authorization header", async (_n, method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Missing or malformed Authorization header");
  });

  it.each(everyProtected)("%s -> 401 for a non-Bearer scheme", async (_n, method, path) => {
    const res = await request(app)[method](path).set("Authorization", `Basic ${token}`);
    expect(res.status).toBe(401);
  });

  it("401 for a token signed with the wrong secret", async () => {
    const forged = jwt.sign({ sub: USER_ID }, "not-the-real-secret");
    const res = await request(app).get("/plan").set("Authorization", `Bearer ${forged}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid or expired token");
    expect(planService.getActivePlan).not.toHaveBeenCalled();
  });

  it("401 for an expired token", async () => {
    const expired = jwt.sign({ sub: USER_ID }, env.jwtSecret, { expiresIn: -10 });
    const res = await request(app).get("/plan").set("Authorization", `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(planService.getActivePlan).not.toHaveBeenCalled();
  });

  it("401 for garbage in place of a token", async () => {
    const res = await request(app).get("/plan").set("Authorization", "Bearer not.a.jwt");
    expect(res.status).toBe(401);
  });
});

describe("authenticated routes delegate with the token's user id", () => {
  it.each(protectedRoutes)("$name -> $status", async (route) => {
    route.fn.mockResolvedValue(route.returns);

    let req = request(app)[route.method](route.path).set(auth);
    if (route.body) req = req.send(route.body);
    const res = await req;

    expect(res.status).toBe(route.status);
    expect(route.fn).toHaveBeenCalledWith(...route.args);
    if (route.status !== 204) expect(res.body).toEqual(route.returns);
  });

  it("ignores a userId smuggled in the body or query (identity comes only from the token)", async () => {
    (profileService.upsertProfile as jest.Mock).mockResolvedValue({});
    await request(app).post("/user/profile?userId=attacker").set(auth).send({ userId: "attacker" });
    expect((profileService.upsertProfile as jest.Mock).mock.calls[0][0]).toBe(USER_ID);
  });
});

describe("GET /trades (activity)", () => {
  it("returns the account's activity, with the limit clamped", async () => {
    (tradeService.history as jest.Mock).mockResolvedValue([{ kind: "BUY" }]);
    const res = await request(app).get("/trades?limit=9999").set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [{ kind: "BUY" }] });
    expect(tradeService.history).toHaveBeenCalledWith(USER_ID, 200);
  });

  it("needs sign-in", async () => {
    expect((await request(app).get("/trades")).status).toBe(401);
    expect((await request(app).post("/trades/buy").send({})).status).toBe(401);
    expect((await request(app).post("/trades/sell").send({})).status).toBe(401);
  });
});

describe("POST /plan is gone (money goes in through /trades)", () => {
  it("is a 404", async () => {
    expect((await request(app).post("/plan").set(auth).send({})).status).toBe(404);
  });
});

describe("GET /plan with no active plan", () => {
  it("404s with a message", async () => {
    (planService.getActivePlan as jest.Mock).mockResolvedValue(null);
    const res = await request(app).get("/plan").set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Set up your profile first");
  });
});

describe("error mapping", () => {
  it.each([
    [404, "Not found"],
    [409, "Conflict"],
    [422, "Unprocessable"],
  ])("an HttpError(%i) from a service is returned with its status and message", async (status, message) => {
    (tradeService.buy as jest.Mock).mockRejectedValue(new HttpError(status, message));
    const res = await request(app).post("/trades/buy").set(auth).send({});
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error: message });
  });

  it("an unexpected error becomes a 500 that leaks no internals", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    (dashboardService.getSummary as jest.Mock).mockRejectedValue(new Error("connection to db-host:5433 refused"));
    const res = await request(app).get("/dashboard/summary").set(auth);
    spy.mockRestore();

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
    expect(JSON.stringify(res.body)).not.toContain("db-host");
  });

  it("malformed JSON in a body -> 400 with a clear message, not a 500", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await request(app).post("/trades/buy").set(auth).set("Content-Type", "application/json").send("{ not json");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Malformed request body" });
    expect(spy).not.toHaveBeenCalled(); // a client mistake is not logged as a server fault
    spy.mockRestore();
  });

  it("an oversized body -> 413", async () => {
    const res = await request(app)
      .post("/trades/buy")
      .set(auth)
      .send({ blob: "x".repeat(200_000) });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "Request body too large" });
  });

  it("unknown route -> 404 (authenticated)", async () => {
    const res = await request(app).get("/nope").set(auth);
    expect(res.status).toBe(404);
  });
});

describe("/auth routes (public)", () => {
  it("POST /auth/register -> 201 with the service result", async () => {
    (authService.register as jest.Mock).mockResolvedValue({ token: "t", user: { id: "1", email: "a@b.com" } });
    const res = await request(app).post("/auth/register").send({ email: "a@b.com", password: "longenough" });
    expect(res.status).toBe(201);
    expect(res.body.token).toBe("t");
  });

  it("POST /auth/login -> 200", async () => {
    (authService.login as jest.Mock).mockResolvedValue({ token: "t", user: { id: "1", email: "a@b.com" } });
    const res = await request(app).post("/auth/login").send({ email: "a@b.com", password: "longenough" });
    expect(res.status).toBe(200);
  });

  it("POST /auth/login bad credentials -> 401 generic", async () => {
    (authService.login as jest.Mock).mockRejectedValue(new HttpError(401, "Invalid email or password"));
    const res = await request(app).post("/auth/login").send({ email: "a@b.com", password: "wrongwrong" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid email or password" });
  });

  it("POST /auth/register duplicate -> 409", async () => {
    (authService.register as jest.Mock).mockRejectedValue(new HttpError(409, "Email already registered"));
    const res = await request(app).post("/auth/register").send({ email: "a@b.com", password: "longenough" });
    expect(res.status).toBe(409);
  });

  it("POST /auth/forgot-password -> 200 with the same message for any outcome", async () => {
    (authService.requestPasswordReset as jest.Mock).mockResolvedValue(undefined);
    const res = await request(app).post("/auth/forgot-password").send({ email: "anyone@example.com" });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/If that email has an account/);
  });

  it("POST /auth/reset-password -> 200 on success, 400 with the generic message on failure", async () => {
    (authService.resetPassword as jest.Mock).mockResolvedValueOnce(undefined);
    const ok = await request(app).post("/auth/reset-password").send({ email: "a@b.com", code: "123456", password: "longenough" });
    expect(ok.status).toBe(200);

    (authService.resetPassword as jest.Mock).mockRejectedValueOnce(new HttpError(400, "Invalid or expired reset code"));
    const bad = await request(app).post("/auth/reset-password").send({ email: "a@b.com", code: "000000", password: "longenough" });
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: "Invalid or expired reset code" });
  });
});

describe("account management routes (DECISIONS.md #17)", () => {
  it("POST /auth/change-password passes the token's user id and the body through", async () => {
    (authService.changePassword as jest.Mock).mockResolvedValue(undefined);
    const body = { currentPassword: "oldpassword1", newPassword: "newpassword1" };

    const res = await request(app).post("/auth/change-password").set(auth).send(body);

    expect(res.status).toBe(200);
    expect(authService.changePassword).toHaveBeenCalledWith(USER_ID, body);
    expect(JSON.stringify(res.body)).not.toContain("newpassword1"); // never echoes a password
  });

  it("PUT /auth/email passes the token's user id and returns the updated user", async () => {
    (authService.changeEmail as jest.Mock).mockResolvedValue({ id: USER_ID, email: "new@example.com", displayName: null });

    const res = await request(app).put("/auth/email").set(auth).send({ newEmail: "new@example.com", password: "oldpassword1" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: { id: USER_ID, email: "new@example.com", displayName: null } });
    expect((authService.changeEmail as jest.Mock).mock.calls[0][0]).toBe(USER_ID);
  });

  it("a wrong current password is 403, never 401 (a 401 would sign the mobile user out)", async () => {
    (authService.changePassword as jest.Mock).mockRejectedValue(new HttpError(403, "Current password is incorrect"));
    const res = await request(app).post("/auth/change-password").set(auth).send({ currentPassword: "x", newPassword: "newpassword1" });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Current password is incorrect" });
  });

  it("too many wrong guesses is 429", async () => {
    (authService.changeEmail as jest.Mock).mockRejectedValue(new HttpError(429, "Too many incorrect attempts. Try again in 12 minute(s)."));
    const res = await request(app).put("/auth/email").set(auth).send({ newEmail: "a@b.com", password: "x" });
    expect(res.status).toBe(429);
  });

  it("an email another account uses is 409", async () => {
    (authService.changeEmail as jest.Mock).mockRejectedValue(new HttpError(409, "That email is already registered"));
    const res = await request(app).put("/auth/email").set(auth).send({ newEmail: "a@b.com", password: "x" });
    expect(res.status).toBe(409);
  });
});

describe("/peers routes", () => {
  const group = { memberCount: 12, suppressed: false, bandPct: 10 };

  it("GET /peers/dashboard defaults to income-only and the value metric", async () => {
    (peerGroupingService.resolveSegment as jest.Mock).mockResolvedValue(group);
    (peerInsightsService.getDashboard as jest.Mock).mockResolvedValue({ ok: true });

    const res = await request(app).get("/peers/dashboard").set(auth);

    expect(res.status).toBe(200);
    expect(peerGroupingService.resolveSegment).toHaveBeenCalledWith(USER_ID, ["income"]);
    expect(peerInsightsService.getDashboard).toHaveBeenCalledWith(USER_ID, group, "value");
  });

  it("GET /peers/dashboard passes through chosen dimensions and metric", async () => {
    (peerGroupingService.resolveSegment as jest.Mock).mockResolvedValue(group);
    (peerInsightsService.getDashboard as jest.Mock).mockResolvedValue({});

    await request(app).get("/peers/dashboard?dims=income,age&metric=savingsRatePct").set(auth);

    expect(peerGroupingService.resolveSegment).toHaveBeenCalledWith(USER_ID, ["income", "age"]);
    expect(peerInsightsService.getDashboard).toHaveBeenCalledWith(USER_ID, group, "savingsRatePct");
  });

  it("GET /peers/dashboard rejects an unknown metric with 400 (no SQL-selecting free text)", async () => {
    const res = await request(app).get("/peers/dashboard?metric=passwordHash").set(auth);
    expect(res.status).toBe(400);
    expect(peerInsightsService.getDashboard).not.toHaveBeenCalled();
  });

  it("GET /peers/dashboard rejects an unknown dimension with 400", async () => {
    const res = await request(app).get("/peers/dashboard?dims=income,email").set(auth);
    expect(res.status).toBe(400);
    expect(peerGroupingService.resolveSegment).not.toHaveBeenCalled();
  });

  it("GET /peers/cohort passes the token's user id and returns the report", async () => {
    (peerCohortService.getCohort as jest.Mock).mockResolvedValue({ status: "no-plan" });
    const res = await request(app).get("/peers/cohort").set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "no-plan" });
    expect(peerCohortService.getCohort).toHaveBeenCalledWith(USER_ID);
  });

  it("GET /peers/summary combines group, stats and the caller's own metrics", async () => {
    (peerGroupingService.assignPeerGroup as jest.Mock).mockResolvedValue({ ...group, tier: "income-band" });
    (peerBenchmarkService.computeStats as jest.Mock).mockResolvedValue({ stats: true });
    (peerBenchmarkService.getMyMetrics as jest.Mock).mockResolvedValue({ mine: true });

    const res = await request(app).get("/peers/summary").set(auth);

    expect(res.status).toBe(200);
    expect(peerBenchmarkService.getMyMetrics).toHaveBeenCalledWith(USER_ID);
  });

  it("GET /peers/distribution returns the band and the stats", async () => {
    (peerGroupingService.assignPeerGroup as jest.Mock).mockResolvedValue(group);
    (peerBenchmarkService.computeStats as jest.Mock).mockResolvedValue({ p50: 1 });

    const res = await request(app).get("/peers/distribution").set(auth);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ bandPct: 10, p50: 1 });
  });
});
