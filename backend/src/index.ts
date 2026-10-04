import { createApp } from "./app";
import { env } from "./config/env";
import { startFundDataScheduler } from "./jobs/fundDataScheduler";
import { fetchWithPython } from "./jobs/pythonFetcher";
import { runFundDataUpdate } from "./services/fundDataUpdate.service";

const app = createApp();

app.listen(env.port, () => {
  console.log(`[micro-invest-backend] listening on port ${env.port}`);
});

// DECISIONS.md #15: keep the fund history current without anyone running scripts. It sleeps
// until the start of each month (no polling) and logs when it will next wake.
if (env.fundDataAutoUpdate) {
  startFundDataScheduler({ run: () => runFundDataUpdate({ fetchRaw: () => fetchWithPython() }) });
  console.log("[fund-data] automatic update on: one catch-up check at startup, then once at the start of each month.");
}
