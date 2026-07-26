FROM node:18-alpine

WORKDIR /usr/src/app

ENV NODE_ENV=production
COPY memories-service/package*.json ./
RUN npm install

COPY memories-service/memories_server.js memories-service/memories_common_functions.js ./
COPY shared/s3_storage.js shared/metrics.js ./shared/
# Volumes for data and uploads will be mounted at runtime

EXPOSE 3002

CMD [ "node", "memories_server.js" ]
