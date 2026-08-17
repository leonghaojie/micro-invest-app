import { NextFunction, Request, Response } from "express";
import { portfolioService } from "../services/portfolio.service";

export async function listTemplates(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await portfolioService.listTemplates();
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
