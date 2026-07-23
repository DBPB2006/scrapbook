FROM node:18-alpine

WORKDIR /usr/src/app

ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev

COPY memories_server.js memories_common_functions.js ./
# Volumes for data and uploads will be mounted at runtime

EXPOSE 3002

CMD [ "node", "memories_server.js" ]
