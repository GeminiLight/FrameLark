ARG NODE_IMAGE=node:24-alpine
FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3177
COPY --chown=node:node package.json server.mjs vision-service.mjs codex-app-server.mjs project-bridge.mjs project-routes.mjs photo-tool-service.mjs series-review.mjs ./
COPY --chown=node:node public/ ./public/
COPY --chown=node:node api/ ./api/
RUN mkdir -p /app/.guangjian && chown node:node /app/.guangjian
USER node
EXPOSE 3177
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3177)+'/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
