FROM node:20-alpine

WORKDIR /usr/src/app

RUN npm i -g npm@10.9.9

COPY memories-service/package*.json ./
RUN npm i

COPY memories-service/ ./
COPY shared/ ./shared/

EXPOSE 3002

CMD ["node", "memories_server.js"]
