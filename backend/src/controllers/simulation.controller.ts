import { NextFunction, Request, Response } from "express";
import { simulationService } from "../services/simulation.service";

export async function runSimulation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await simulationService.run(req.userId!, req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getHistory(req: Request, res: Response): Promise<void> {
  const result = await simulationService.getHistory(req.userId!);
  res.status(501).json({ error: "Not implemented yet", todo: "Phase 7 — FR13", result });
}
