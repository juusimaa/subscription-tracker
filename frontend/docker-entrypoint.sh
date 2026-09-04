#!/bin/sh
# Renders config.template.js into a real config.js using whatever API_URL is
# set on the container (an Azure Container Apps env var, in production), then
# hands off to nginx. Doing this at container start rather than image build
# time is what lets one image serve any environment -- see
# config.template.js and PLAN.md milestone 8.
set -e

# Restricting envsubst to just this one variable (rather than calling it with
# no argument) stops it from also touching any literal "$" nginx itself might
# care about elsewhere -- not a risk here, but cheap to be explicit.
envsubst '${API_URL}' < /etc/nginx/config.template.js > /usr/share/nginx/html/config.js

exec nginx -g "daemon off;"
