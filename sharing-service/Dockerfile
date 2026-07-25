FROM node:18-alpine

WORKDIR /usr/src/app

ENV NODE_ENV=production
COPY sharing-service/package*.json ./
RUN npm install

COPY sharing-service/sharing_server.js sharing-service/sharing_common_functions.js ./
COPY shared/s3_storage.js ../shared/
# Volumes for data and uploads will be mounted at runtime

EXPOSE 3004

CMD [ "node", "sharing_server.js" ]
