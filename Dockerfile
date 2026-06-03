FROM node:22-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY ./wildcards.json ./wildcards.json
COPY ./interactions.json ./interactions.json
COPY ./qotd-questions.json ./qotd-questions.json

CMD ["node", "dist/bot.js"]
