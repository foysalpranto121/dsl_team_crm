# DSL Business Team Operation System (TOS) — Admin guide

Step-by-step instructions for the four things still to finish, plus the daily routine for the team.

---

## 1. Turn on emails (Gmail App Password)

Without this, approval emails are not sent; they only appear in the backend window.

1. Open **myaccount.google.com** with `foysalpranto2002@gmail.com`.
2. Go to **Security** → turn on **2-Step Verification** (if it's not on yet).
3. In the search bar at the top, type **App passwords** and open it.
4. App name: `DSL CRM` → **Create**. Google shows a 16-letter password, like `abcd efgh ijkl mnop`.
5. Open `backend/.env` and fill in the line (remove the spaces):
   ```
   EMAIL_HOST_PASSWORD=abcdefghijklmnop
   ```
6. Restart the backend (stop it with Ctrl+C, then `python manage.py runserver`).
7. Test it:
   ```
   cd backend
   .venv\Scripts\activate
   python manage.py send_test_email foysalpranto2002@gmail.com
   ```
   "Sent" means it works. Check the inbox (and spam the first time).

> The `GOCSPX-…` value from Google Cloud is **not** this password. Never put it in `.env`.

---

## 2. Link Shohan, Orin and D to their sheets

**This is now automatic.** When you approve someone, every sheet that carries the same name is linked to them (their work sheet and their planning sheet). After pressing **Approve** you'll see, for example:

> *Orin Tasfia is approved and linked to: Orin, Planning - Orin.*

The name must match the name on the sheet (from the CONFIG tab):

| Sheet | Name it looks for |
|---|---|
| Shohan, Planning - Shohan | Shohanur Rahaman |
| Orin, Planning - Orin | Orin Tasfia |
| D | D |
| Pranto, Planning - Pranto | Foysal Ahmed Pranto — **already linked to you** |

**If the names don't match** (for example their Google name is "Shohan Rahman"), link by hand:

1. Sidebar → **Team setup**.
2. Find the sheet → **Edit**.
3. **Filled in by** → choose the person → **Save sheet**. Do the same for their planning sheet.

**D** will probably sign in with a real name, so link D's sheet by hand, or first change the sheet's **Name on dashboards** to D's real name.

Steps for each new team member:
1. Send them the link to the app. They press **Continue with Google**.
2. You get the request (email, or the red number on **Approvals**).
3. Choose **Member** → **Approve**. Check the message says which sheets were linked.

---

## 3. Enter the missing revenue (Weekly KPI)

The Excel KPI sheet had no revenue, and revenue is 30–40% of each sales person's score, so scores look low until it is entered.

**Option A — in the app (best for a few weeks):**
1. Sidebar → **Weekly KPI**.
2. Use **‹** to go back to the week (weeks run Saturday to Friday).
3. Type the revenue (BDT) in that person's row → **Save**.
   As admin you can change any week; members can only change the current week.
4. Check **Performance**: the score updates straight away.

**Option B — in Excel (best for many weeks at once):**
1. Fill in column H (*Revenue Earned BDT*) in the `KPI_Weekly_Input` tab of the workbook.
2. Sidebar → **Team setup** → **Import from the Excel sheet** → choose the file → **Check file** → **Import now**.
   Importing again updates what's there; it never makes copies.

---

## 4. Bring in your old tracker (if you have one)

Only needed if you used the old single-page Central AI tracker and want its prospects, activities and plan.

1. Open the old tracker **in the same browser and at the same address you used before** (its data is stored in that browser).
2. Go to **Settings & team** → **Download backup (.json)**. A file like `central-ai-crm-backup-2026-10-29.json` is saved.
3. In the new app: sidebar → **Pipeline & plan** → **Settings** tab → **Bring in your old tracker** → choose that file.
4. You'll see how many prospects, activities and plan days came in. Doing it twice won't duplicate prospects.

If the old tracker shows no prospects, there's nothing to bring in. Start fresh in **My tracker**.

---

## Daily routine for the team

| When | What | Where |
|---|---|---|
| During the day | Choose a task for each hour (H-1 … H-10) | **Sheets** → your sheet |
| Before 12 at night | Make sure today is filled in. At midnight (Dhaka time) the day locks | **Sheets** (the Dashboard shows a reminder) |
| By Friday | Enter the week's leads, opportunities, clients, revenue | **Weekly KPI** |
| Any time | Update prospects and follow-ups | **Pipeline & plan** |

**Admins:** approve people (**Approvals**), correct a locked day (open the sheet: admins can edit any day; it is recorded), change targets, tasks, points and job roles (**Team setup**), and download Excel (**Sheets** or **Performance** → **Download Excel**).

---

## Starting the system (on this PC)

```
cd backend
.venv\Scripts\activate
python manage.py runserver        # keep this window open

cd frontend
npm run dev                        # keep this window open
```

Then open **http://localhost:5173**. To let the team use it from anywhere, it has to be put online (next step of the plan).

---

## Deleting sheets, or replacing all the data

All in **Team setup** (admins only). Every deletion is recorded in the **Activity log**.

| You want to… | Do this |
|---|---|
| Remove one sheet and all its days and KPIs | Sheets table → **Delete** → **Delete** again to confirm. (Use **Archive** instead to hide it and keep the history.) |
| Start again from a new workbook in one step | **Import from the Excel sheet** → choose the file → tick **Replace everything** → **Check file** (shows what will be deleted, nothing is saved yet) → **Import now** |
| Delete all team data | **Danger zone** at the bottom → type `DELETE` → **Delete all team data** |

What is **never** deleted: people's accounts and profiles, tasks, job roles, team rules, everyone's private tracker, and the activity log.
Before any of these, the system saves a **backup** of all sheets, days and weekly results. Find them under **Backups** in Team setup: **Download** keeps a copy on your PC, and **Restore…** (type `RESTORE`) brings the data back. Restoring first backs up what is there now, so it can be undone. The newest 30 backups are kept.
Download the Excel too (**Performance → Download team Excel**) if you want a copy in the familiar layout.
