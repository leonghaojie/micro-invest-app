/**
 * /auth/* — the only routes that do NOT go through requireAuth
 * (Design Model §3.1). FR01 (register), FR02 (login), FR22/FR23 (password reset).
 */
import { Router } from "express";
import { forgotPassword, login, register, resetPassword } from "../controllers/auth.controller";

export const authRouter = Router();

authRouter.post("/register", register);
authRouter.post("/login", login);
authRouter.post("/forgot-password", forgotPassword);
authRouter.post("/reset-password", resetPassword);
