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
COPY --from=build /app/src/observations.ts ./src/observations.ts
EXPOSE 3000
CMD ["node", "scripts/serve.ts"]
