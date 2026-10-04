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
  getHoldings,
  getHoldingsDetail,
  getOverview,
  removeFriendship,
  sendRequest,
  updateSettings,
} from "../controllers/friends.controller";

export const friendsRouter = Router();

friendsRouter.get("/", getOverview);
friendsRouter.get("/comparison", getComparison);
// DECISIONS.md #12: what friends hold, for those who opted in.
friendsRouter.get("/holdings", getHoldings);
// One person's full holdings; :id is a friendship id, or "me".
friendsRouter.get("/holdings/:id", getHoldingsDetail);
friendsRouter.put("/settings", updateSettings);
friendsRouter.post("/requests", sendRequest);
friendsRouter.post("/requests/:id/accept", acceptRequest);
// Declines a pending request or removes an accepted friend.
friendsRouter.delete("/:id", removeFriendship);
