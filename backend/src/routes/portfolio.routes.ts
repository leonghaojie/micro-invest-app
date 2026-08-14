/**
 * /portfolio/templates — FR04. Requires auth.
 */
import { Router } from "express";
import { listTemplates } from "../controllers/portfolio.controller";

export const portfolioRouter = Router();

portfolioRouter.get("/templates", listTemplates);
