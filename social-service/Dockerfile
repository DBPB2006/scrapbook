FROM node:18-alpine

WORKDIR /usr/src/app

ENV NODE_ENV=production
COPY social-service/package*.json ./
RUN npm install

COPY social-service/social_server.js ./
COPY shared/s3_storage.js shared/metrics.js ./shared/
# Volumes for data and uploads will be mounted at runtime

EXPOSE 3003

CMD [ "node", "social_server.js" ]
