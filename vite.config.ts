import { defineConfig } from "vite";
import { createObservationFeed, serveObservationRequest } from "./scripts/observations.ts";
import { createBuoyHistoryFeed, serveBuoyHistoryRequest } from "./scripts/buoy-history.ts";

export default defineConfig({
  plugins: [{
    name: "aer-observations",
    configureServer(server) {
      const feed = createObservationFeed();
      const history = createBuoyHistoryFeed();
      server.middlewares.use("/api/observations", (request, response) => { void serveObservationRequest(request, response, feed); });
      server.middlewares.use("/api/buoy-history", (request, response) => { void serveBuoyHistoryRequest(request, response, history); });
    },
  }],
});
