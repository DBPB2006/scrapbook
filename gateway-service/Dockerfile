FROM node:18-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY gateway_server.js ./
# We don't copy pages or uploads here, they will be mounted via docker-compose

EXPOSE 3090

CMD [ "node", "gateway_server.js" ]
