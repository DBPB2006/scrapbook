FROM node:20-alpine

WORKDIR /usr/src/app

RUN npm i -g npm@10.9.9

COPY gateway-service/package*.json ./
RUN npm i

COPY gateway-service/ ./
COPY shared/ ./shared/

EXPOSE 3090

CMD ["node", "gateway_server.js"]
