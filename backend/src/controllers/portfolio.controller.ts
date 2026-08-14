import { Request, Response } from "express";
import { portfolioService } from "../services/portfolio.service";

export async function listTemplates(req: Request, res: Response): Promise<void> {
  const result = await portfolioService.listTemplates();
  res.status(501).json({ error: "Not implemented yet", todo: "Phase 3 — FR04", result });
}
