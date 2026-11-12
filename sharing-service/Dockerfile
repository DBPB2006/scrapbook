FROM node:20-alpine

WORKDIR /usr/src/app

RUN npm i -g npm@10.9.9

COPY sharing-service/package*.json ./
RUN npm i

COPY sharing-service/ ./
COPY shared/ ./shared/

EXPOSE 3004

CMD ["node", "sharing_server.js"]
