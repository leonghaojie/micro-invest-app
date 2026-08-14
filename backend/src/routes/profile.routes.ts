/**
 * /user/profile — FR03. Requires auth (wired in app.ts via requireAuth).
 */
import { Router } from "express";
import { getProfile, upsertProfile } from "../controllers/profile.controller";

export const profileRouter = Router();

profileRouter.get("/profile", getProfile);
profileRouter.post("/profile", upsertProfile);
