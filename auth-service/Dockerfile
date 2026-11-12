FROM node:20-alpine

WORKDIR /usr/src/app

COPY auth-service/package*.json ./
RUN npm ci --omit=dev

COPY auth-service/ ./
COPY shared/ ./shared/

EXPOSE 3001

CMD ["node", "auth_server.js"]
