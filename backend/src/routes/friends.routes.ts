/**
 * /friends/* — DECISIONS.md #8 (friends comparison). Requires auth.
 *
 * This is the one surface that returns named individuals' figures, as a
 * consent-based exception to NFR-03 (see friends.service.ts). The anonymous
 * /peers/* endpoints are separate and unchanged.
 */
import { Router } from "express";
import {
  acceptRequest,
  getComparison,
  getFriendComparison,
  setCloseFriend,
  getOverview,
  removeFriendship,
  sendRequest,
  updateSettings,
} from "../controllers/friends.controller";

export const friendsRouter = Router();

friendsRouter.get("/", getOverview);
friendsRouter.get("/comparison", getComparison);
// DECISIONS.md #26: one friend side by side with you (measures and holdings); :id is a friendship id.
friendsRouter.get("/:id/compare", getFriendComparison);
// DECISIONS.md #27: put a friend on, or take them off, your private close-friends list.
friendsRouter.put("/:id/close", setCloseFriend);
friendsRouter.put("/settings", updateSettings);
friendsRouter.post("/requests", sendRequest);
friendsRouter.post("/requests/:id/accept", acceptRequest);
// Declines a pending request or removes an accepted friend.
friendsRouter.delete("/:id", removeFriendship);
