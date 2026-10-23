import { createAlertRuntime } from "./scripts/alerts/runtime.ts";
import { defineConfig } from "vite";
import { createObservationFeed, serveObservationRequest } from "./scripts/observations.ts";
import { createBuoyHistoryFeed, serveBuoyHistoryRequest } from "./scripts/buoy-history.ts";

export default defineConfig({
  plugins: [{
    name: "aer-observations",
    configureServer(server) {
      const alerts = createAlertRuntime();
      server.httpServer?.once("close", () => { void alerts.stop(); });
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
});
