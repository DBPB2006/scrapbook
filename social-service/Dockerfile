FROM node:20-alpine

WORKDIR /usr/src/app

RUN npm i -g npm@10.9.9

COPY social-service/package*.json ./
RUN npm i

COPY social-service/ ./
COPY shared/ ./shared/

EXPOSE 3003

CMD ["node", "social_server.js"]
