import { defineConfig } from "vite";
import { createObservationFeed, serveObservationRequest } from "./scripts/observations.ts";

export default defineConfig({
  plugins: [{
    name: "aer-observations",
    configureServer(server) {
      const feed = createObservationFeed();
      server.middlewares.use("/api/observations", (request, response) => { void serveObservationRequest(request, response, feed); });
    },
  }],
});
