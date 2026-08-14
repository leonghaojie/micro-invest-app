/**
 * Thin controller (Design Model §3.1) — delegates to AuthService.
 * Business logic (FR01/FR02, NFR-06) lands in Phase 3 (roadmap.md).
 */
import { Request, Response } from "express";
import { authService } from "../services/auth.service";

export async function register(req: Request, res: Response): Promise<void> {
  const result = await authService.register(req.body);
  res.status(501).json({ error: "Not implemented yet", todo: "Phase 3 — FR01", result });
}

export async function login(req: Request, res: Response): Promise<void> {
  const result = await authService.login(req.body);
  res.status(501).json({ error: "Not implemented yet", todo: "Phase 3 — FR02", result });
}
