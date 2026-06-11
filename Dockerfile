FROM node:20-alpine

WORKDIR /workspace/orchestrator

COPY package.json package-lock.json ./
RUN npm ci

COPY src/ ./src/

EXPOSE 4242

CMD ["node", "node_modules/.bin/tsx", "src/dashboard.ts"]
