import { Request, Response } from "express";
import { profileService } from "../services/profile.service";

export async function getProfile(req: Request, res: Response): Promise<void> {
  const result = await profileService.getProfile(req.userId!);
  res.status(501).json({ error: "Not implemented yet", todo: "Phase 3 — FR03", result });
}

export async function upsertProfile(req: Request, res: Response): Promise<void> {
  const result = await profileService.upsertProfile(req.userId!, req.body);
  res.status(501).json({ error: "Not implemented yet", todo: "Phase 3 — FR03", result });
}
