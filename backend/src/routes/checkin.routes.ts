/**
 * /checkin/* — the monthly check-in (DECISIONS.md #31): what the user earned and spent this month.
 * Requires auth.
 */
import { Router } from "express";
import { current, submit } from "../controllers/checkin.controller";

export const checkInRouter = Router();

checkInRouter.get("/current", current);
checkInRouter.put("/current", submit);
