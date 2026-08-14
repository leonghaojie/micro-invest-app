/**
 * PortfolioService — FR04. Reads portfolio_templates (Design Model §4.2).
 * Implementation lands in Phase 3.
 */
class PortfolioService {
  async listTemplates(): Promise<{ implemented: false }> {
    return { implemented: false };
  }
}

export const portfolioService = new PortfolioService();
