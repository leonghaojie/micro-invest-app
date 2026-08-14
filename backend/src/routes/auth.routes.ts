/**
 * /auth/* — the only routes that do NOT go through requireAuth
 * (Design Model §3.1). FR01 (register), FR02 (login).
 */
import { Router } from "express";
import { login, register } from "../controllers/auth.controller";

export const authRouter = Router();

authRouter.post("/register", register);
authRouter.post("/login", login);
