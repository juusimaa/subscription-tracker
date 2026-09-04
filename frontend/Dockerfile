# Multi-stage build: two separate images are defined in this one file.
# Only the final stage ends up in the image you actually run (unless a
# specific stage is targeted, as docker-compose.yml does for local dev).

# --- build stage: compiles the React app into static HTML/CSS/JS ---
FROM node:22-slim AS build
WORKDIR /app
# Copying package*.json before the rest of the source lets Docker cache the
# `npm ci` layer -- it only reruns when dependencies actually change.
COPY package*.json ./
RUN npm ci
COPY . .
# Outputs static files to /app/dist. Node itself is only needed to build
# them; it isn't needed to serve them, which is why there's a second stage.
RUN npm run build

# --- production stage: serve the built static files with Nginx ---
# Nginx is a lightweight web server -- far smaller and simpler than shipping
# Node just to serve static files. This is the stage actually deployed to
# Azure; local dev instead targets the "build" stage above and runs Vite's
# dev server for hot-reloading (see docker-compose.yml).
FROM nginx:alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
# Template for the runtime API URL, rendered into a real config.js by
# docker-entrypoint.sh on every container start -- see that file and
# config.template.js for why this can't just be baked in here.
COPY config.template.js /etc/nginx/config.template.js
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
EXPOSE 80
ENTRYPOINT ["/docker-entrypoint.sh"]
