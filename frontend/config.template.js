// Rendered into /usr/share/nginx/html/config.js by docker-entrypoint.sh at
// container *startup* (via envsubst), not at image build time. This is what
// lets one built image point at whatever backend URL the API_URL env var on
// the Container App says, without a rebuild -- see PLAN.md milestone 8.
// index.html loads this before the app bundle, so window.__API_URL__ is set
// before src/api.js reads it.
window.__API_URL__ = "${API_URL}";
