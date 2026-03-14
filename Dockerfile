FROM node:20-bookworm-slim

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY src ./src
COPY public ./public

RUN mkdir -p /app/data/cache /app/data/output /app/data/builds /app/data/logs /app/data/scripts \
  && chown -R node:node /app

VOLUME ["/app/data"]

EXPOSE 3000

CMD ["node", "src/server.js"]
