FROM node:20-alpine

WORKDIR /app

# 换成阿里云 alpine 镜像源，否则国内拉 dl-cdn.alpinelinux.org 会超时
# better-sqlite3 需要 python3 + make + g++ 在本地编译
RUN sed -i 's|dl-cdn.alpinelinux.org|mirrors.aliyun.com|g' /etc/apk/repositories \
 && apk add --no-cache python3 make g++ \
 && ln -sf python3 /usr/bin/python

COPY package.json ./
# 换成淘宝 npm 镜像
RUN npm config set registry https://registry.npmmirror.com \
 && npm install --omit=dev

COPY *.js ./

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8888

CMD ["node", "index.js"]
