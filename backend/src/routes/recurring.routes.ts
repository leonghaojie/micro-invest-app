/**
 * /recurring/* — monthly buys (DECISIONS.md #19): list, set up, change the amount, pause and
 * resume. Requires auth.
 */
import { Router } from "express";
import { changeAmount, create, list, pause, resume } from "../controllers/recurring.controller";

export const recurringRouter = Router();

recurringRouter.get("/", list);
recurringRouter.post("/", create);
recurringRouter.put("/:id", changeAmount);
recurringRouter.post("/:id/pause", pause);
recurringRouter.post("/:id/resume", resume);
