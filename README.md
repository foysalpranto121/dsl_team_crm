# DSL Business Team Operation System (TOS)

A web app for the DSL business team: the Team Operation Sheet (daily activity, weekly KPIs and performance scores), team members and approvals, a dashboard and leaderboard, activity history, and each person's own pipeline tracker.

- **Backend:** Django 5 and Django REST Framework, with JWT sign-in and PostgreSQL.
- **Frontend:** React 19, Vite, Tailwind CSS and React Router.
- **Sign-in:** Google. New accounts wait for admin approval.

For the admin guide (setup, approvals, importing the workbook, deleting and replacing data), see [GUIDE.md](GUIDE.md). For the design and build plan, see [IMPLEMENTATION.md](IMPLEMENTATION.md).

## Run it locally

You need Python 3.13, Node.js, and a running PostgreSQL server with an empty database called `DSLCRM`.

**Backend**

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows; on macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env          # then fill in DB_PASSWORD, GOOGLE_CLIENT_ID and ADMIN_EMAILS
python manage.py migrate
python manage.py runserver      # http://localhost:8000
```

**Frontend**

```bash
cd frontend
npm install
# create frontend/.env with VITE_GOOGLE_CLIENT_ID=<the same Google client ID as the backend>
npm run dev                     # http://localhost:5173
```

The dev server proxies `/api`, `/media` and `/static` to the backend, so open the app at `http://localhost:5173`.

Until `EMAIL_HOST_USER` and `EMAIL_HOST_PASSWORD` are set in `backend/.env`, approval emails are printed in the backend terminal.

## Checks

```bash
cd backend && python manage.py test     # backend test suite
cd frontend && npm run typecheck && npm run build
```

## Project layout

```
backend/
  config/      Django settings and URLs
  accounts/    Google sign-in, JWT, profiles, approvals
  team/        Team sheets, KPIs, calculations, Excel import and export
  tracker/     Each person's private pipeline tracker
  core/        Activity log and announcements
frontend/
  src/pages/   One file per screen
  src/components/, src/api/, src/auth/
logo/          DSL logo source file
Team Operation Sheet - DSL Business Team  .xlsx   The workbook the team sheets are imported from

Old single-page tracker (still needed for migrating old data; see LEGACY_TRACKER.md):
index.html, config.js, supabase-setup.sql, netlify.toml, vercel.json
```
