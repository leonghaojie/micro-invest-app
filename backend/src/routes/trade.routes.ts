/**
 * /trades/* — buy and sell (DECISIONS.md #19), plus the account's activity list. Requires auth.
 */
import { Router } from "express";
import { buy, history, sell } from "../controllers/trade.controller";

export const tradeRouter = Router();

tradeRouter.post("/buy", buy);
tradeRouter.post("/sell", sell);
tradeRouter.get("/", history);
