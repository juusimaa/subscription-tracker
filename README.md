# Subscription Tracker

A small app for tracking recurring subscriptions (Netflix, HBO, etc.), built as a learning project for Docker, PostgreSQL, and CI/CD to Azure. See [PLAN.md](PLAN.md) for the full project plan.

## Stack

- **Backend:** FastAPI + SQLAlchemy
- **Frontend:** React (Vite)
- **Database:** PostgreSQL
- Three containers (`db`, `backend`, `frontend`), orchestrated with Docker Compose for local dev.

## Running locally

1. Copy the example env file:

   ```
   cp .env.example .env
   ```

2. Start everything:

   ```
   docker compose up --build
   ```

3. Open:
   - Frontend: http://localhost:5173
   - Backend API docs: http://localhost:8000/docs

Data persists across restarts in a named Docker volume (`db_data`). To reset the database entirely:

```
docker compose down -v
```

## Project layout

```
backend/    # FastAPI app
frontend/   # React (Vite) app
docker-compose.yml
```
