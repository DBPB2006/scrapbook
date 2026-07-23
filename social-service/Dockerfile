FROM node:18-alpine

WORKDIR /usr/src/app

ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev

COPY social_server.js ./
# Volumes for data and uploads will be mounted at runtime

EXPOSE 3003

CMD [ "node", "social_server.js" ]
