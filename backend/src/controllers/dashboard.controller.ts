import { Request, Response } from "express";
import { dashboardService } from "../services/dashboard.service";

export async function getSummary(req: Request, res: Response): Promise<void> {
  const result = await dashboardService.getSummary(req.userId!);
  res.status(501).json({ error: "Not implemented yet", todo: "Phase 4 — FR08", result });
}

export async function getGrowth(req: Request, res: Response): Promise<void> {
  const result = await dashboardService.getGrowth(req.userId!);
  res.status(501).json({ error: "Not implemented yet", todo: "Phase 4 — FR08", result });
}

export async function getBehaviour(req: Request, res: Response): Promise<void> {
  const result = await dashboardService.getBehaviour(req.userId!);
  res.status(501).json({ error: "Not implemented yet", todo: "Phase 4 — FR08 / ConsistencyScore", result });
}
