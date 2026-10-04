/**
 * Centralised error handler (NFR-04 — "system shall handle invalid inputs
 * gracefully ... meaningful errors"). Kept separate from auth.middleware.ts
 * since it's a distinct cross-cutting concern.
 */
import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "../utils/httpError";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Validation failed", details: err.flatten() });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  // express.json() rejects an unparseable or oversized body before any
  // controller runs. That is the client's mistake, not a server fault, so it
  // must not surface as a 500 (or be logged as one).
  if (isBodyParserError(err)) {
    res.status(err.status).json({ error: err.status === 413 ? "Request body too large" : "Malformed request body" });
    return;
  }

  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}

function isBodyParserError(err: unknown): err is { status: number; type: string } {
  if (typeof err !== "object" || err === null) return false;
  const { type, status } = err as { type?: unknown; status?: unknown };
  return typeof type === "string" && type.startsWith("entity.") && typeof status === "number";
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
}
