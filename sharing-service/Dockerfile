FROM node:18-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY sharing_server.js ./
# Volumes for data and uploads will be mounted at runtime

EXPOSE 3004

CMD [ "node", "sharing_server.js" ]
