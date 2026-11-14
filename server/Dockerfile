# Étape 1 : Compilation TypeScript & Génération Prisma
FROM node:22-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
COPY server/package*.json ./server/
RUN cd server && npm ci
COPY src ./src
COPY server ./server
RUN cd server && npx prisma generate && npm run build

# Étape 2 : Exécution de production
FROM node:22-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app/server
ENV NODE_ENV=production

# Copie des packages et dépendances requises
COPY --from=builder /app/server/package*.json ./
COPY --from=builder /app/server/node_modules ./node_modules
COPY --from=builder /app/server/prisma ./prisma
COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/src ./src

# Création des répertoires d'upload et permissions non-root
RUN mkdir -p uploads/cv uploads/preuves && chown -R node:node /app
USER node

EXPOSE 4000
CMD ["node", "dist/server/src/index.js"]
