FROM node:18-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY auth_server.js ./
# Volumes for data and uploads will be mounted at runtime

EXPOSE 3001

CMD [ "node", "auth_server.js" ]
