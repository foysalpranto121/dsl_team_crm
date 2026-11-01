# Putting the system online (free)

Three free services, all set up from your browser:

| Part | Service | Address you'll get |
|---|---|---|
| Database | **Neon** (PostgreSQL) | a connection string |
| API (Django) | **Render** | `https://dsl-tos-api.onrender.com` |
| Website (React) | **Netlify** | `https://dsl-tos.netlify.app` (you pick the name) |

The website forwards `/api` to Render, so people only ever use the Netlify address.
The code is already prepared: `render.yaml` (Render), `frontend/netlify.toml` (Netlify).

Do the steps in order. Wherever you see `dsl-tos` or `dsl-tos-api`, use the names you actually got.

---

## 1. Database: Neon

1. Go to **neon.tech** → sign up with GitHub or Google.
2. **New project**: name `dsl-tos`, Postgres version **17** or newer, region **AWS Asia Pacific (Singapore)**.
3. On the project dashboard press **Connect**. Turn **Connection pooling off**, then copy the connection string.
   It looks like `postgresql://neondb_owner:abc123@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.
   Keep it private: it is the password to your data.

## 2. Copy your data into Neon

This brings everyone's sheets, days, KPIs, trackers, profile photos and backups from this PC.
Run it once, **before** the team starts using the online version (afterwards the online copy is the real one).

```
cd backend
.venv\Scripts\activate
python -X utf8 manage.py dumpdata --natural-foreign --exclude contenttypes --exclude auth.permission --exclude sessions --exclude admin.logentry --exclude token_blacklist -o dsl-data.json

set DATABASE_URL=<the Neon connection string>
python manage.py migrate
python -X utf8 manage.py loaddata dsl-data.json
set DATABASE_URL=
del dsl-data.json
```

"Installed 476 object(s)" (or similar) means it worked. Everyone signs in again afterwards.

## 3. API: Render

1. Go to **render.com** → sign up with **GitHub** and allow access to the `CENTRAL-AI-CRM` repository.
2. **New → Blueprint** → choose the repository. Render reads `render.yaml` and shows one service, `dsl-tos-api` (Free).
3. Fill in the values it asks for:

| Name | Value |
|---|---|
| `DATABASE_URL` | the Neon connection string |
| `FRONTEND_URL` | `https://dsl-tos.netlify.app` (the Netlify name you will choose in step 4) |
| `BACKEND_URL` | the same Netlify address |
| `GOOGLE_CLIENT_ID` | the value from `backend/.env` |
| `ADMIN_EMAILS` | the value from `backend/.env` |
| `BREVO_API_KEY`, `DEFAULT_FROM_EMAIL` | leave empty for now (step 6) |

4. **Apply**. The first build takes 3–5 minutes. When it says **Live**, open `https://dsl-tos-api.onrender.com/api/health/`: it should show `{"ok": true}`.
   Note the exact address at the top of the service page.

## 4. Website: Netlify

1. Go to **app.netlify.com** → sign up with **GitHub**.
2. **Add new site → Import an existing project → GitHub** → choose the repository.
3. Set **Base directory** to `frontend`. Leave build command and publish directory as Netlify fills them (they come from `frontend/netlify.toml`).
4. **Add environment variables**:

| Key | Value |
|---|---|
| `API_URL` | the Render address from step 3, e.g. `https://dsl-tos-api.onrender.com` |
| `VITE_GOOGLE_CLIENT_ID` | the value from `frontend/.env` |

5. **Deploy**. Then **Site configuration → Change site name** → `dsl-tos` (or the name you used in step 3).
   If you had to pick another name, change `FRONTEND_URL` and `BACKEND_URL` on Render to match (Render → service → Environment → Save, it redeploys).

## 5. Allow Google sign-in on the new address

1. **console.cloud.google.com** → APIs & Services → **Credentials** → your OAuth client (Web application).
2. **Authorised JavaScript origins → Add URI** → `https://dsl-tos.netlify.app` → **Save**.
   Keep `http://localhost:5173` so the PC version still works. It can take a few minutes to start working.

Now open `https://dsl-tos.netlify.app` and press **Continue with Google**.

## 6. Emails (optional)

Free Render servers block Gmail's sending ports, so the online version sends email through **Brevo** (free, 300 a day).

1. **brevo.com** → sign up → **Senders, domains & dedicated IPs → Senders → Add a sender** with `foysalpranto2002@gmail.com`, and confirm the email Brevo sends you.
2. **SMTP & API → API keys → Generate a new API key**. Copy it.
3. On Render → service → **Environment**: `BREVO_API_KEY` = the key, `DEFAULT_FROM_EMAIL` = `DSL TOS <foysalpranto2002@gmail.com>` → Save.

Without this the system still works: new requests show up under **Approvals** (the red number).

## 7. Keep it awake (recommended)

A free Render server sleeps after 15 minutes without visitors; the next visit then waits up to a minute
(the app shows "Waking up the server…"). To avoid that during the day:

1. **cron-job.org** → sign up → **Create cronjob**.
2. URL `https://dsl-tos-api.onrender.com/api/health/`, every **10 minutes** → Create.

This address never touches the database, so Neon still sleeps when nobody is working (that keeps it inside its free hours).

---

## Checklist

- [ ] `…onrender.com/api/health/` shows `{"ok": true}`
- [ ] The Netlify site opens and **Continue with Google** works
- [ ] Dashboard, Sheets and Weekly KPI show the copied data
- [ ] A profile photo shows (Profile page)
- [ ] Team setup → Backups lists the backups
- [ ] (if step 6 is done) a test email arrives. From this PC (free Render has no Shell):
  `cd backend`, `.venv\Scripts\activate`, `set BREVO_API_KEY=<the key>`, `set DEFAULT_FROM_EMAIL=DSL TOS <foysalpranto2002@gmail.com>`,
  then `python manage.py send_test_email foysalpranto2002@gmail.com`

## Updating later

Push to the `main` branch on GitHub. Render and Netlify both rebuild by themselves (database changes run automatically).

## What the free plans mean

- **Render**: sleeps after 15 minutes idle unless step 7 is set up; 750 free hours a month (enough for one service running all the time).
- **Neon**: sleeps after 5 minutes idle and wakes in about a second. Free compute hours are limited, so don't point uptime checks at anything except `/api/health/`.
- Profile photos and backups are stored **in the database**, because Render's free disk is wiped on every restart.
- **Download Excel** from Performance now and then as an extra copy.
