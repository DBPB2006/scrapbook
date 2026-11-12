FROM node:20-alpine

WORKDIR /usr/src/app

COPY memories-service/package*.json ./
RUN npm ci --omit=dev

COPY memories-service/ ./
COPY shared/ ./shared/

EXPOSE 3002

CMD ["node", "memories_server.js"]
