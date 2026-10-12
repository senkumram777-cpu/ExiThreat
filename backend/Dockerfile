FROM node:20-alpine AS builder
# Prisma's engines need OpenSSL, which the alpine image does not ship.
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
# Prisma's engines need OpenSSL, which the alpine image does not ship.
# The first-look strip (services/imageService.ts) is text drawn with the system's fonts, and
# alpine ships none: DejaVu covers Latin text, Noto covers Tamil and Devanagari.
RUN apk add --no-cache openssl fontconfig font-dejavu font-noto-tamil font-noto-devanagari \
    && fc-cache -f
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
# The Prisma CLI (a dev dependency) is needed at start-up to apply the migrations.
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY prisma ./prisma
COPY scripts ./scripts
EXPOSE 4000
# Applies the migrations in prisma/migrations, then starts the API (see scripts/start.js).
CMD ["node", "scripts/start.js"]
