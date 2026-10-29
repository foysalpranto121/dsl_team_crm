# DSL Business Team CRM — Implementation Plan

A private CRM for the DSL Business Team. It combines two things in one system:

1. **Team CRM:** the Team Operation Sheet (daily hour-by-hour work logs, weekly KPIs, targets, points and role-weighted scores), with a dashboard and charts.
2. **Personal business tracker:** each person's own pipeline, daily plan and activity log, with their own product and targets.

People sign in with Google. An admin must approve each new person before they can use the system.

---

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Backend | Django 5.2 LTS + Django REST Framework | Mature, batteries included, admin site for free |
| Auth | Google Sign-In → backend verifies the Google ID token → issues **JWT** (SimpleJWT) | No passwords to store; JWT for the React app |
| Database | PostgreSQL 18 (local), database `DSLCRM` | Already installed and running |
| Frontend | React 18 + Vite + TypeScript | Fast dev server, type safety |
| UI | Tailwind CSS, Recharts (graphs), lucide-react (icons) | Clean, consistent, responsive design |
| Data fetching | TanStack Query + axios (automatic token refresh) | Caching, loading and error states |
| Email | Gmail SMTP (App Password) | Approval requests and notifications |
| Excel | openpyxl | Download the Team Operation Sheet as `.xlsx`; import the existing workbook |

## 2. Folder layout

```
Central AI CRM/
├── IMPLEMENTATION.md          ← this plan
├── backend/
│   ├── .env                   ← secrets (git-ignored)
│   ├── .env.example           ← template without secrets
│   ├── requirements.txt
│   ├── manage.py
│   ├── config/                ← settings, urls
│   ├── accounts/              ← users, Google sign-in, approval, profiles
│   ├── team/                  ← sheets, entries, KPIs, tasks, roles, scores, Excel
│   ├── tracker/               ← personal pipeline, plan, activities
│   └── core/                  ← notifications, activity feed, announcements
├── frontend/
│   ├── .env                   ← VITE_API_URL, VITE_GOOGLE_CLIENT_ID
│   └── src/ (pages, components, api, hooks, assets/logo.svg)
└── legacy/                    ← the old single-page app, kept for reference until the new one replaces it
```

## 3. Sign-in, approval and first-time sign-up

```
Person clicks "Continue with Google"
        │
        ▼
Backend verifies the Google token ──► new email? ──► create account (status: PENDING)
        │                                              │
        │                                              ├─► email every admin: "Approve / Reject" links (signed, expire in 7 days)
        │                                              └─► person sees "Waiting for approval"
        ▼
Admin clicks Approve (in Gmail or in the app's Approvals page) → status: APPROVED, role chosen → person emailed
        │
        ▼
Person signs in again → JWT issued → first time only: "Complete your profile"
(photo, position, job description, official email, phone, bio) → dashboard
```

- Emails listed in `ADMIN_EMAILS` (.env) are approved as **admin** automatically on their first sign-in, so the system can be bootstrapped.
- Statuses: `pending`, `approved`, `rejected`, `disabled`. Only `approved` people get tokens.
- Tokens: access token lives in memory (15 min); the refresh token is an **httpOnly cookie** (7 days, rotated, old ones blacklisted). Sign-out blacklists it.

## 4. Roles and permissions

| | Admin | Member | Viewer |
|---|---|---|---|
| See team dashboard, all sheets, KPIs, performance | ✓ | ✓ | ✓ |
| Fill in **own** sheet (today only once the lock is on) | ✓ | ✓ | |
| Fill in any sheet, any day | ✓ | | |
| Enter **own** weekly KPI (current week) | ✓ | ✓ | |
| Create / rename / archive sheets, set targets | ✓ | | |
| Edit tasks, points, job roles, weightages, lock and time zone | ✓ | | |
| Approve / reject people, change roles | ✓ | | |
| Own personal tracker (private) | ✓ | ✓ | ✓ |
| Download Excel | ✓ | ✓ | ✓ |

**Midnight lock.** With the lock on, a member can change a work log only for *today*, and a plan sheet for today or later. At 12:00 at night (team time zone, default Asia/Dhaka) the day locks. This is checked on the **server**, so changing a computer's clock does nothing. Admins can always correct any day, and every change is recorded in the activity feed.

## 5. Data model

**accounts**
- `User`: email (login), name, Google id, `status`, `role`, `approved_by`, `approved_at`
- `Profile`: photo, position, job description, official email, phone (official), bio, `completed`

**team**
- `TeamSettings` (one row): team name, time zone, lock on/off, week start (Saturday), weekend days (Friday), count weekend work, currency (BDT)
- `Task`: type, name, points, active
- `JobRole`: name, tasks (many-to-many), weightages for hours / points / leads / opps / clients / revenue (must total 100%)
- `Sheet`: name (admin editable), kind (work log or plan), owner (user), person name, job role, targets (weekly hours, monthly points, leads, opps, clients, revenue), start date, order, archived
- `SheetEntry`: sheet, day, 10 hour slots (task ids), remarks — unique per sheet + day
- `KpiEntry`: sheet, week start, leads, opportunities, clients, revenue, notes — unique per sheet + week

**tracker** (each row has an `owner`; only the owner can see it)
- `TrackerSettings`: product name, tagline, period start/length, targets, weekly targets, point rules, lists (countries, industries, channels, plans)
- `Prospect`: company, contact, title, email, phone, LinkedIn, country, industry, channel, plan, stage, stage dates, next follow-up, notes
- `Activity`: date, type, quantity, note
- `PlanDay`: date, tasks (text + done), note

**core**
- `AuditLog`: who changed what and when (entries, KPIs, targets, approvals)
- `Notification`: in-app messages (approved, a day is about to lock, follow-ups due)
- `Announcement`: admin posts shown on the dashboard

## 6. How the numbers are calculated

The rules come from the original workbook, with its bugs fixed:

- **Hours per day** = number of filled hour slots (H-1 … H-10).
- **Points per day** = sum of each task's points. *Fix:* Excel looked up only task rows 21–61, so "Monthly Report Preparation" and "Monthly Presentation" always earned 0.
- **Week** = Saturday → Friday, numbered from the week that holds 1 January. The New Year week stays one whole week.
- **Weekly KPI** counts in the month that holds most of that week's days.
- **Average per week / per month** since the start date use *completed* weeks and months only, so a Saturday morning doesn't drag the average down. *Fix:* Excel's monthly average broke across a year boundary.
- **Status this week / month** compares with where you should be by now (working days so far): Target met · On pace · Near (80%+) · Behind.
- **Composite score** = Σ role weight × (actual ÷ own target), for hours (average per week vs weekly target), points, leads, opps, clients and revenue. The start month is pro-rated. Quarter and year = average of completed months. *Fix:* Excel looked up the wrong names for Pranto ("Safi") and D ("Nazmul"), so their KPI scores were always 0.
- Admins see warnings when weightages don't add up to 100% or a weighted metric has no target.

These rules already exist as tested functions (`calc.js`, checked against the workbook's saved values) and will be ported to `backend/team/calc.py` with the same tests. The API returns the finished numbers, so the screens and the Excel download always agree.

**Workbook data to check during import** (found by comparing with Excel's saved values):
- Shohan and Orin show 1 hour on the Eid holiday days (25–29 May) although no task is chosen. A hidden value probably sits in an hour cell, which also makes their yearly hours 11 and 9 higher.
- One cell says "market research" in lower case, which doesn't match the task list.
- Pranto, 4 Oct: Excel shows 20 points, the tasks add up to 15.

## 7. Screens (React)

| Page | What it shows |
|---|---|
| **Home** (public) | Logo, what the system is, "Continue with Google" |
| **Waiting for approval** | Status, who to contact |
| **Complete your profile** | Photo upload with preview, position, job description, official email, phone, bio |
| **Team dashboard** | KPI cards (team hours this week, points this month, leads, revenue), weekly hours vs target bar chart, points trend line, score per person, leaderboard, announcements, who hasn't filled in today |
| **Sheets** | Excel-like grid: one row per day, 10 hour dropdowns (only that person's job-role tasks), remarks, hours and points; weekly subtotals; lock countdown; month picker; **Download Excel** |
| **Weekly KPI** | One row per person for the chosen week; edit own (admin: all); history chart |
| **Performance** | Monthly / quarterly / yearly table and chart of the six metrics and the composite score |
| **My tracker → Pipeline** | Kanban board + table, stage changes, follow-up reminders, CSV import/export |
| **My tracker → Daily plan / Activity / Reports** | The existing personal tracker features |
| **Team** | Member directory with profile cards |
| **Admin → Approvals** | Pending requests: approve as member / viewer / admin, or reject |
| **Admin → Settings** | Sheets (rename, owner, role, targets), tasks and points, job roles and weightages, lock and time zone |
| **Profile** | Edit own profile and photo |

Design: navy and gold brand colours from the current app, light and dark mode, sidebar layout on desktop, bottom-friendly layout on phones. The logo goes in `frontend/src/assets/logo.svg` (a placeholder until you provide yours).

## 8. Extra features I recommend

1. **Leaderboard** — ranking by composite score, monthly points and hours.
2. **"Not filled in today" alert** — the dashboard lists who hasn't logged hours. An optional email reminder goes out at 9 pm, before the midnight lock.
3. **Activity feed / audit log** — every edit, especially admin edits to locked days, with who and when.
4. **Follow-up reminders** — pipeline follow-ups due today and overdue, on the dashboard and as notifications.
5. **Announcements** — admins post updates and targets for the week.
6. **Team pipeline view** — admins see a combined pipeline. Each person decides whether to share theirs (off by default).
7. **Excel import** — a one-time command to bring the current workbook (people, targets, tasks, roles, every day's entries and KPIs) into the database.
8. **API docs** at `/api/docs/` (OpenAPI), for future integrations.

## 9. Build steps

Each step ends with a check before the next one starts.

**Progress:** steps 0–5 are done (backend sign-in, approval, profiles, team sheets with the midnight lock, KPIs, dashboard and performance numbers; 33 tests pass). Next: step 6.

| # | Step | Done when |
|---|---|---|
| 0 | Folder layout, `.gitignore`, `backend/.env`, Python virtual environment, requirements | `pip install` works; `.env` is git-ignored |
| 1 | Django project, PostgreSQL connection, custom `User`, DRF + SimpleJWT, CORS | `manage.py check` and `migrate` pass on `DSLCRM` |
| 2 | Google sign-in endpoint, approval flow, approval emails, signed approve/reject links | Tests: new user → pending; admin email auto-approved; approve link works; pending gets no token |
| 3 | Profile + photo upload, "me" endpoint | Tests for profile completion and image validation |
| 4 | Team models, admin settings API, sheet/entry/KPI API with the midnight lock | Permission tests (same cases as the 64 database checks already written) |
| 5 | `calc.py` (port of `calc.js`) + dashboard and performance endpoints | Calculation tests incl. comparison with the workbook |
| 6 | Personal tracker API (prospects, activities, plan, settings, CSV) | Owner-only tests |
| 7 | Excel download + Excel import command | Downloaded file opens in Excel; import reproduces the workbook's totals |
| 8 | React app: Vite, Tailwind, routing, auth (Google button, token refresh), layout, logo | Sign in → pending → approved → profile flow works in the browser |
| 9 | Team dashboard (charts), Sheets grid, Weekly KPI, Performance | Numbers match the API; lock shown correctly |
| 10 | Personal tracker pages | Pipeline, plan, activity, reports work |
| 11 | Admin pages (approvals, settings, members) | Admin can do everything without the Django admin |
| 12 | Extra features (leaderboard, reminders, feed, announcements) | — |
| 13 | Production: build, `DEBUG=False`, HTTPS, deployment guide | — |

## 10. What I need from you

| Item | Where to get it | Goes in |
|---|---|---|
| Google OAuth **Client ID** | Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → *Web application*. Authorised JavaScript origin: `http://localhost:5173` | `backend/.env` `GOOGLE_CLIENT_ID` and `frontend/.env` `VITE_GOOGLE_CLIENT_ID` |
| Gmail address + **App Password** (for sending approval emails) | Google Account → Security → 2-Step Verification → App passwords | `backend/.env` `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD` |
| Admin email(s) | Your Google account email | `backend/.env` `ADMIN_EMAILS` |
| Logo (SVG or PNG) | — | `frontend/src/assets/` |

Until the email settings are filled in, emails are printed in the backend terminal, so the approve link can still be clicked during development.

## 11. Run it (development)

```bash
# backend
cd backend
.venv\Scripts\activate
python manage.py migrate
python manage.py runserver          # http://localhost:8000

# frontend
cd frontend
npm install
npm run dev                          # http://localhost:5173
```
