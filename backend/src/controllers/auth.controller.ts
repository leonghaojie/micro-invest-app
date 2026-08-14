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
