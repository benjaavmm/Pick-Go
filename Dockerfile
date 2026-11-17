# Imagen para correr Altiro en cualquier servicio que acepte contenedores.
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production ALTIRO_DB=/data/altiro.db PORT=3001
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/package.json ./
# La base de datos y sus respaldos viven en /data: monta ahí un volumen persistente.
# Si el volumen ya tiene la base de antes del cambio de nombre (pickgo.db), se sigue usando esa.
VOLUME /data
EXPOSE 3001
USER node
CMD ["node", "server/index.js"]
