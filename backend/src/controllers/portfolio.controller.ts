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

export async function getFundDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await portfolioService.getFundDetail(req.params.id, req.query.range);
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

// DECISIONS.md #28: one portfolio's page (description, funds, history). ?range=1y|3y|5y|10y|max
export async function getPortfolioDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await portfolioService.getPortfolioDetail(req.userId!, req.params.id, req.query.range));
  } catch (err) {
    next(err);
  }
}
