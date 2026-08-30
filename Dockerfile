FROM node:24-slim

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public

ENV PORT=8787
ENV DATA_DIR=/data
EXPOSE 8787
VOLUME ["/data"]

CMD ["node", "src/server.mjs"]
