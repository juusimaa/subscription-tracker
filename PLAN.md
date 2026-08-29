# Subscription Tracker — Project Plan

A learning project to get hands-on with **Docker**, **PostgreSQL**, and a **CI/CD pipeline to Azure**, by building a simple app that tracks recurring subscriptions (Netflix, HBO, etc.).

## Stack

- **Backend:** Python + FastAPI + SQLAlchemy, talking to Postgres
- **Frontend:** React (Vite), calling the API
- **Database:** PostgreSQL
- **Containers:** 3 total — `frontend`, `backend`, `db`

## Data model (minimal to start)

- `subscriptions` table:
  - name (Netflix, HBO, ...)
  - cost
  - billing cycle (monthly/yearly)
  - next renewal date
  - category
  - active / cancelled
- Later, optional: `payment_history` table to track past charges

## Folder structure

```
docker-subscription-tracker/
├── backend/
│   ├── app/            # FastAPI app, models, routes
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml   # local dev: frontend + backend + postgres
├── .github/workflows/
│   └── build-and-push.yml
└── README.md
```

## Milestones

1. **Backend first, no Docker yet** — FastAPI + Postgres running locally, CRUD endpoints for subscriptions (list/add/edit/delete, maybe a "total monthly spend" endpoint). This is where the Postgres basics get learned.
2. **Dockerize the backend** — Dockerfile, connect to a Postgres container via Compose, use env vars for the connection string, add a named volume so data persists across restarts.
3. **Build the frontend** — simple React UI (list subscriptions, add/edit form, total cost summary), Dockerized as its own container, calling the backend API.
4. **docker-compose.yml** ties all three together for local dev (`docker compose up`).
5. **GitHub Actions** — on push, build both images, push to GitHub Container Registry.
6. **Deploy to Azure Container Apps** — backend + frontend as two container apps. Postgres either via Azure Database for PostgreSQL (flexible server) or kept in a container to stay fully free.

## Notes / rationale

- Doing step 1 without Docker first avoids debugging Docker networking and SQL at the same time — Postgres + FastAPI get learned locally before containers are introduced.
- Frontend and backend are separate containers (rather than one combined container) to get more realistic multi-container Docker Compose practice.
