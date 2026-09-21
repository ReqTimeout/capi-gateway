# CAPI Gateway — image untuk Coolify (project agency-beriklan)
FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4333
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev 2>/dev/null; echo "no deps"
COPY src/ ./src/
EXPOSE 4333
CMD ["node", "src/server.mjs"]
