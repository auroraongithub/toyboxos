# toybox sync server + app in one image.
#   docker compose up -d
#   docker compose exec toybox python3 server.py pair     (a pairing code for a new device)
# Data, token and uploads live in the /data volume.
FROM node:20-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
ARG SOS_PACK=default
RUN SOS_PACK=$SOS_PACK node build.mjs

FROM python:3.12-slim
WORKDIR /app
COPY server/*.py server/providers.json ./
RUN rm -f test_*.py
COPY --from=build /src/dist ./www
ENV SOS_HOST=0.0.0.0 SOS_PORT=8787 SOS_DB=/data/sos.db SOS_FILES=/data/files SOS_TOKEN_FILE=/data/token.txt SOS_AI_CFG=/data/ai.json SOS_SECRETS=/data/secrets.json PYTHONUNBUFFERED=1
VOLUME /data
EXPOSE 8787
# toybox_server.py restarts the server after a self-update (new code lands in /data/code)
CMD ["python3", "toybox_server.py", "--quiet", "--data", "/data"]
