import { NextFunction, Request, Response } from "express";
import { recurringService } from "../services/recurring.service";

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await recurringService.list(req.userId!));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(201).json(await recurringService.create(req.userId!, req.body));
  } catch (err) {
    next(err);
  }
}

export async function pause(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await recurringService.pause(req.userId!, req.params.id));
  } catch (err) {
    next(err);
  }
}

export async function resume(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await recurringService.resume(req.userId!, req.params.id));
  } catch (err) {
    next(err);
  }
}

export async function changeAmount(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await recurringService.changeAmount(req.userId!, req.params.id, req.body));
  } catch (err) {
    next(err);
  }
}
