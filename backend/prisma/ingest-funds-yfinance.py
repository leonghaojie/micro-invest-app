"""
Live ingestion tool, step 1 of 2 — pulls real historical monthly OHLC +
dividends via yfinance (unofficial Yahoo Finance wrapper, no API key) for
the fund catalog and writes one raw JSON file per ticker to ./yfinance-data/.

DECISIONS.md #1 third amendment (25 Aug 2026): yfinance is the first data
source in this project's history to actually cover the SGX-listed funds
(A35/CFA/ES3/G3B) with real prices and dividends — confirmed live against
Alpha Vantage and EODHD first, both of which have zero SGX coverage (see
DECISIONS.md for the citation trail). This script does the network fetch;
`ingest-funds-yfinance.ts` reads its output and upserts Fund +
FundMonthlyReturn via Prisma (kept as a second step, in TS, so the actual
DB write stays Prisma-only rather than adding a second Postgres client in
Python).

Usage: python ingest-funds-yfinance.py
Requires: pip install yfinance
"""
import json
import os

import yfinance as yf

OUT_DIR = os.path.join(os.path.dirname(__file__), "yfinance-data")
os.makedirs(OUT_DIR, exist_ok=True)

# ticker, exchange code (matches Fund.exchange), name, assetClass, currency.
# SGX three are the funds this project has always tracked (POSB
# Invest-Saver counter list); G3B added as a second STI-tracker option;
# SPY/AGG/VWO/GLD are the existing US catalog (prisma/seed.ts history).
CATALOG = [
    ("A35.SI", "SGX", "ABF Singapore Bond Index Fund ETF", "BOND", "SGD"),
    ("CFA.SI", "SGX", "Amova/NikkoAM-StraitsTrading Asia ex Japan REIT ETF", "REIT", "SGD"),
    ("ES3.SI", "SGX", "SPDR Straits Times Index ETF", "EQUITY", "SGD"),
    ("G3B.SI", "SGX", "Nikko AM Singapore STI ETF", "EQUITY", "SGD"),
    ("SPY", "US", "SPDR S&P 500 ETF Trust", "EQUITY", "USD"),
    ("AGG", "US", "iShares Core U.S. Aggregate Bond ETF", "BOND", "USD"),
    ("VWO", "US", "Vanguard FTSE Emerging Markets ETF", "EQUITY_EM", "USD"),
    ("GLD", "US", "SPDR Gold Shares", "COMMODITY", "USD"),
]


def main():
    manifest = []
    for symbol, exchange, name, asset_class, currency in CATALOG:
        print(f"[fetch] {symbol}... ", end="", flush=True)
        try:
            hist = yf.Ticker(symbol).history(period="max", interval="1mo", auto_adjust=False)
            if hist.empty:
                print("EMPTY (no data returned)")
                continue

            rows = []
            for idx, row in hist.iterrows():
                close = row["Close"]
                if close != close:  # NaN guard (pandas NaN != NaN)
                    continue
                rows.append(
                    {
                        "date": str(idx.date()),
                        "close": float(close),
                        "dividends": float(row["Dividends"]) if "Dividends" in row and row["Dividends"] == row["Dividends"] else 0.0,
                    }
                )

            out_path = os.path.join(OUT_DIR, f"{symbol}.json")
            with open(out_path, "w") as f:
                json.dump(
                    {
                        "symbol": symbol,
                        "exchange": exchange,
                        "name": name,
                        "assetClass": asset_class,
                        "currency": currency,
                        "rows": rows,
                    },
                    f,
                    indent=2,
                )
            manifest.append(symbol)
            print(f"OK: {len(rows)} months, {rows[0]['date']} .. {rows[-1]['date']}")
        except Exception as e:
            print(f"FAILED: {e}")

    with open(os.path.join(OUT_DIR, "_manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"[done] {len(manifest)}/{len(CATALOG)} tickers written to {OUT_DIR}")


if __name__ == "__main__":
    main()
