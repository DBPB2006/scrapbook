FROM node:20-alpine

WORKDIR /usr/src/app

COPY sharing-service/package*.json ./
RUN npm ci --omit=dev

COPY sharing-service/ ./
COPY shared/ ./shared/

EXPOSE 3004

CMD ["node", "sharing_server.js"]
