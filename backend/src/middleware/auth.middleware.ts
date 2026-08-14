/**
 * requireAuth — Design Model §3.1:
 * "all routes except /auth/register and /auth/login require a valid JWT,
 *  checked once in Express middleware before any controller runs;
 *  controllers never re-check auth themselves."
 */
import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

interface AccessTokenPayload {
  sub: string; // userId
}

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const header = req.header("authorization") ?? req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

  if (!token) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret) as AccessTokenPayload;
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
