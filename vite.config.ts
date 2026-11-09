import { createWaveHistoryRuntime } from "./scripts/wave-history/runtime.ts";
import { createAlertRuntime } from "./scripts/alerts/runtime.ts";
import { createAccountRuntime } from "./scripts/accounts/runtime.ts";
import { defineConfig, loadEnv } from "vite";
import { createObservationFeed, serveObservationRequest } from "./scripts/observations.ts";
import { createBuoyHistoryFeed, serveBuoyHistoryRequest } from "./scripts/buoy-history.ts";

export default defineConfig(({ mode }) => ({
  plugins: [{
    name: "aer-observations",
    configureServer(server) {
      const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
      const accounts = createAccountRuntime(env);
      const alerts = createAlertRuntime(env, accounts);
      const waveHistory = createWaveHistoryRuntime(env, accounts.accountFor);
      server.middlewares.use("/api/wave-history", (request, response) => {
        const original = request.url; request.url = `/api/wave-history${request.url}`;
        void waveHistory.handle(request, response).finally(() => { request.url = original; });
      });
      server.httpServer?.once("close", () => { void Promise.all([alerts.stop(), waveHistory.stop()]).then(() => accounts.stop()); });
      server.middlewares.use("/api/account", (request, response) => {
        const original = request.url;
        request.url = `/api/account${request.url}`;
        void accounts.handle(request, response).finally(() => { request.url = original; });
      });
      server.middlewares.use("/api/telegram", (request, response, next) => {
        const original = request.url;
        request.url = `/api/telegram${request.url}`;
        void alerts.handle(request, response).finally(() => { request.url = original; });
      });
      const feed = createObservationFeed();
      const history = createBuoyHistoryFeed();
      server.middlewares.use("/api/observations", (request, response) => { void serveObservationRequest(request, response, feed); });
      server.middlewares.use("/api/buoy-history", (request, response) => { void serveBuoyHistoryRequest(request, response, history); });
    },
  }],
}));
