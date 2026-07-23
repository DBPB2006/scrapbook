FROM node:18-alpine

WORKDIR /usr/src/app

ENV NODE_ENV=production
COPY gateway-service/package*.json ./
RUN npm install

COPY gateway-service/gateway_server.js ./
COPY client/ ./pages/

EXPOSE 3090

CMD [ "node", "gateway_server.js" ]
