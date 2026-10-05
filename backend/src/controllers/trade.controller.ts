import { NextFunction, Request, Response } from "express";
import { tradeService } from "../services/trade.service";

export async function buy(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(201).json(await tradeService.buy(req.userId!, req.body));
  } catch (err) {
    next(err);
  }
}

export async function sell(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(201).json(await tradeService.sell(req.userId!, req.body));
  } catch (err) {
    next(err);
  }
}

export async function history(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    res.status(200).json({ items: await tradeService.history(req.userId!, limit) });
  } catch (err) {
    next(err);
  }
}
