/**
 * /portfolio/* — FR04, plus the DECISIONS.md #1 second amendment
 * (multi-fund portfolios). Requires auth.
 */
import { Router } from "express";
import { createPortfolio, listFunds, listPortfolios } from "../controllers/portfolio.controller";

export const portfolioRouter = Router();

portfolioRouter.get("/funds", listFunds);
portfolioRouter.get("/portfolios", listPortfolios);
portfolioRouter.post("/portfolios", createPortfolio);
