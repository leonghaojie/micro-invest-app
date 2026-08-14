/**
 * AppServer (Design Model §3 — "start-up class, wiring Express routes and
 * middleware"). Exported separately from index.ts so Jest/Supertest can
 * import the app without binding a real port.
 */
import cors from "cors";
import express, { Express } from "express";
import { requireAuth } from "./middleware/auth.middleware";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.middleware";
import { authRouter } from "./routes/auth.routes";
import { dashboardRouter } from "./routes/dashboard.routes";
import { insightsRouter } from "./routes/insights.routes";
import { peersRouter } from "./routes/peers.routes";
import { portfolioRouter } from "./routes/portfolio.routes";
import { profileRouter } from "./routes/profile.routes";
import { simulationRouter } from "./routes/simulation.routes";

export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Design Model §3.1: /auth/* is the only unauthenticated surface.
  app.use("/auth", authRouter);

  // Everything below requires a valid JWT, checked once here.
  app.use(requireAuth);
  app.use("/user", profileRouter);
  app.use("/portfolio", portfolioRouter);
  app.use("/simulation", simulationRouter);
  app.use("/dashboard", dashboardRouter);
  app.use("/peers", peersRouter);
  app.use("/insights", insightsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
