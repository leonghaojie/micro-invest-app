/**
 * InsightService — FR12 (UC-06). Rule-based insight cards from user-vs-peer
 * gaps, with a positive-reinforcement fallback when no meaningful gap is
 * detected (UC-06 alt flow). Implementation lands in Phase 6.
 */
class InsightService {
  async generate(_userId: string): Promise<{ implemented: false }> {
    return { implemented: false };
  }
}

export const insightService = new InsightService();
