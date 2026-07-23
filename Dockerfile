# Dev image: runs the Vite dev server with HMR. Source is bind-mounted (see
# docker-compose.yml) so edits on the host hot-reload inside the container.
FROM node:22-alpine

WORKDIR /app

# Install deps first for layer caching.
COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev"]
