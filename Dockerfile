FROM node:22-slim
WORKDIR /app
RUN corepack enable
ADD package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --no-cache --prod
ENV NODE_ENV="production"
ADD . .
CMD [ "node", "./dist/main.js" ]
