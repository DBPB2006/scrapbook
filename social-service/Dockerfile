FROM node:20-alpine

WORKDIR /usr/src/app

ENV NODE_ENV=production

COPY social-service/package*.json ./
RUN npm ci --omit=dev

COPY social-service/ ./
COPY shared/ ./shared/

EXPOSE 3003

CMD ["node", "social_server.js"]
