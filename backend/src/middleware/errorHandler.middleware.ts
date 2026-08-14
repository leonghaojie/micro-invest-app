/**
 * Centralised error handler (NFR-04 — "system shall handle invalid inputs
 * gracefully ... meaningful errors"). Kept separate from auth.middleware.ts
 * since it's a distinct cross-cutting concern.
 */
import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Validation failed", details: err.flatten() });
    return;
  }

  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
}
