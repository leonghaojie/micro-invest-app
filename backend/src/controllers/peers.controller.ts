import { Request, Response } from "express";
import { peerBenchmarkService } from "../services/peerBenchmark.service";
import { peerGroupingService } from "../services/peerGrouping.service";

export async function getSummary(req: Request, res: Response): Promise<void> {
  const group = await peerGroupingService.assignPeerGroup(req.userId!);
  const stats = await peerBenchmarkService.computePeerGroupStats(group);
  res.status(501).json({ error: "Not implemented yet", todo: "Phase 5 — FR09/FR10/FR11", group, stats });
}

export async function getDistribution(req: Request, res: Response): Promise<void> {
  const result = await peerBenchmarkService.computePeerGroupStats(
    await peerGroupingService.assignPeerGroup(req.userId!)
  );
  res.status(501).json({ error: "Not implemented yet", todo: "Phase 5 — FR10/FR11", result });
}
