import { Request, Response } from "express";
import { simulationService } from "../services/simulation.service";

export async function runSimulation(req: Request, res: Response): Promise<void> {
  const result = await simulationService.run(req.userId!, req.body);
  res.status(501).json({ error: "Not implemented yet", todo: "Phase 4 — FR05/FR06/FR07", result });
}

export async function getHistory(req: Request, res: Response): Promise<void> {
  const result = await simulationService.getHistory(req.userId!);
  res.status(501).json({ error: "Not implemented yet", todo: "Phase 7 — FR13", result });
}
