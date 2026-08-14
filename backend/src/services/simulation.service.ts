/**
 * SimulationService — FR05, FR06, FR07, FR13.
 *
 * SRS §2.5 (locked v1.1): deterministic fixed-rate compounding —
 *   balance[n] = (balance[n-1] + contributionAmount) * (1 + periodicRate)
 * No stochastic/volatility modelling in the MVP (satisfies NFR-04 by
 * construction — identical inputs always produce identical output).
 *
 * Implementation + test suite lands in Phase 4 (roadmap.md); this is a
 * strong equivalence-class/boundary-value black-box test target for Lab #4.
 */
export interface RunSimulationInput {
  templateId: string;
  frequency: "WEEKLY" | "MONTHLY";
  contributionAmount: number;
  durationMonths: number;
}

class SimulationService {
  async run(_userId: string, _input: RunSimulationInput): Promise<{ implemented: false }> {
    return { implemented: false };
  }

  async getHistory(_userId: string): Promise<{ implemented: false }> {
    return { implemented: false };
  }
}

export const simulationService = new SimulationService();
