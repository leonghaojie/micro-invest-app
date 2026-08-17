import { NextFunction, Request, Response } from "express";
import { profileService } from "../services/profile.service";

export async function getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await profileService.getProfile(req.userId!);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function upsertProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await profileService.upsertProfile(req.userId!, req.body);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
