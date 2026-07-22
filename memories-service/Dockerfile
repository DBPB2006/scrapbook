FROM node:18-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY memories_server.js ./
# Volumes for data and uploads will be mounted at runtime

EXPOSE 3002

CMD [ "node", "memories_server.js" ]
