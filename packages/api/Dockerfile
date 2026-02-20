FROM node:20-alpine AS base
WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/

RUN npm install --workspace=packages/api --workspace=packages/shared

COPY packages/shared/ packages/shared/
COPY packages/api/ packages/api/

EXPOSE 3000
CMD ["npm", "-w", "packages/api", "run", "dev"]
