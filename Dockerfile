FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts/serve.ts ./scripts/serve.ts
COPY --from=build /app/scripts/observations.ts ./scripts/observations.ts
COPY --from=build /app/scripts/buoy-history.ts ./scripts/buoy-history.ts
COPY --from=build /app/scripts/wave-archive-zip.ts ./scripts/wave-archive-zip.ts
COPY --from=build /app/src/observations.ts ./src/observations.ts
COPY --from=build /app/src/nowphas.ts ./src/nowphas.ts
COPY --from=build /app/src/cwa-wave-history.ts ./src/cwa-wave-history.ts
COPY --from=build /app/src/buoy-history.ts ./src/buoy-history.ts
EXPOSE 3000
CMD ["node", "scripts/serve.ts"]
