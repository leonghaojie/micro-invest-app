import { NextFunction, Request, Response } from "express";
import { portfolioService } from "../services/portfolio.service";

export async function listFunds(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await portfolioService.listFunds();
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function listPortfolios(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await portfolioService.listPortfolios(req.userId!);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function createPortfolio(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await portfolioService.createPortfolio(req.userId!, req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}
