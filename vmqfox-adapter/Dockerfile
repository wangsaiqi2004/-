FROM node:20-alpine

WORKDIR /app

COPY package.json ./
# 淘宝 npm 镜像，避免国内访问 registry.npmjs.org 慢
RUN npm config set registry https://registry.npmmirror.com \
 && npm install --omit=dev

COPY *.js ./

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8888

CMD ["node", "index.js"]
