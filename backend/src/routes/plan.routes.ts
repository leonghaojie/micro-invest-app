/**
 * /plan/* — FR05, FR06, FR07 (start/replace), plus a plain GET for the
 * currently active plan (replaces the old /simulation/history 501 stub —
 * trivial now since there's only ever one active plan). Requires auth.
 */
import { Router } from "express";
import { getActivePlan, startPlan } from "../controllers/plan.controller";

export const planRouter = Router();

planRouter.post("/", startPlan);
planRouter.get("/", getActivePlan);
