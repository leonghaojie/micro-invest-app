/**
 * DashboardService — FR08. NFR-01: dashboard responses must support <2s load.
 * Implementation lands in Phase 4.
 */
class DashboardService {
  async getSummary(_userId: string): Promise<{ implemented: false }> {
    return { implemented: false };
  }

  async getGrowth(_userId: string): Promise<{ implemented: false }> {
    return { implemented: false };
  }

  async getBehaviour(_userId: string): Promise<{ implemented: false }> {
    // TODO Phase 4: ConsistencyScore = (months with >=1 simulation run) /
    // (months since first simulation run) * 100. Cold-start (1 run) = 100.
    return { implemented: false };
  }
}

export const dashboardService = new DashboardService();
