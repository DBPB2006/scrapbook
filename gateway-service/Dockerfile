FROM node:18-alpine

WORKDIR /usr/src/app

ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev

COPY gateway_server.js ./
# We don't copy pages or uploads here, they will be mounted via docker-compose

EXPOSE 3090

CMD [ "node", "gateway_server.js" ]
