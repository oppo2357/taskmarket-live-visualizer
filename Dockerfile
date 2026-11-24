# Taskmarket live market visualizer: one container, no other services.
#
#   docker build -t taskmarket-visualizer .
#   docker run -p 8080:8080 taskmarket-visualizer
#   (Optional: pass -e SITE_URL=https://<public-host> to point canonical and OG URLs at a custom HTTPS domain.)
#
# On start the server fetches the public Taskmarket API, builds the static
# site, serves it from memory and rebuilds every hour (REFRESH_INTERVAL_MS).
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=8080 \
    REFRESH_INTERVAL_MS=3600000

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .
# The server writes dist/ and .cache/ at run time.
RUN mkdir -p dist .cache && chown -R node:node /app
USER node

EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s --start-period=120s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
