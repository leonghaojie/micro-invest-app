/**
 * PortfolioService — FR04. Reads portfolio_templates (Design Model §4.2).
 */
import { RiskLevel } from "@prisma/client";
import { prisma } from "../config/prisma";

export interface PortfolioTemplateResult {
  id: string;
  name: string;
  riskLevel: RiskLevel;
  expectedReturn: number;
}

class PortfolioService {
  async listTemplates(): Promise<PortfolioTemplateResult[]> {
    const templates = await prisma.portfolioTemplate.findMany({ orderBy: { expectedReturn: "asc" } });
    return templates.map((template) => ({
      id: template.id,
      name: template.name,
      riskLevel: template.riskLevel,
      expectedReturn: Number(template.expectedReturn),
    }));
  }
}

export const portfolioService = new PortfolioService();
