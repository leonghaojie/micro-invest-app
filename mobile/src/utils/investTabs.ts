/** The three views of the Invest tab (DECISIONS.md #30). */
export type InvestTab = "managed" | "discover" | "custom";

export const INVEST_TABS: { value: InvestTab; label: string }[] = [
  { value: "managed", label: "Managed" },
  { value: "discover", label: "Discover" },
  { value: "custom", label: "Custom" },
];
