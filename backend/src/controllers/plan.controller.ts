import { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/httpError";
import { planService } from "../services/plan.service";

export async function getActivePlan(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await planService.getActivePlan(req.userId!);
    if (!result) {
      throw new HttpError(404, "Set up your profile first");
    }
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
