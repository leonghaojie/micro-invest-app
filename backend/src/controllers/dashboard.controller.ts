import { NextFunction, Request, Response } from "express";
import { dashboardService } from "../services/dashboard.service";

export async function getSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await dashboardService.getSummary(req.userId!);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getGrowth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await dashboardService.getGrowth(req.userId!);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getBehaviour(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await dashboardService.getBehaviour(req.userId!);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
