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

DECISIONS.md #29: the funds are priced in Singapore dollars. Funds listed in US dollars are
converted when they are loaded, so this step also fetches the monthly USD/SGD rate
(Yahoo's "SGD=X", Singapore dollars per US dollar) and writes it to _fx.json.

Usage: python ingest-funds-yfinance.py
Requires: pip install yfinance
"""
import json
import os

import yfinance as yf

OUT_DIR = os.path.join(os.path.dirname(__file__), "yfinance-data")
os.makedirs(OUT_DIR, exist_ok=True)

# The fund catalog lives in fund-catalog.json (next to this file) so the preset portfolios,
# their tests and this fetch all read one list: symbol, exchange code (matches
# Fund.exchange), name, assetClass, currency. To add a fund, add it there; the next
# `npm run update-fund-data -- --force` fetches it (DECISIONS.md #16).
with open(os.path.join(os.path.dirname(__file__), "fund-catalog.json"), encoding="utf-8") as _f:
    CATALOG = [(c["symbol"], c["exchange"], c["name"], c["assetClass"], c["currency"]) for c in json.load(_f)]


# Singapore dollars per one US dollar (DECISIONS.md #29).
FX_SYMBOL = "SGD=X"


def fetch_fx():
    """Monthly USD/SGD closes, one raw file next to the fund files. Returns False if there are none."""
    print(f"[fetch] {FX_SYMBOL} (USD to SGD)... ", end="", flush=True)
    try:
        hist = yf.Ticker(FX_SYMBOL).history(period="max", interval="1mo", auto_adjust=False)
        rows = []
        for idx, row in hist.iterrows():
            close = row["Close"]
            if close != close or close <= 0:
                continue
            rows.append({"date": str(idx.date()), "close": float(close)})
        if not rows:
            print("EMPTY (no data returned)")
            return False
        with open(os.path.join(OUT_DIR, "_fx.json"), "w") as f:
            json.dump({"pair": "USDSGD", "symbol": FX_SYMBOL, "rows": rows}, f, indent=2)
        print(f"OK: {len(rows)} months, {rows[0]['date']} .. {rows[-1]['date']}")
        return True
    except Exception as e:
        print(f"FAILED: {e}")
        return False


def main():
    # Without the exchange rate a US-listed fund cannot be converted, so stop before writing anything half-done.
    if not fetch_fx():
        raise SystemExit("could not fetch the USD/SGD exchange rate")
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
