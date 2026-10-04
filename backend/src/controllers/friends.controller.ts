import { NextFunction, Request, Response } from "express";
import { friendsService } from "../services/friends.service";

export async function getOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await friendsService.getOverview(req.userId!));
  } catch (err) {
    next(err);
  }
}

export async function updateSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await friendsService.updateSettings(req.userId!, req.body));
  } catch (err) {
    next(err);
  }
}

// 202 Accepted, same body every time — see friends.service.ts (the response
// must not reveal whether the target exists).
export async function sendRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(202).json(await friendsService.sendRequest(req.userId!, req.body));
  } catch (err) {
    next(err);
  }
}

export async function acceptRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await friendsService.acceptRequest(req.userId!, req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function removeFriendship(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await friendsService.removeFriendship(req.userId!, req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function getComparison(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await friendsService.getComparison(req.userId!));
  } catch (err) {
    next(err);
  }
}

export async function getHoldings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await friendsService.getHoldings(req.userId!));
  } catch (err) {
    next(err);
  }
}

export async function getHoldingsDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await friendsService.getHoldingsDetail(req.userId!, req.params.id));
  } catch (err) {
    next(err);
  }
}
