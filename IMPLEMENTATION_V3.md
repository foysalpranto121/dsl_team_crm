# TOS v3 — Implementation Plan

**Goal:** make TOS look and feel professional grade, and move it toward the spec in
`Team_Operation_System_TOS_SRS_v0.3.docx` (Forhad, SRS v0.3).

**Why now:** the client said the current UI/UX is basic, weak and not professional grade. SRS v0.3 sets the bar too:
NFR-1 asks for a modern enterprise UI, a consistent design system, WCAG 2.1 AA, light and dark themes and a day logged in under 60 seconds.
NFR-10 asks that every screen has one primary action, the most frequent actions take ≤ 3 taps, and members can tell what to do next within 5 seconds.

**Order of work (each step is shown to the client before the next one starts):**

1. **M1 Design system and app shell.** New look, no backend changes.
2. **M2 Re-skin every current screen.** Same data, professional UI. This is the quickest visible answer to the client.
3. **M3 Clickable prototype of the SRS v0.3 experience on mock data.** This is the SRS "Phase 0", and Forhad signs it off.
4. **M4 Backend for the core loop:** plan → approve → log → score.
5. **M5 Team pipeline and sales playbook.**
6. **M6 Motivation, guidance and quick capture.**
7. **M7 Reports and export.**

The [P2] items and the V2 section (SRS §14) wait until the SRS Phase 2 exit criteria are met, as the SRS itself says.

`IMPLEMENTATION.md` stays the record of the v1 build (steps 0–13, done). This file covers v3.

---

## 1. What makes the current UI look basic

Found in the code, not guessed:

| Problem | Where | Fix in |
|---|---|---|
| Only 10 hand-made parts (Button, Card, Field, Input, Select, Badge, Spinner, PageHeader, EmptyState, Alert). There is no dialog, drawer, dropdown menu, popover, tooltip, tabs, toast, combobox, date picker, data table or skeleton. | `src/components/ui.tsx` | M1 |
| Native `<select>` dropdowns everywhere. The Sheets grid draws 10 of them per day row, about 300 a month. It looks like a form, not a product, and it's slow with the keyboard. | `pages/Sheets.tsx:41`, Tracker, TeamSetup, Approvals | M1, M2 |
| One hand-made modal with no focus trap and no Esc to close | `pages/Tracker.tsx:148` | M1 |
| A full-page spinner on every load. No skeletons, no "Saved" toasts, no optimistic updates. | every page | M1, M2 |
| Flat hierarchy: every block is the same bordered `rounded-2xl` card. On the dashboard, three alerts (announcements, "not filled in", "KPI missing") stack on top and push the data down. | `Dashboard.tsx` | M2 |
| The shell has none of the things enterprise users expect: search or command palette, notification bell, quick "+" create, breadcrumbs, user menu, collapsible sidebar. | `components/Layout.tsx` | M1 |
| One dashboard for everyone. The SRS wants a member Home ("what do I do now"), plus supervisor and management dashboards. | `Dashboard.tsx` | M2, M3 |
| Plain `<table>`s: no sorting, filters, column chooser, sticky header, row actions or pagination | Dashboard, KPI, Performance, Tracker, ActivityLog | M1, M2 |
| DSL red is used as the "accent" (nav badges, labels), but the same red means *error* | `index.css`, `Layout.tsx` | M1 |
| Charts use Recharts' default look, styled one by one on each page | Dashboard, Performance, Tracker | M1 |
| Money is shown as "5M" (en-GB compact), while the SRS and the team think in lakh and crore | `Dashboard.tsx:14` | M1 |

## 2. Design direction

**Reference feel:** Linear, Attio, Stripe Dashboard and HubSpot. Calm neutral surfaces, dense but readable data,
strong type hierarchy, one clear primary button per screen, and colour used only to carry meaning.

- **Tokens, not raw colours.** Semantic CSS variables (`background`, `surface`, `surface-raised`, `border`, `muted`, `foreground`,
  `primary`, `success`, `warning`, `danger`, `info`, `chart-1…6`), defined for light and dark and mapped in the Tailwind v4 `@theme`.
  - DSL blue `#034EA1` is the primary colour.
  - DSL green `#00A550` means success and "on target".
  - DSL red `#EC1C24` is kept for danger and the logo only.
  - The admin-defined status thresholds and colours (FR-C7) map onto these tokens.
- **Type.** Keep IBM Plex Sans for the UI and IBM Plex Mono (tabular numbers) for table figures. Use Archivo only for page titles.
  Big KPI numbers use Plex Sans semibold with proportional figures, which reads better at display size.
  Scale: 12 / 13 / 14 / 16 / 20 / 24 / 30. Add Noto Sans Bengali as a fallback so Bangla text (P2) renders well.
- **Layout.**
  - Spacing on a 4 px grid. Radius 8 px for controls and 12 px for cards.
  - Three shadow levels and fewer borders: hierarchy comes from surface tone, not outlines.
  - Tables come in comfortable and compact density.
- **Motion.** 150–200 ms ease-out on hovers, drawers and toasts. Progress rings and bars animate. Wins get a celebration (FR-MO5).
  Everything respects `prefers-reduced-motion`.
- **Numbers.**
  - BDT uses lakh and crore grouping (`en-IN`), with a compact form like "৳ 50 L".
  - Percentages always show the target next to the value.
  - All formatting lives in one `lib/format.ts`.
- **Accessibility (WCAG 2.1 AA).** Radix primitives give correct ARIA and focus. Contrast is checked for both themes.
  Everything works from the keyboard, and focus rings are always visible.
- **Copy.** Plain-language labels, following SRS FR-G5 ("You need 6 more output hours this week…").
  All strings go in `src/i18n/en.ts`, so Bangla (P2) is a translation and not a rewrite.

## 3. Frontend tools to add

Keep React 19, Vite, Tailwind v4, TanStack Query, axios, Recharts and lucide-react. Add:

| Need | Choice | Why |
|---|---|---|
| Accessible components | **shadcn/ui** (Radix UI + Tailwind v4). The code is copied into `src/components/ui`, so we own and restyle it. | Professional, accessible, no lock-in |
| Data tables | **TanStack Table v8** (pinned: v9 is out with a new API) | Sorting, filters, column visibility, sticky header, pagination |
| Forms | **react-hook-form + zod** | Inline validation, one schema per form |
| Toasts | **sonner** | Feedback for "Saved", "Approved" and undo |
| Command palette (Ctrl+K) | **cmdk** | Search people, deals and pages; run actions |
| Drag and drop | **@dnd-kit** | Pipeline Kanban and the planning grid |
| Dates | **date-fns** + shadcn Calendar (react-day-picker v9, pinned: v10 is out) | Date pickers and week maths on screen |
| Animation | **motion** | Progress rings, celebrations, page transitions |
| Mock API for the prototype | **MSW** (Mock Service Worker) | M3 runs on mock data typed against the planned endpoints |
| Installable app | **vite-plugin-pwa** | FR-Q1 quick log from a phone |
| Tests | **Vitest + Testing Library**, **Playwright** with axe | Components, key flows, screenshots, accessibility |

Before installing, check each library's peer support for React 19, Tailwind 4.3, Vite 8 and TypeScript 7.
Add the `@/` path alias to `vite.config.ts` and `tsconfig.json`.

**New folder layout.** Pages move into `features/` as each one is redone; there's no big-bang move.

```
src/
  components/ui/     shadcn primitives (Button, Dialog, Select, Combobox, Tabs, Tooltip, …)
  components/app/    shell: Sidebar, Topbar, CommandMenu, QuickAdd, NotificationBell, MobileTabBar
  components/data/   DataTable, StatCard, ChartCard, ProgressRing, StepTracker, Timeline, Kanban, EmptyState
  features/          home, my-day, pipeline, progress, team, admin, onboarding, winwall, auth
  lib/               format.ts, nav.ts (menus by role), queryKeys.ts
  i18n/              en.ts (bn.ts later)
  mocks/             MSW handlers and fixtures (M3)
```

## 4. Navigation and roles

The SRS has Member, Supervisor, Management and Admin (Auditor is P2). Today the app has admin, member and viewer.
**Add `supervisor`, and rename `viewer` to `management` (read-only across teams).**

| Role | Menu (FR-G8: members get at most 5 items) |
|---|---|
| Member | Home · My Day · My Pipeline · My Progress · Learn |
| Supervisor | The member items + **Team**: Approvals · Planning board · Team dashboard · Pipeline · Members |
| Management | Overview · Teams · Reports · Win Wall |
| Admin | Everything + **Settings**: Teams and calendar · Activity catalogue · Role profiles and weights · KPI types · Scoring and thresholds · Approval policy · Sales process and playbooks · Users and sign-up approvals · Import · Audit log |

**App shell:**

- **Sidebar:** collapsible, with an icons-only mode. The DSL logo sits at the top, and the user card and menu (Profile, Preferences, Theme, Sign out) at the bottom.
- **Top bar:** page title and breadcrumbs, global search and command palette (Ctrl+K), a **"+"** button (Log slot, Log a win, New lead, Update deal; FR-Q2),
  a notifications bell (FR-N1) and help "?" (FR-G7).
- **Phone:** a bottom tab bar with the 5 member items and a centre "+" button.

**Where today's pages go:**

| Today | In v3 |
|---|---|
| Dashboard | Split into **Home** (member), **Team dashboard** (supervisor) and **Overview** (management) |
| Sheets | **My Day** (member: plan vs. log per slot, keyboard entry), plus a **Sheet view** for supervisors and admins that keeps the familiar Excel layout |
| Weekly KPI | My Progress → Weekly KPI; Team → KPI |
| Performance | My Progress (self); Team dashboard and Reports (others) |
| Tracker (pipeline and plan) | **My Pipeline** (Kanban, table, record page). The daily plan moves into My Day. |
| People | Team → Members, plus a profile page per person |
| Approvals (sign-ups) | Settings → Users |
| Team setup | The Settings sections listed above |
| Team pipelines | Team → Pipeline |
| Activity log | Settings → Audit log |
| My profile | User menu → Profile and preferences |

---

## 5. Milestones

Each milestone ends with a check and a client demo. The estimates are rough, for one developer working with Claude.

### M1 — Design system and app shell (≈ 1 week, frontend only)

1. Install the libraries from §3, set up shadcn (`components.json`, the `@/` alias), and write the tokens for light and dark in `index.css`.
2. Build the primitives:
   - **Basic controls:** Button (sizes, icon-only, loading), Input, Textarea, Select, Combobox, Checkbox, Switch, Radio, Date picker.
   - **Overlays:** Dialog, Confirm dialog, Drawer/Sheet, Dropdown menu, Popover, Tooltip.
   - **Display:** Tabs, Status pill, Avatar group, Skeleton, Toast.
   - **Progress:** Progress bar, Progress ring.
3. Build the data components:
   - **Numbers and charts:** StatCard (value, target, change vs. last period, sparkline) and ChartCard (one Recharts theme for both modes).
   - **Tables and boards:** DataTable (sorting, filters, column chooser, sticky header, row actions, density, CSV) and Kanban column and card.
   - **States and flow:** a "teaching" EmptyState (FR-G6), StepTracker (FR-G4: Draft → Submitted → Approved → Logged → Scored), Timeline, ErrorState with retry.
4. Build the app shell from §4. All menus by role live in one `lib/nav.ts`.
5. Make the "waking up the server" screen (free Render tier) a branded loading screen with progress text instead of a bare spinner.
6. Add a **`/ui` showcase page** (admin only) with every component in both themes. It's cheaper than Storybook.

**Done when:** every component looks right in light and dark on `/ui`; axe finds no serious issues; keyboard-only use works;
`npm run typecheck` and `npm run build` pass.

**Status (2026-11-07): built.**

- **Where the code is:**
  - `src/lib/` holds the cn, format (BDT lakh/crore), theme, nav and local-state helpers.
  - `src/components/ui/` holds the primitives. `components/ui/index.tsx` keeps the old component names, so every existing page already uses the new look.
  - `src/components/data/` holds StatCard, ChartCard, DataTable, StepTracker/Timeline, Kanban and the empty/error states.
  - `src/components/app/` holds the shell: sidebar, top bar, Ctrl K palette, New menu, notification bell, phone tab bar, shortcuts dialog and boot screen.
  - `/ui` is the admin-only showcase, loaded on demand.
- **Checks:**
  - typecheck and build pass.
  - Screenshots were reviewed in light, dark, collapsed sidebar and phone (390 px).
  - axe-core finds no WCAG 2.1 A/AA violations on `/ui` (all tabs) or `/dashboard` in either theme.
  - The browser console shows no errors.
  - Chart colours were checked with the dataviz palette validator.
  - These checks ran with sample API data, not the live backend.
- **Left for M2:**
  - The old Dashboard alerts carry their own icons, so they show two icons now.
  - Pages still use `slate-*` classes in places.
  - The main bundle is 1.14 MB (338 KB gzipped); split the routes with `lazy()`.
  - The notification bell computes its items live until stored notifications arrive (M4).

### M2 — Re-skin every current screen (≈ 1.5 weeks, same API, no backend changes)

The order follows what the client sees first. Every page gets skeleton loading, toasts on save, confirm dialogs for deletes,
teaching empty states, an error state with retry, and a phone layout at 375 px.

| Screen | What changes |
|---|---|
| Sign-in / Home | Split screen: a brand panel with what TOS does on one side, the Google button and trust line on the other. Waiting-for-approval and rejected states look the same. |
| Dashboard | A StatCard row with sparkline and change vs. last week or month. The three stacked alerts become one compact **"Needs attention"** panel. Charts sit in ChartCards. Team status becomes a DataTable with status pills and mini progress bars; clicking a row opens a person drawer (their week, month and KPIs). |
| Sheets | The 10 native selects per row become a **keyboard grid**: each cell is a coloured activity chip (colour = category); arrows move between cells; typing searches activities; Enter sets, Delete clears, Ctrl+D fills down. Adds "Copy yesterday", a sticky header and date column, week subtotal rows, and a clear lock state with countdown. Target: a full day in under 60 s (NFR-1). |
| Tracker → Pipeline | A **drag-and-drop Kanban** by stage. Deal cards show company, value, next action date and a health dot. A table view with saved filters. The record opens in a side drawer with a timeline; the hand-made modal goes. |
| Weekly KPI | An inline-edit DataTable with validation, a "missing weeks" chip per person, and a history chart. |
| Performance | Month / quarter / year tabs, an achievement % heat-table, and a composite score breakdown (stacked bar by metric weight). |
| People | Card grid / list toggle and a profile page. |
| Admin pages | A Settings layout with left sub-navigation. Weightage editor with a live "total = 100%" meter. Tasks table with inline edit and drag to reorder. Import as a step-by-step wizard with the dry-run report. Approvals as a queue with bulk approve. |

**Done when:**

- No native `<select>` is left.
- Lighthouse accessibility scores ≥ 95 on every page.
- Playwright screenshots of each page in light and dark at 375 px and 1280 px are reviewed.
- The client demo is done.

### M3 — SRS Phase 0: clickable prototype on mock data (≈ 1 week)

SRS §10 says Phase 0 must include the onboarding wizard, the Home screen with the Next Step card, the Close-the-day checklist,
a pipeline record with its stage playbook, and the Win Wall. It also needs a member day view, a planning grid, an approval queue,
three dashboards and the admin config screens.

The screens are built with real components on **MSW mock data**, using the API shapes planned for M4. They run on a separate
"prototype" Netlify deploy (or with `?demo=1`), so the live system keeps working.

| Screen | SRS |
|---|---|
| Onboarding wizard (5 steps, resumable, progress bar) | FR-G1 |
| **Home:** one **My Next Step** card, the daily rhythm checklist, progress rings (today / week / month), plain-language gaps | FR-G2, G3, G5, MO1 |
| **My Day:** today's approved slots → Done / Partly / Not done + quantity; deviation with a reason; "Close your day" | FR-T1, T2, T6, G3 |
| Weekly planning grid: copy last week, templates, link a slot to a deal | FR-P1, P4, SP4 |
| Supervisor approval queue with context (adherence, deviation rate, target gap), plus the planning board (members × slots) | FR-P2, P5, A2 hook |
| Team dashboard (supervisor) and Overview (management) | FR-D2, D3 |
| Pipeline record: stage playbook "To move this to the next stage", mandatory next action, deal health | FR-SP1–SP5 |
| Win Wall and the celebration animation | FR-MO5, MO6 |
| Admin config: role profiles and weights, activity catalogue, approval policy, sales process | FR-C2, C3, C8, SP1 |

**Done when:** Forhad signs off the flows and the look (SRS Phase 0 exit), after the SRS test with 5 members doing 5 tasks each,
including the 5-second "what do I do next?" test on Home (NFR-10).

### M4 — Backend for the core loop: plan → approve → log → score (≈ 3 weeks)

This is the SRS Phase 1 MVP core. Current models move to the SRS entities. **Existing data and scores must not change**:
the SRS acceptance test needs imported 2026 data to match the sheet within 1%.

| Today | SRS v0.3 entity |
|---|---|
| `TeamSettings` | `Team` + `CalendarConfig` (slots per day, slot length, holidays, lock time) |
| `Task` | `ActivityType` (+ category, scoring mode time-based or event-based, required fields) |
| `JobRole` (weights) | `RoleProfile` + `ScoreWeight` |
| `Sheet` (person, targets) | `Membership` + `MemberOverride` with `effective_from` |
| `Sheet` kind = plan | `Plan` / `PlanItem` with approval states |
| `SheetEntry.slots` | `TimesheetEntry` per slot + `EventLog` + **`ScoreLedger`** |
| `KpiEntry` | `KpiEntry` per `KpiType` |
| `AuditLog` | `AuditLog` with old and new values |
| — | `Notification`, `ApprovalRequest`, `NextStepRule` |

Steps:

1. **Roles and scoping:** add `supervisor` and `management`; data-driven permissions; `team_id` on every table (NFR-3, multi-tenant ready). There is one team for now.
2. **Config engine:** versioned configuration (`effective_from/to`), FR-C9 audit, and the status thresholds and approval policy per team.
3. **Plans and approval** (SRS §6): Draft → Submitted → Approved / Partly / Rejected → Locked; cut-off; can't approve your own plan; 48 h escalation.
4. **Timesheet:** a log per approved slot; deviations count zero until approved, then count back-dated; unplanned slots follow the team policy;
   event-based entries need verification. The existing midnight lock becomes the configurable daily lock.
5. **Score ledger:** every counted slot or event writes a ledger row pinned to the config version. `calc.py` reads from the ledger.
   Recalculation is an explicit, audit-logged admin action.
6. **Data migration:** today's `SheetEntry` days become *approved + logged* history (proposed default, see §7), so past scores stay the same.
   The old Sheet view stays read-only during the switch so numbers can be compared.
7. **Next Step and to-do API** (`/me/next-step`, `/me/todo`, daily rhythm), using the default priority order in FR-G2. Plus in-app notifications.
8. **Live update ≤ 5 s** (FR-S2): refresh after each change and poll every 15 s. Server-sent events can come later if needed.
9. Swap the M3 mocks for the real endpoints one screen at a time.

**Done when:**

- The SRS §11 acceptance criteria on planning, deviations, config versioning and import pass as **automated Django tests**.
- The 57 existing tests still pass.
- The DSL team runs a full week without the Google Sheet (SRS Phase 1 exit).

### M5 — Team pipeline and sales playbook (≈ 2 weeks)

- The private `Prospect` becomes a team `PipelineRecord`: owner, stage, value, probability, **mandatory dated next action**, and lead source (FR-MK1).
  Each person's tracker data is migrated.
- Weekly status log with "no update for N weeks" flags (FR-K3); a stage change proposes the KPI count (FR-K4); lost reasons (FR-K5).
- `SalesProcess`, `StageCriteria` and `PlaybookStep` per segment (Tender, Corporate, International); deal health and stuck-deal alerts.
- Win/loss review; **My funnel** vs. the team average (FR-SP8); target-to-activity calculator (FR-SP9); a basic content library (FR-SP6).

**Done when:** an open deal can't be saved without a dated next action, and an overdue one becomes the member's Next Step the next morning (SRS §11).

### M6 — Motivation, guidance and quick capture (≈ 2 weeks)

- Streaks, rule-based badges, and a **separate recognition (XP) ledger** that never touches the composite score (SRS §7).
- Win Wall feed, kudos, team challenges with countdown, fair leaderboard modes (FR-MO9), and a weekly personal recap.
- Onboarding progress saved; first-30-days learning mode; "?" help text editable by admins (FR-G7).
- **PWA:** install on a phone, log the current slot in ≤ 3 taps, offline capture with sync (FR-Q1). Smart reminders with quiet hours and a daily cap (FR-Q3).

**Done when:** a verified work order triggers the team celebration and badge within 5 s, and the composite score doesn't move (SRS §11).

### M7 — Reports and export (≈ 1 week)

- Prebuilt reports (FR-R1): weekly and monthly performance, task analysis, KPI summary, plan adherence, approval turnaround.
- Every dashboard number drills down to its ledger entries (FR-S3).
- CSV, XLSX and PDF export with the same numbers as on screen (FR-R3). The existing Excel download stays.

---

## 6. Quality bar for every screen

A screen is done only when it has all of these:

- [ ] Exactly **one primary action**, and it answers "what should I do now?"
- [ ] Skeleton loading, a teaching empty state, and an error state with retry
- [ ] A toast on success; a confirm dialog (or undo) for destructive actions
- [ ] Works with the keyboard only; visible focus; correct labels (axe clean)
- [ ] Looks right at 375 px and 1280 px, in light and dark
- [ ] Numbers use tabular figures, BDT in lakh/crore, and show the target next to each value
- [ ] All copy comes from `i18n/en.ts` in plain language

**Tests:**

- Vitest for components and hooks.
- Playwright for the core flows (sign-in, log a day, submit → approve plan, move a deal) and screenshots per milestone.
- Django tests for every rule in SRS §6–7 (NFR-8: these are the highest-risk logic).

## 7. Decisions needed from Forhad / the client

Each one has a proposed default, so work can start. These come from SRS §12 and from where today's app differs from the SRS.

| # | Question | Proposed default |
|---|---|---|
| 1 | How should imported sheet history count once plans need approval? | As approved and logged, so past scores don't change |
| 2 | Pipeline privacy: today each tracker is private (opt-in share), but the SRS needs supervisors to see deals | Supervisors and admins see their team's deals; each person's private notes stay private |
| 3 | Who are the supervisors, and does `viewer` become `management`? | Yes; Forhad confirms the names |
| 4 | Leaderboard (SRS Q6) | Self vs. target only, ranking off |
| 5 | Unplanned work (Q3) and event points such as a work order (Q2) | Zero until approved; event points verified by the supervisor |
| 6 | "Output hours" (Q4): does every approved slot count as 1 hour? | Yes, every approved and logged slot counts |
| 7 | Celebrations (Q12): show client name and value? | Team-only, value hidden |
| 8 | Brand: keep DSL blue, green and red with IBM Plex? | Yes |
| 9 | Stack (SRS OQ-9): the SRS suggests FastAPI/NestJS | **Decided (2026-11-07): Django REST Framework only, for every backend feature — no other framework** |

## 8. SRS Version 2 (§14)

On 2026-11-07 the owner chose to start the SRS V2 features now, before M2–M7, beginning with **Office TV mode**.
The backend stays Django REST Framework (decision 9).

### V2-A1 Office TV mode (§14.5, FR-TV1–TV3): built

- **Backend:** a new Django app, `display`.
  - `DisplayScreen` has a display-only token: only its SHA-256 is stored, the link is shown once, and admins can replace it.
  - `GET /api/display/feed/` is read-only. It's signed in with the `X-Display-Token` header, never a person's login, and rate-limited to 60 a minute.
  - `/api/display/screens/` lets admins add, change and delete screens; `.../rotate/` makes a new link.
  - Every change goes to the audit log as `display.*`.
  - Numbers come from `team.services`, so the TV always matches the dashboard.
- **Wins:** a new `Task.counts_as_win` flag.
  - Migration `team/0006` flags "Client Work Order Receiving"; the importer flags new "work order" tasks.
  - Admins can change which tasks count from the TV-screens page.
- **Fairness (FR-MO9, NFR-11):** the TV shows team totals, a count of who has logged today (not names) and only the top N leaders (top performers or most improved).
- **Privacy (SRS Q12 default):** win details and the revenue amount are hidden unless the screen allows them; revenue still shows as a percentage.
- **Frontend:**
  - `features/tv/TvDisplay.tsx` is the public `/tv` page, opened with the link `https://<site>/tv#<token>`. The token stays in the #fragment, so it never reaches server logs. The page rotates through its panels, shows a live clock and connection status, celebrates new wins with confetti and a chime, and supports full screen and arrow keys.
  - `features/tv/TvScreens.tsx` is Admin → TV screens.
- **Checks:**
  - 8 new DRF tests; 77 backend tests pass in total.
  - A browser run against the real API on a throwaway database: the panels showed at 1080p; a win logged while the TV was on was celebrated in about 12 s; a replaced link was refused at once.
  - axe found no WCAG 2.1 A/AA issues on either new page.
- **To use it locally:** run `python manage.py migrate` (Render runs it on deploy).

### Next V2 candidates

These come from SRS §14.1, Wave A first. Each needs the item in brackets before it can start:

- AMC and renewal tracker (§14.6) [contract data, or an import from Odoo]
- Morning huddle and weekly digest (§14.9) [email settings, already present]
- AI daily briefs (§14.10) [an Anthropic API key; called from DRF]
- WhatsApp logging bot (§14.3) [a WhatsApp Business provider account, OQ-V2-5]
- Tender alerts (§14.2) [allowed tender sources, OQ-V2-1]
- Earnings preview (§14.4) [the incentive scheme, OQ-V2-2]

## 9. First step

Start **M1**: install the libraries, write the tokens, build the primitives and the new shell, then the `/ui` page.
After that, M2 starts with the Dashboard and Sheets, the two screens the client sees most.
