/**
 * The fund catalog as the Invest tab uses it (DECISIONS.md #30): loading it, and narrowing it by asset
 * class and by a search of ticker or name. Shared by Discover (browse the funds) and Custom (pick funds for
 * your own mix), so both list and filter the same way.
 */
import { useCallback, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { apiFetch, ApiError } from "../api/client";

export interface FundSummary {
  id: string;
  ticker: string;
  name: string;
  assetClass: string;
  exchange: string;
  currency: string;
  monthsAvailable: number;
  earliestMonth: string | null;
  latestMonth: string | null;
  latestMonthlyReturn: number | null;
}

/** Group order for the filter chips. */
export const ASSET_CLASS_ORDER = ["EQUITY", "EQUITY_EM", "BOND", "REIT", "COMMODITY"];

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-09" -> "Sep 2026" */
export function longMonth(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | undefined;
    return body?.error ?? "Something went wrong. Please try again.";
  }
  return "Could not reach the server. Check your connection and try again.";
}

/** Loads the catalog whenever the screen comes into focus. */
export function useFundCatalog() {
  const [funds, setFunds] = useState<FundSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<FundSummary[]>("/portfolio/funds")
      .then((data) => {
        if (!cancelled) setFunds(data);
      })
      .catch((err) => {
        if (!cancelled) setError(describeError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(load);

  // The oldest "latest month" across funds: the month every fund has data to.
  const latestMonths = funds.map((f) => f.latestMonth).filter((m): m is string => m !== null);
  const dataThrough = latestMonths.length > 0 ? longMonth(latestMonths.reduce((min, m) => (m < min ? m : min))) : null;

  return { funds, loading, error, reload: load, dataThrough };
}

/** The search and asset-class filter over a list of funds. */
export function useFundFilter(funds: FundSummary[]) {
  const [assetFilter, setAssetFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const assetClasses = useMemo(() => ASSET_CLASS_ORDER.filter((c) => funds.some((f) => f.assetClass === c)), [funds]);
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return funds.filter(
      (f) => (assetFilter === null || f.assetClass === assetFilter) && (needle === "" || f.ticker.toLowerCase().includes(needle) || f.name.toLowerCase().includes(needle))
    );
  }, [funds, assetFilter, search]);

  return { visible, assetClasses, assetFilter, setAssetFilter, search, setSearch };
}

export type FundFilter = ReturnType<typeof useFundFilter>;
