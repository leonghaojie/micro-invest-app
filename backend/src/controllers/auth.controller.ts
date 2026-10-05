/**
 * Thin controller (Design Model §3.1) — delegates to AuthService.
 * Errors (validation, duplicate email, bad credentials) are thrown by the
 * service and forwarded to errorHandler.middleware.ts via next(err) rather
 * than handled here.
 */
import { NextFunction, Request, Response } from "express";
import { authService } from "../services/auth.service";

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await authService.register(req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await authService.login(req.body);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

// Same 200 + message for every email, registered or not (DECISIONS.md #10).
export async function forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await authService.requestPasswordReset(req.body);
    res.status(200).json({ message: "If that email has an account, a reset code is on its way." });
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await authService.resetPassword(req.body);
    res.status(200).json({ message: "Password updated. You can now log in." });
  } catch (err) {
    next(err);
  }
}

// Session check: reached only through requireAuth (see auth.routes.ts).
export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json({ user: await authService.getCurrentUser(req.userId!) });
  } catch (err) {
    next(err);
  }
}

export async function changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await authService.changePassword(req.userId!, req.body);
    res.status(200).json({ message: "Password updated." });
  } catch (err) {
    next(err);
  }
}

export async function changeEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json({ user: await authService.changeEmail(req.userId!, req.body) });
  } catch (err) {
    next(err);
  }
}
