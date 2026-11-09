FROM node:20-alpine

WORKDIR /usr/src/app

ENV NODE_ENV=production

COPY memories-service/package*.json ./
RUN npm install --omit=dev

COPY memories-service/ ./
COPY shared/ ./shared/

EXPOSE 3002

CMD ["node", "memories_server.js"]
