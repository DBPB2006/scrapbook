FROM node:20-alpine

WORKDIR /usr/src/app

COPY social-service/package.json ./
RUN npm install

COPY social-service/ ./
COPY shared/ ./shared/

EXPOSE 3003

CMD ["node", "social_server.js"]
