import { Request, Response } from "express";
import { insightService } from "../services/insight.service";

export async function listInsights(req: Request, res: Response): Promise<void> {
  const result = await insightService.generate(req.userId!);
  res.status(501).json({ error: "Not implemented yet", todo: "Phase 6 — FR12", result });
}
