FROM node:18-alpine

WORKDIR /usr/src/app

ENV NODE_ENV=production
COPY auth-service/package*.json ./
RUN npm install

COPY auth-service/auth_server.js auth-service/auth_common_functions.js ./
COPY shared/s3_storage.js ./shared/
# Volumes for data and uploads will be mounted at runtime

EXPOSE 3001

CMD [ "node", "auth_server.js" ]
