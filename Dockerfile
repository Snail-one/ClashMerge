FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY docs ./docs
COPY tests ./tests
COPY scripts ./scripts
COPY AGENTS.md ./AGENTS.md
COPY .gitignore ./.gitignore

RUN mkdir -p /app/data/cache /app/data/output /app/data/builds /app/data/logs /app/data/scripts

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
