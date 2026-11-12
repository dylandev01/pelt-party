FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
# On first checkout npm install generates a lockfile; commit that lock for reproducible deployments.
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY src ./src
COPY public ./public
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
CMD ["node", "src/server.js"]
