FROM node:20-alpine

WORKDIR /usr/src/app

ENV NODE_ENV=production

COPY gateway-service/package*.json ./
RUN npm install --omit=dev

COPY gateway-service/ ./
COPY shared/ ./shared/

EXPOSE 3090

CMD ["node", "gateway_server.js"]
