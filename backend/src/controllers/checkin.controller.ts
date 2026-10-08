import { NextFunction, Request, Response } from "express";
import { checkInService } from "../services/checkin.service";

export async function current(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await checkInService.current(req.userId!));
  } catch (err) {
    next(err);
  }
}

export async function submit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await checkInService.submit(req.userId!, req.body));
  } catch (err) {
    next(err);
  }
}
