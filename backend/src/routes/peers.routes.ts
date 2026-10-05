/**
 * /peers/* — FR09, FR10, FR11 (UC-05). Requires auth.
 * NFR-03: responses must only ever contain aggregated stats, never raw peer records.
 */
import { Router } from "express";
import { getCohort, getDashboard, getDistribution, getSummary } from "../controllers/peers.controller";

export const peersRouter = Router();

peersRouter.get("/summary", getSummary);
peersRouter.get("/distribution", getDistribution);
// DECISIONS.md #9: segment-aware distribution/trajectory/allocation.
peersRouter.get("/dashboard", getDashboard);
// DECISIONS.md #18: the default comparison - cohort by weighted nearest neighbours, one peer set per metric.
peersRouter.get("/cohort", getCohort);
