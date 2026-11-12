FROM node:20-alpine

WORKDIR /usr/src/app

COPY gateway-service/package*.json ./
RUN npm ci --omit=dev

COPY gateway-service/ ./
COPY shared/ ./shared/

EXPOSE 3090

CMD ["node", "gateway_server.js"]
