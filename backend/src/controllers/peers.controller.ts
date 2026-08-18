import { NextFunction, Request, Response } from "express";
import { peerBenchmarkService } from "../services/peerBenchmark.service";
import { describeTier, peerGroupingService } from "../services/peerGrouping.service";

export async function getSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId!;
    const group = await peerGroupingService.assignPeerGroup(userId);
    const [stats, userValue] = await Promise.all([
      peerBenchmarkService.computePeerGroupStats(group),
      peerBenchmarkService.getLatestFinalValue(userId),
    ]);

    res.status(200).json({
      tier: group.tier,
      riskLevel: group.riskLevel,
      budgetBand: group.budgetBand,
      goalType: group.goalType,
      memberCount: stats.memberCount,
      userValue,
      p25: stats.p25,
      p50: stats.p50,
      p75: stats.p75,
      message: describeTier(group.tier, stats.memberCount),
    });
  } catch (err) {
    next(err);
  }
}

export async function getDistribution(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const group = await peerGroupingService.assignPeerGroup(req.userId!);
    const stats = await peerBenchmarkService.computePeerGroupStats(group);
    res.status(200).json({ tier: group.tier, ...stats });
  } catch (err) {
    next(err);
  }
}
