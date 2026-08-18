import { NextFunction, Request, Response } from "express";
import { insightService } from "../services/insight.service";

export async function listInsights(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cards = await insightService.generate(req.userId!);
    res.status(200).json(cards);
  } catch (err) {
    next(err);
  }
}
