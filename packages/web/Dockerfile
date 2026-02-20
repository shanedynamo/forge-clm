FROM node:20-alpine AS base
WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/web/package.json packages/web/

RUN npm install --workspace=packages/web

COPY packages/web/ packages/web/

EXPOSE 5173
CMD ["npm", "-w", "packages/web", "run", "dev"]
