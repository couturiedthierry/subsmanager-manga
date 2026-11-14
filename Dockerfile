FROM node:22-alpine
RUN apk add --no-cache openssl
RUN corepack enable

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm run build:production

CMD ["sh", "-c", "pnpm run setup:production && pnpm run start"]
