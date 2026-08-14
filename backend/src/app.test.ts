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
    const res = await request(app).post("/auth/login").send({ email: "a@b.com", password: "x" });
    // Not 401 — route is reachable without a token (may still 501, that's fine here).
    expect(res.status).not.toBe(401);
  });
});
