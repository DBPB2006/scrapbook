FROM node:20-alpine

WORKDIR /usr/src/app

ENV NODE_ENV=production

COPY sharing-service/package*.json ./
RUN npm install --omit=dev

COPY sharing-service/ ./
COPY shared/ ./shared/

EXPOSE 3004

CMD ["node", "sharing_server.js"]
