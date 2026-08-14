/**
 * Sanity test for the skeleton — confirms AppServer boots and wires
 * middleware correctly. Real FR-level test suites land per-phase
 * (roadmap.md Phases 3–8, Lab #4 alignment).
 */
import request from "supertest";
import { createApp } from "./app";

describe("AppServer skeleton", () => {
  const app = createApp();

  it("GET /health returns ok without auth", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("rejects unauthenticated requests to protected routes", async () => {
    const res = await request(app).get("/user/profile");
    expect(res.status).toBe(401);
  });

  it("does not require auth for /auth/login", async () => {
    // A malformed body reaches Zod validation (400) without ever touching
    // the DB, which proves the route was reachable without a bearer token
    // — a real bad-credentials attempt would also legitimately 401, so
    // that status alone can't distinguish "blocked by requireAuth" from
    // "rejected by AuthService", but the auth-gate's own message can:
    const res = await request(app).post("/auth/login").send({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error).not.toBe("Missing or malformed Authorization header");
  });
});
