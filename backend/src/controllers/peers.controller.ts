import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { parsePeerDimensions, peerGroupingService } from "../services/peerGrouping.service";
import { peerCohortService } from "../services/peerCohort.service";
import { PEER_METRICS, peerInsightsService } from "../services/peerInsights.service";

const dashboardQuerySchema = z.object({
  dims: z.string().optional(),
  metric: z.enum(PEER_METRICS).default("value"),
});

// DECISIONS.md #9: the richer, segment-aware peer dashboard. Aggregates
// only. (The older income-band /peers/summary and /peers/distribution were removed
// with DECISIONS.md #32.)
export async function getDashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.userId!;
    const { dims, metric } = dashboardQuerySchema.parse(req.query);
    const group = await peerGroupingService.resolveSegment(userId, parsePeerDimensions(dims));
    res.status(200).json(await peerInsightsService.getDashboard(userId, group, metric));
  } catch (err) {
    next(err);
  }
}

// DECISIONS.md #18: the default peer comparison - a cohort chosen by weighted nearest
// neighbours, one peer set per metric. Aggregates only.
export async function getCohort(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await peerCohortService.getCohort(req.userId!));
  } catch (err) {
    next(err);
  }
}
