/**
 * /plan — the account summary: snapshots per month, what is held, cash. Starting a plan is
 * gone (DECISIONS.md #19): money goes in through /trades. Requires auth.
 */
import { Router } from "express";
import { getActivePlan } from "../controllers/plan.controller";

export const planRouter = Router();

planRouter.get("/", getActivePlan);
