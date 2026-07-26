FROM node:18-alpine
WORKDIR /usr/src/app
ENV NODE_ENV=production
COPY ds-service/package*.json ./
RUN npm install
COPY shared/metrics.js ./shared/
COPY ds-service/ .
EXPOSE 3005
CMD [ "node", "ds_server.js" ]
