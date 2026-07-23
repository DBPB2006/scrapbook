FROM node:18-alpine
WORKDIR /usr/src/app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3005
CMD [ "node", "ds_server.js" ]
