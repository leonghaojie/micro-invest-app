/**
 * /portfolio/* — FR04, plus the DECISIONS.md #1 second amendment
 * (multi-fund portfolios). Requires auth.
 */
import { Router } from "express";
import { createPortfolio, getFundDetail, getPortfolioDetail, listFunds, listPortfolios } from "../controllers/portfolio.controller";

export const portfolioRouter = Router();

portfolioRouter.get("/funds", listFunds);
// DECISIONS.md #14: one fund's history and statistics. ?range=1y|3y|5y|10y|max
portfolioRouter.get("/funds/:id", getFundDetail);
portfolioRouter.get("/portfolios", listPortfolios);
portfolioRouter.post("/portfolios", createPortfolio);
// DECISIONS.md #28: one portfolio's page. ?range=1y|3y|5y|10y|max
portfolioRouter.get("/portfolios/:id", getPortfolioDetail);
