import { NextFunction, Request, Response } from "express";
import { peerBenchmarkService } from "../services/peerBenchmark.service";
import { describeTier, peerGroupingService } from "../services/peerGrouping.service";

export async function getSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId!;
    const group = await peerGroupingService.assignPeerGroup(userId);
    const [stats, myMetrics] = await Promise.all([
      peerBenchmarkService.computeStats(userId, group),
      peerBenchmarkService.getMyMetrics(userId),
    ]);

    res.status(200).json({
      bandPct: group.bandPct,
      memberCount: stats.memberCount,
      message: describeTier(group),
      value: { userValue: myMetrics.finalValue, ...stats.value },
      savingsRatePct: { userValue: myMetrics.savingsRatePct, ...stats.savingsRatePct },
      emergencyBuffer: { userValue: myMetrics.emergencyBuffer, ...stats.emergencyBuffer },
    });
  } catch (err) {
    next(err);
  }
}

export async function getDistribution(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId!;
    const group = await peerGroupingService.assignPeerGroup(userId);
    const stats = await peerBenchmarkService.computeStats(userId, group);
    res.status(200).json({ bandPct: group.bandPct, ...stats });
  } catch (err) {
    next(err);
  }
}
