# Project Tracker

An executive dashboard for projects, tasks, deadlines and team workload.

| Folder | What it is |
|---|---|
| `frontend/` | Next.js 16 / React 19 / Tailwind 4 app |
| `backend/` | Django 5 + Django REST Framework API, SQLite (`backend/db.sqlite3`) |
| `empty.txt` | Frontend audit and backend specification (fields, rules, endpoints, test results, open decisions) |

The two apps run separately. The frontend talks to the backend only through the REST API under `/api/v1/`.

## Run the backend (http://127.0.0.1:8000)

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # optional for local development
python manage.py migrate        # creates backend/db.sqlite3
python manage.py runserver
```

`python manage.py ...` runs in **development** mode (debug on, localhost only, CORS for `localhost:3000`).
Anything else that loads the settings (gunicorn, uvicorn, wsgi/asgi) runs in **production** mode and
**refuses to start** unless `DJANGO_SECRET_KEY` (random, 50+ characters), `DJANGO_ALLOWED_HOSTS`,
`CORS_ALLOWED_ORIGINS` (https only) and `DJANGO_ACKNOWLEDGE_NO_AUTH=true` are set. See `backend/.env.example`.
`DJANGO_TIME_ZONE` (default `Asia/Kolkata`) decides what "today" means for overdue / due-today logic; the frontend
follows the server's time zone, not the browser's.

Tests (they use a throw-away test database, never `db.sqlite3`):

```bash
cd backend
python manage.py test
DJANGO_ENV=production python manage.py check --deploy   # set the production variables first (see .env.example)
```

The database starts empty. Add people first (Team tab), then projects and tasks.

## Run the frontend (http://localhost:3000)

```bash
cd frontend
cp .env.local.example .env.local   # NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000/api/v1
npm ci
npm run dev
```

`NEXT_PUBLIC_API_BASE_URL` is read at build time, so set it before `npm run build` too.
Start the backend first; the dashboard shows an error with a Retry button when the API is unreachable.
Other commands: `npm run lint`, `npx tsc --noEmit`, `npm test` (Node's built-in test runner, no extra packages), `npm run build`.

## API overview

All endpoints are under `/api/v1/`: `members/`, `projects/` (with `history/`, `tasks/`, `members/`, `objectives/`, `decision/`;
`?detail=1` on the list), `tasks/` (with `complete/`), `dashboard/*`, `today/`, `weekly-brief/`, `activity/`.
Errors are JSON: `{"error": {"code", "message", "fields"}}`. A URL that only lacks its trailing slash is redirected with `308`.
The full endpoint, field and validation reference is in `empty.txt`.

## Security status

There is **no login yet**: every endpoint is open, including delete. Run it on a trusted network only. A proposed
authentication and role design is documented in `empty.txt` (Part D) and needs approval before it is built.
