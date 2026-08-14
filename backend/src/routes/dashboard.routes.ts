/**
 * /dashboard/* — FR08. Requires auth. NFR-01: target <2s response.
 */
import { Router } from "express";
import { getBehaviour, getGrowth, getSummary } from "../controllers/dashboard.controller";

export const dashboardRouter = Router();

dashboardRouter.get("/summary", getSummary);
dashboardRouter.get("/growth", getGrowth);
dashboardRouter.get("/behaviour", getBehaviour);
