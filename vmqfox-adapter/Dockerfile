FROM node:20-alpine

WORKDIR /app

# better-sqlite3 needs build toolchain
RUN apk add --no-cache python3 make g++ \
 && ln -sf python3 /usr/bin/python

COPY package.json ./
RUN npm install --omit=dev

COPY *.js ./

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8888

CMD ["node", "index.js"]
