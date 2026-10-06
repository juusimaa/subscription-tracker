#!/bin/sh
# Renders config.template.js into a real config.js, and nginx.conf.template
# into nginx's server config, using whatever API_URL is set on the container
# (an Azure Container Apps env var, in production), then hands off to nginx. Doing this at container start rather than image build
# time is what lets one image serve any environment -- see
# config.template.js and PLAN.md milestone 8.
set -e

# Restricting envsubst to just these variables (rather than calling it with
# no argument) stops it from also touching any literal "$" nginx itself might
# care about elsewhere -- not a risk here, but cheap to be explicit.
envsubst '${API_URL} ${TURNSTILE_SITE_KEY}' < /etc/nginx/config.template.js > /usr/share/nginx/html/config.js
# The server config, so the CSP's connect-src names the same API_URL. Here
# the restriction matters more: any nginx $variable added to that file later
# would otherwise be blanked out.
envsubst '${API_URL}' < /etc/nginx/nginx.conf.template > /etc/nginx/conf.d/default.conf

exec nginx -g "daemon off;"
