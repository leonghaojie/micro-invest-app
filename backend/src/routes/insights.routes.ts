/**
 * /insights — FR12 (UC-06). Requires auth.
 */
import { Router } from "express";
import { listInsights } from "../controllers/insights.controller";

export const insightsRouter = Router();

insightsRouter.get("/", listInsights);
