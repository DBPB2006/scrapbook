FROM node:20-alpine

WORKDIR /usr/src/app

RUN npm i -g npm@10.9.9

COPY auth-service/package*.json ./
RUN npm i

COPY auth-service/ ./
COPY shared/ ./shared/

EXPOSE 3001

CMD ["node", "auth_server.js"]
