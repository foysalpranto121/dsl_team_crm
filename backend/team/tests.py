import json
from datetime import date, datetime, timedelta
from datetime import timezone as tz
from decimal import Decimal
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from core.models import AuditLog

from . import calc, services, snapshots
from .models import Backup, JobRole, KpiEntry, Sheet, SheetEntry, Task, TeamSettings

# 10:00 in Dhaka on Thursday 29 Oct 2026 (UTC+6). The team week starts on Saturday 24 Oct.
NOW = datetime(2026, 10, 29, 4, 0, tzinfo=tz.utc)
TODAY, YESTERDAY, TOMORROW = date(2026, 10, 29), date(2026, 10, 28), date(2026, 10, 30)
WEEK = date(2026, 10, 24)


def at(moment):
    return mock.patch.object(services, "now", return_value=moment)


class TeamRulesTests(TestCase):
    """The same access cases as the database checks written for the earlier Supabase design, now enforced by the API."""

    @classmethod
    def setUpTestData(cls):
        mk = lambda email, role: User.objects.create_user(email, name=email.split("@")[0].title(), status="approved", role=role)
        cls.admin, cls.member, cls.other, cls.viewer = mk("admin@x.com", "admin"), mk("member@x.com", "member"), mk("other@x.com", "member"), mk("viewer@x.com", "viewer")
        cls.role = JobRole.objects.get(name="International Sales (AI)")
        cls.calls = Task.objects.get(name="Make 8 Cold Calls")                # 1 pt, in the role
        cls.demo = Task.objects.get(name="Demo & Presentation Session")       # 10 pts, in the role
        cls.market = Task.objects.get(name="Market Research")                 # not in this role
        cls.work = Sheet.objects.create(name="Member", owner=cls.member, role=cls.role, target_hours=35, target_points=300,
                                        target_leads=30, target_opps=15, target_clients=5, target_revenue=100000, start_date=date(2026, 10, 1))
        cls.plan = Sheet.objects.create(name="Planning - Member", kind="plan", owner=cls.member, role=cls.role)
        cls.unowned = Sheet.objects.create(name="Team D", role=cls.role)

    def setUp(self):
        self.clock = at(NOW)
        self.clock.start()
        self.addCleanup(self.clock.stop)

    def api(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def put(self, user, sheet, day, slots, remarks=""):
        return self.api(user).put(f"/api/team/sheets/{sheet.pk}/entries/{day}/", {"slots": slots, "remarks": remarks}, format="json")

    # ----- the midnight lock -----
    def test_member_fills_in_today_only(self):
        r = self.put(self.member, self.work, TODAY, [self.calls.pk, self.demo.pk])
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual((r.data["hours"], r.data["points"]), (2, 11.0))
        r = self.put(self.member, self.work, YESTERDAY, [self.calls.pk])
        self.assertEqual(r.status_code, 403)
        self.assertIn("locked", r.data["detail"])
        self.assertEqual(self.put(self.member, self.work, TOMORROW, [self.calls.pk]).status_code, 403)

    def test_day_locks_exactly_at_midnight_in_dhaka(self):
        with at(datetime(2026, 10, 29, 17, 59, 59, tzinfo=tz.utc)):          # 23:59:59 in Dhaka
            self.assertEqual(self.put(self.member, self.work, TODAY, [self.calls.pk]).status_code, 200)
        with at(datetime(2026, 10, 29, 18, 0, 0, tzinfo=tz.utc)):            # 00:00 on the 30th
            self.assertEqual(self.put(self.member, self.work, TODAY, [self.calls.pk]).status_code, 403)
            self.assertEqual(self.put(self.member, self.work, TOMORROW, [self.calls.pk]).status_code, 200)

    def test_plan_sheet_allows_today_and_later(self):
        self.assertEqual(self.put(self.member, self.plan, TOMORROW + timedelta(days=5), [self.demo.pk]).status_code, 200)
        self.assertEqual(self.put(self.member, self.plan, YESTERDAY, [self.demo.pk]).status_code, 403)

    def test_only_own_sheet_and_viewers_cannot_write(self):
        self.assertEqual(self.put(self.other, self.work, TODAY, [self.calls.pk]).status_code, 403)
        self.assertEqual(self.put(self.member, self.unowned, TODAY, [self.calls.pk]).status_code, 403)
        self.assertEqual(self.put(self.viewer, self.work, TODAY, [self.calls.pk]).status_code, 403)
        self.assertEqual(self.api(self.viewer).get(f"/api/team/sheets/{self.work.pk}/entries/").status_code, 200)

    def test_admin_corrects_a_locked_day_and_it_is_flagged(self):
        r = self.put(self.admin, self.work, YESTERDAY, [self.demo.pk], "fixed after call")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(AuditLog.objects.filter(action="entry.save", flagged=True, actor=self.admin).exists())
        self.assertEqual(self.put(self.member, self.work, YESTERDAY, []).status_code, 403)
        self.assertEqual(self.api(self.member).delete(f"/api/team/sheets/{self.work.pk}/entries/{YESTERDAY}/").status_code, 403)
        self.assertTrue(SheetEntry.objects.filter(sheet=self.work, day=YESTERDAY).exists())

    def test_lock_switched_off(self):
        st = TeamSettings.load()
        st.lock_days = False
        st.save()
        self.assertEqual(self.put(self.member, self.work, YESTERDAY - timedelta(days=3), [self.calls.pk]).status_code, 200)

    def test_archived_sheet_is_read_only_for_members(self):
        Sheet.objects.filter(pk=self.work.pk).update(archived=True)
        self.assertEqual(self.put(self.member, self.work, TODAY, [self.calls.pk]).status_code, 404)  # hidden from the list too

    def test_editable_days_come_from_the_server(self):
        r = self.api(self.member).get(f"/api/team/sheets/{self.work.pk}/entries/?from=2026-10-27&to=2026-10-31")
        self.assertEqual(r.data["editable"], {"2026-10-27": False, "2026-10-28": False, "2026-10-29": True, "2026-10-30": False, "2026-10-31": False})
        r = self.api(self.admin).get(f"/api/team/sheets/{self.work.pk}/entries/?from=2026-10-27&to=2026-10-28")
        self.assertTrue(all(r.data["editable"].values()))

    # ----- what can go in a slot -----
    def test_slot_rules(self):
        self.assertEqual(self.put(self.member, self.work, TODAY, [self.market.pk]).status_code, 403)       # not in role
        self.assertEqual(self.put(self.admin, self.unowned, TODAY, [self.market.pk]).status_code, 200)     # admins may
        self.assertEqual(self.put(self.member, self.work, TODAY, [99999]).status_code, 403)                # unknown
        self.assertEqual(self.put(self.member, self.work, TODAY, [self.calls.pk] * 11).status_code, 400)   # > 10 hours
        self.put(self.member, self.work, TODAY, [self.calls.pk, None, self.demo.pk])
        self.assertEqual(SheetEntry.objects.get(sheet=self.work, day=TODAY).slots, [self.calls.pk, None, self.demo.pk])
        Task.objects.filter(pk=self.calls.pk).update(active=False)
        self.assertEqual(self.put(self.member, self.work, TODAY, [self.calls.pk, self.demo.pk]).status_code, 200)  # unchanged slot keeps it
        self.assertEqual(self.put(self.member, self.work, TODAY, [self.demo.pk, self.calls.pk]).status_code, 403)  # newly chosen: no

    def test_clearing_a_day_removes_it(self):
        self.put(self.member, self.work, TODAY, [self.calls.pk])
        self.assertEqual(self.put(self.member, self.work, TODAY, [None, None], "").status_code, 204)
        self.assertFalse(SheetEntry.objects.filter(sheet=self.work, day=TODAY).exists())

    # ----- weekly results -----
    def test_weekly_results(self):
        kpi = lambda u, s, wk, **d: self.api(u).put(f"/api/team/sheets/{s.pk}/kpis/{wk}/", {"leads": 3, "opps": 1, "clients": 0, "revenue": "5000", **d}, format="json")
        self.assertEqual(kpi(self.member, self.work, WEEK).status_code, 200)
        self.assertEqual(kpi(self.member, self.work, WEEK - timedelta(days=7)).status_code, 403)
        self.assertEqual(kpi(self.member, self.work, WEEK + timedelta(days=1)).status_code, 403)          # not a Saturday
        self.assertEqual(kpi(self.member, self.plan, WEEK).status_code, 403)
        self.assertEqual(kpi(self.other, self.work, WEEK).status_code, 403)
        self.assertEqual(kpi(self.admin, self.work, WEEK - timedelta(days=7)).status_code, 200)
        self.assertEqual(kpi(self.member, self.work, WEEK, leads=-1).status_code, 400)
        self.assertEqual(KpiEntry.objects.get(sheet=self.work, week_start=WEEK).leads, 3)

    # ----- admin-only setup -----
    def test_setup_is_admin_only(self):
        m, a = self.api(self.member), self.api(self.admin)
        self.assertEqual(m.patch(f"/api/team/sheets/{self.work.pk}/", {"name": "Mine"}, format="json").status_code, 403)
        self.assertEqual(m.post("/api/team/sheets/", {"name": "New"}, format="json").status_code, 403)
        self.assertEqual(m.patch("/api/team/settings/", {"lock_days": False}, format="json").status_code, 403)
        self.assertEqual(m.patch(f"/api/team/sheets/{self.work.pk}/", {"target_hours": 1}, format="json").status_code, 403)
        r = a.patch(f"/api/team/sheets/{self.work.pk}/", {"name": "Pranto"}, format="json")
        self.assertEqual((r.status_code, r.data["name"]), (200, "Pranto"))
        self.assertEqual(a.patch(f"/api/team/sheets/{self.work.pk}/", {"owner": self.viewer.pk}, format="json").status_code, 400)
        self.assertEqual(a.patch("/api/team/settings/", {"timezone": "Mars/Base"}, format="json").status_code, 400)
        self.assertEqual(a.patch(f"/api/team/roles/{self.role.pk}/", {"w_hours": 50}, format="json").status_code, 400)  # must total 100
        self.assertEqual(a.patch(f"/api/team/roles/{self.role.pk}/", {"w_hours": 25, "w_revenue": 25}, format="json").status_code, 200)
        self.put(self.member, self.work, TODAY, [self.calls.pk])
        self.assertEqual(a.delete(f"/api/team/tasks/{self.calls.pk}/").status_code, 400)                # used: switch off instead
        self.assertEqual(m.get("/api/team/sheets/").status_code, 200)
        self.assertEqual(m.get("/api/team/warnings/").status_code, 403)

    # ----- numbers -----
    def test_dashboard_and_performance_numbers(self):
        SheetEntry.objects.create(sheet=self.work, day=date(2026, 10, 25), slots=[self.calls.pk] * 4)            # Sun: 4 h, 4 pts
        SheetEntry.objects.create(sheet=self.work, day=date(2026, 10, 20), slots=[self.demo.pk, self.calls.pk])  # last week: 2 h, 11 pts
        SheetEntry.objects.create(sheet=self.work, day=date(2026, 9, 30), slots=[self.demo.pk])                  # before start: ignored in score
        KpiEntry.objects.create(sheet=self.work, week_start=date(2026, 10, 3), leads=6, opps=3, clients=1, revenue=50000)
        d = self.api(self.viewer).get("/api/team/dashboard/").data
        row = next(r for r in d["rows"] if r["id"] == self.work.pk)
        self.assertEqual((row["week_hours"], row["last_week_hours"], row["month_points"], row["ytd_hours"]), (4, 2, 15.0, 7))
        self.assertEqual(row["week_status"]["key"], "behind")       # 4 of 35 h after 5 of 6 working days
        self.assertEqual(row["kpi_month"]["leads"], 6)
        self.assertNotIn(self.plan.pk, [r["id"] for r in d["rows"]])  # plans don't count
        p = self.api(self.viewer).get("/api/team/performance/?year=2026").data
        oct_ = next(r for r in p["rows"] if r["id"] == self.work.pk)["months"][9]
        expect = (0.20 * ((6 / (31 / 7)) / 35) + 0.05 * (15 / 300) + 0.20 * (6 / 30) + 0.15 * (3 / 15) + 0.10 * (1 / 5) + 0.30 * (50000 / 100000))
        self.assertEqual(oct_["state"], "current")
        self.assertAlmostEqual(oct_["score"], expect, places=9)
        self.assertEqual(next(r for r in p["rows"] if r["id"] == self.work.pk)["months"][8]["state"], "before")

    def test_dashboard_and_leaderboard_for_a_past_month(self):
        SheetEntry.objects.create(sheet=self.work, day=date(2026, 9, 30), slots=[self.demo.pk])        # Wed 30 Sep: 1 h, 10 pts
        SheetEntry.objects.create(sheet=self.work, day=date(2026, 9, 24), slots=[self.calls.pk] * 3)   # Thu 24 Sep: 3 h, 3 pts
        d = self.api(self.viewer).get("/api/team/dashboard/?month=2026-09").data
        row = next(r for r in d["rows"] if r["id"] == self.work.pk)
        self.assertEqual((str(d["date"]), d["month"], d["current_month"]), ("2026-09-30", "2026-09", "2026-10"))
        self.assertEqual((str(row["week_start"]), row["week_hours"], row["month_points"]), ("2026-09-19", 3, 13.0))   # last whole week of September
        lb = self.api(self.viewer).get("/api/team/leaderboard/?month=2026-09").data
        self.assertEqual((lb["month"], next(r for r in lb["rows"] if r["id"] == self.work.pk)["points"]), ("2026-09", 13.0))
        self.assertEqual(self.api(self.viewer).get("/api/team/dashboard/?month=2026-10").data["date"], TODAY)   # this month: as of today
        for bad in ("2026-11", "Sept"):
            self.assertEqual(self.api(self.viewer).get(f"/api/team/dashboard/?month={bad}").status_code, 400)

    def test_sheet_totals_for_the_month_view(self):
        half = Task.objects.create(name="Half-point task", points="0.5")
        self.role.tasks.add(half)
        E = lambda d, s: SheetEntry.objects.create(sheet=self.work, day=d, slots=s)
        E(date(2026, 10, 1), [half.pk] * 3 + [self.demo.pk])            # Thu: 4 h, 11.5 pts
        E(date(2026, 10, 30), [self.calls.pk] * 2)                       # Fri (weekend): 2 h, 2 pts
        E(date(2026, 10, 31), [self.demo.pk])                            # Sat 31 Oct: starts the next week
        E(date(2026, 11, 2), [self.calls.pk] * 5)                        # Mon 2 Nov: same week, next month
        E(date(2026, 9, 27), [self.calls.pk] * 7)                        # Sun 27 Sep: same week as 1 Oct
        Task.objects.filter(pk=half.pk).update(active=False)              # switched off later: still counts
        r = self.api(self.member).get(f"/api/team/sheets/{self.work.pk}/entries/?from=2026-10-01&to=2026-10-31").data
        self.assertEqual(r["totals"], {"hours": 4 + 2 + 1, "points": 11.5 + 2 + 10})          # only October days
        weeks = {str(w["start"]): (w["hours"], w["points"]) for w in r["weeks"]}
        self.assertEqual(weeks["2026-09-26"], (7 + 4, 7 + 11.5))          # whole week, including September
        self.assertEqual(weeks["2026-10-31"], (1 + 5, 10 + 5))            # whole week, including November
        self.assertEqual(len(r["weeks"]), 6)
        self.assertNotIn(half.pk, r["choices"])                          # not offered any more…
        self.assertIn(self.demo.pk, r["choices"])
        self.assertNotIn(self.market.pk, r["choices"])                   # …and other roles' tasks never are
        self.assertIn("locked", r["blocked"]["2026-10-28"])
        self.assertNotIn("2026-10-29", r["blocked"])
        st = TeamSettings.load()
        st.count_weekend = False
        st.save()
        r = self.api(self.member).get(f"/api/team/sheets/{self.work.pk}/entries/?from=2026-10-01&to=2026-10-31").data
        self.assertEqual(r["totals"], {"hours": 4 + 1, "points": 11.5 + 10})                  # Friday left out

    def test_month_and_day_roll_over_at_midnight(self):
        url = f"/api/team/sheets/{self.work.pk}/entries/"
        with at(datetime(2026, 10, 31, 17, 59, tzinfo=tz.utc)):          # 23:59 on Sat 31 Oct in Dhaka
            r = self.api(self.member).get(url).data
            self.assertEqual((str(r["from"]), str(r["to"]), str(r["today"])), ("2026-10-01", "2026-10-31", "2026-10-31"))
            self.assertTrue(r["editable"]["2026-10-31"])
            self.assertEqual(r["seconds_to_lock"], 60)
        with at(datetime(2026, 10, 31, 18, 1, tzinfo=tz.utc)):           # 00:01 on Sun 1 Nov
            r = self.api(self.member).get(url).data                       # no dates asked for: the current month
            self.assertEqual((str(r["from"]), str(r["to"]), str(r["today"])), ("2026-11-01", "2026-11-30", "2026-11-01"))
            self.assertTrue(r["editable"]["2026-11-01"])
            old = self.api(self.member).get(url + "?from=2026-10-01&to=2026-10-31").data
            self.assertFalse(old["editable"]["2026-10-31"])              # yesterday is now locked
            self.assertIn("locked", old["blocked"]["2026-10-31"])
            self.assertEqual(self.put(self.member, self.work, date(2026, 10, 31), [self.calls.pk]).status_code, 403)
            self.assertEqual(self.put(self.member, self.work, date(2026, 11, 1), [self.calls.pk]).status_code, 200)

    def test_kpi_week_screen(self):
        r = self.api(self.member).get("/api/team/kpi-week/?week=2026-10-27").data      # a Tuesday: the week of Sat 24 Oct
        self.assertEqual((str(r["week_start"]), r["week_no"], r["counts_in_month"]), ("2026-10-24", 44, "2026-10"))
        rows = {x["name"]: x for x in r["rows"]}
        self.assertNotIn("Planning - Member", rows)                                   # plans have no KPIs
        self.assertTrue(rows["Member"]["editable"] and rows["Member"]["mine"])
        self.assertFalse(rows["Team D"]["editable"])
        last = self.api(self.member).get("/api/team/kpi-week/?week=2026-10-17").data
        self.assertIn("Only this week", next(x for x in last["rows"] if x["name"] == "Member")["blocked"])
        self.assertTrue(all(x["editable"] for x in self.api(self.admin).get("/api/team/kpi-week/?week=2026-10-17").data["rows"]))

    def test_excel_download_matches_the_app(self):
        from io import BytesIO

        from openpyxl import load_workbook
        SheetEntry.objects.create(sheet=self.work, day=date(2026, 10, 25), slots=[self.calls.pk, self.demo.pk], remarks="client visit")
        SheetEntry.objects.create(sheet=self.work, day=date(2026, 10, 27), slots=[self.calls.pk] * 3)
        KpiEntry.objects.create(sheet=self.work, week_start=WEEK, leads=4, opps=2, clients=1, revenue=25000)
        r = self.api(self.viewer).get("/api/team/export/?year=2026")
        self.assertEqual(r.status_code, 200)
        self.assertIn("attachment", r["Content-Disposition"])
        wb = load_workbook(BytesIO(r.content))
        self.assertEqual(wb.sheetnames[:1] + wb.sheetnames[-3:], ["Dashboard", "KPI_Weekly_Input", "Monthly Performance", "CONFIG"])
        ws = wb["Member"]
        row = next(r for r in ws.iter_rows(min_row=5, values_only=True) if r[0] and r[0].date() == date(2026, 10, 25))
        self.assertEqual(row[2:4], ("Make 8 Cold Calls", "Demo & Presentation Session"))
        self.assertEqual(row[12:19], ("client visit", 2, 11, 44, 10, 5, 14))          # remarks, hours, points, wk, mo, week hrs, month pts
        self.assertEqual(len(list(ws.iter_rows(min_row=5))), 365)                      # every day of the year, like the original
        dash = {r[0]: r for r in wb["Dashboard"].iter_rows(min_row=5, values_only=True)}
        self.assertEqual(dash["Member"][3:5], (5, 14))
        kpi = list(wb["KPI_Weekly_Input"].iter_rows(min_row=4, values_only=True))[0]
        self.assertEqual((kpi[0], kpi[2], kpi[4], kpi[7]), ("Member", 44, 4, 25000))
        one = load_workbook(BytesIO(self.api(self.viewer).get(f"/api/team/export/?year=2026&sheet={self.work.pk}").content))
        self.assertNotIn("Team D", one.sheetnames)

    def test_today_endpoint(self):
        r = self.api(self.member).get("/api/team/today/").data
        self.assertEqual((r["today"], r["week_start"], r["seconds_to_lock"]), (TODAY, WEEK, 14 * 3600))
        self.assertEqual({s["name"] for s in r["my_sheets"]}, {"Member", "Planning - Member"})


def dsl_workbook():
    """A small workbook in the Team Operation Sheet layout."""
    from io import BytesIO

    from openpyxl import Workbook
    from openpyxl.worksheet.datavalidation import DataValidation
    wb = Workbook()
    c = wb.active
    c.title = "CONFIG"
    c.append(["CONFIG"]); c.append(["targets"]); c.append(["Short Name"])
    c.append(["Pranto", "Foysal Ahmed Pranto", "International Sales (AI)", datetime(2026, 10, 1), 35, 300, 30, 15, 5, 100000])
    c.append(["Shohan", "Shohanur Rahaman", "National Sales (Tender)", datetime(2026, 6, 1), 40, 300, 15, 6, 2, 200000])
    for col, w in zip("BCDE", ([0.2, 0.05, 0.15, 0.1, 0.1, 0.4], [0.2, 0.05, 0.1, 0.15, 0.1, 0.4], [0.2, 0.05, 0.2, 0.15, 0.1, 0.3], [0.2, 0.1, 0.7, 0, 0, 0])):
        for i, v in enumerate(w):
            c[f"{col}{11 + i}"] = v
    for col, title in zip("HIJK", ["🟦 National Sales (Tender)\n(Edit)", "🟩 International Sales (Product)\n(Edit)", "🟧 International Sales (AI)\n(Edit)", "🟥 Marketing\n(Edit)"]):
        c[f"{col}20"] = title
    rows = [("Cold Client Calling", "Make 8 Cold Calls", 2),            # points changed from 1 to 2
            ("Client Meeting", "Demo & Presentation Session", 10),
            ("Product Management", "Market Research", 5)]
    for i, (typ, name, pts) in enumerate(rows):
        c[f"A{21 + i}"], c[f"C{21 + i}"], c[f"D{21 + i}"] = typ, name, pts
        c[f"J{21 + i}"] = name                                           # the AI role's dropdown list
        c[f"H{21 + i}"] = name if i < 2 else None
    for tab, col in (("Pranto", "J"), ("Planning - Pranto", "J"), ("Shohan", "H")):
        ws = wb.create_sheet(tab)
        for _ in range(4):
            ws.append([tab])
        dv = DataValidation(type="list", formula1=f"CONFIG!${col}$21:${col}$100")
        ws.add_data_validation(dv)
        dv.add("C5:L369")
    p = wb["Pranto"]
    p.append([datetime(2026, 10, 4), "Sun", "Make 8 Cold Calls", "market research", "Demo & Presentation Session"])   # 3 h, 2+5+10 pts
    p.append([datetime(2026, 10, 5), "Mon", "Visited the bank"])                                                      # unknown task: 1 h, 0 pts
    p.append([datetime(2026, 10, 6), "Tue"] + [None] * 10 + ["Sick Leave"])                                           # remark only: 0 h
    p.append([datetime(2026, 10, 7), "Wed"])                                                                          # empty: skipped
    wb["Planning - Pranto"].append([datetime(2026, 10, 8), "Thu", "Market Research"])
    k = wb.create_sheet("KPI_Weekly_Input")
    k.append(["KPI"]); k.append(["help"]); k.append(["Employee"])
    k.append(["Pranto", None, 41, 10, 3, 1, 0, 50000, "first week of October"])   # week 41 of 2026 starts Sat 3 Oct
    k.append(["Pranto", None, 42, 10, None, None, None, None, None])               # nothing entered: skipped
    k.append(["Nobody", None, 41, 10, 1, 0, 0, 0, None])                           # no such sheet
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


class ImportTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user("admin@x.com", name="Admin", status="approved", role="admin")
        cls.me = User.objects.create_user("pranto@x.com", name="Foysal Ahmed Pranto", status="approved", role="member")

    def upload(self, user, check=False, f=None):
        c = APIClient()
        c.force_authenticate(user)
        f = f or dsl_workbook()
        f.name = "Team Operation Sheet.xlsx"
        return c.post("/api/team/import/", {"file": f, "check": "1" if check else "0"}, format="multipart")

    def test_check_only_saves_nothing(self):
        r = self.upload(self.admin, check=True)
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(r.data["dry_run"])
        self.assertEqual(Sheet.objects.count(), 0)
        self.assertEqual(Task.objects.get(name="Make 8 Cold Calls").points, 1)

    def test_import_reads_the_workbook_like_the_sheet(self):
        r = self.upload(self.admin)
        self.assertEqual(r.status_code, 200, r.data)
        pranto = Sheet.objects.get(name="Pranto")
        self.assertEqual((pranto.role.name, pranto.owner, pranto.person, pranto.start_date), ("International Sales (AI)", self.me, "Foysal Ahmed Pranto", date(2026, 10, 1)))
        self.assertEqual((float(pranto.target_hours), float(pranto.target_revenue)), (35, 100000))
        self.assertEqual(Sheet.objects.get(name="Shohan").role.name, "National Sales (Tender)")
        self.assertIsNone(Sheet.objects.get(name="Shohan").owner)                     # no account with that name yet
        self.assertEqual(Sheet.objects.get(name="Planning - Pranto").kind, "plan")
        self.assertEqual(Task.objects.get(name="Make 8 Cold Calls").points, 2)        # CONFIG points win
        role = JobRole.objects.get(name="International Sales (AI)")
        self.assertEqual(role.weights, {"hours": 20, "points": 5, "leads": 20, "opps": 15, "clients": 10, "revenue": 30})
        self.assertEqual(set(role.tasks.values_list("name", flat=True)), {"Make 8 Cold Calls", "Demo & Presentation Session", "Market Research"})
        row = next(s for s in r.data["sheets"] if s["name"] == "Pranto")
        self.assertEqual((row["days"], row["hours"], row["points"], row["leave_only_days"]), (3, 4, 17.0, 1))
        bank = Task.objects.get(name="Visited the bank")
        self.assertEqual((bank.active, float(bank.points)), (False, 0))              # hour kept, no points
        kpi = KpiEntry.objects.get(sheet=pranto)
        self.assertEqual((kpi.week_start, kpi.leads, kpi.opps, int(kpi.revenue), kpi.notes), (date(2026, 10, 3), 3, 1, 50000, "first week of October"))
        self.assertTrue(any("Nobody" in w for w in r.data["warnings"]))
        totals = services.sheet_summary(pranto, date(2026, 10, 1), date(2026, 10, 31))["totals"]
        self.assertEqual(totals, {"hours": 4, "points": 17.0})                     # same numbers on the Sheets page

    def test_importing_twice_updates_instead_of_copying(self):
        self.upload(self.admin)
        self.upload(self.admin)
        self.assertEqual(Sheet.objects.filter(name="Pranto").count(), 1)
        self.assertEqual(SheetEntry.objects.filter(sheet__name="Pranto").count(), 3)
        self.assertEqual(KpiEntry.objects.count(), 1)

    def test_admins_only_and_wrong_files(self):
        self.assertEqual(self.upload(self.me).status_code, 403)
        from io import BytesIO
        bad = BytesIO(b"not a workbook")
        self.assertEqual(self.upload(self.admin, f=bad).status_code, 400)


class DeleteAndReplaceTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user("admin@x.com", name="Admin", status="approved", role="admin")
        cls.member = User.objects.create_user("pranto@x.com", name="Foysal Ahmed Pranto", status="approved", role="member")

    def api(self, u):
        c = APIClient()
        c.force_authenticate(u)
        return c

    def test_delete_one_sheet_and_everything(self):
        s = Sheet.objects.create(name="Old")
        SheetEntry.objects.create(sheet=s, day=date(2026, 10, 1), slots=[Task.objects.first().pk])
        self.assertEqual(self.api(self.member).delete(f"/api/team/sheets/{s.pk}/").status_code, 403)
        self.assertEqual(self.api(self.admin).delete(f"/api/team/sheets/{s.pk}/").status_code, 204)
        self.assertFalse(SheetEntry.objects.exists())
        self.assertTrue(AuditLog.objects.filter(action="sheet.delete", flagged=True).exists())
        Sheet.objects.create(name="A")
        self.assertEqual(self.api(self.member).post("/api/team/reset/", {"confirm": "DELETE"}, format="json").status_code, 403)
        self.assertEqual(self.api(self.admin).post("/api/team/reset/", {"confirm": "yes"}, format="json").status_code, 400)
        r = self.api(self.admin).post("/api/team/reset/", {"confirm": "DELETE"}, format="json")
        self.assertEqual((r.status_code, r.data["sheets"], Sheet.objects.count()), (200, 1, 0))
        self.assertTrue(Task.objects.exists() and JobRole.objects.exists())          # setup lists stay

    def test_import_can_replace_everything(self):
        Sheet.objects.create(name="Not in the workbook")
        f = dsl_workbook()
        f.name = "x.xlsx"
        check = self.api(self.admin).post("/api/team/import/", {"file": f, "check": "1", "replace": "1"}, format="multipart")
        self.assertEqual(check.data["replaced"]["sheets"], 1)
        self.assertTrue(Sheet.objects.filter(name="Not in the workbook").exists())   # a check changes nothing
        f = dsl_workbook()
        f.name = "x.xlsx"
        self.api(self.admin).post("/api/team/import/", {"file": f, "replace": "1"}, format="multipart")
        self.assertFalse(Sheet.objects.filter(name="Not in the workbook").exists())
        self.assertTrue(Sheet.objects.filter(name="Pranto").exists())


class BackupAndGapTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user("admin@x.com", name="Admin", status="approved", role="admin")
        cls.member = User.objects.create_user("pranto@x.com", name="Foysal Ahmed Pranto", status="approved", role="member")
        Backup.objects.all().delete()   # the test database copies any backup files on this machine when it is created

    def api(self, u):
        c = APIClient()
        c.force_authenticate(u)
        return c

    def test_deleting_a_sheet_leaves_a_backup_that_restores_it(self):
        s = Sheet.objects.create(name="Pranto", owner=self.member, start_date=date(2026, 10, 1))
        SheetEntry.objects.create(sheet=s, day=date(2026, 10, 1), slots=[Task.objects.first().pk], remarks="kept")
        KpiEntry.objects.create(sheet=s, week_start=date(2026, 10, 3), leads=2, revenue=Decimal("1500"))
        self.assertEqual(self.api(self.admin).delete(f"/api/team/sheets/{s.pk}/").status_code, 204)
        self.assertEqual(self.api(self.member).get("/api/team/snapshots/").status_code, 403)
        backups = self.api(self.admin).get("/api/team/snapshots/").data
        self.assertEqual((len(backups), backups[0]["sheets"], backups[0]["days"], backups[0]["kpi_weeks"]), (1, 1, 1, 1))
        name = backups[0]["name"]
        self.assertEqual(self.api(self.admin).post(f"/api/team/snapshots/{name}/restore/", {"confirm": "yes"}, format="json").status_code, 400)
        self.assertEqual(self.api(self.admin).post(f"/api/team/snapshots/{name}/restore/", {"confirm": "RESTORE"}, format="json").status_code, 200)
        restored = Sheet.objects.get(name="Pranto")
        self.assertEqual(restored.owner, self.member)
        self.assertEqual(restored.entries.get().remarks, "kept")
        self.assertEqual(restored.kpis.get().revenue, Decimal("1500"))
        self.assertEqual(len(self.api(self.admin).get("/api/team/snapshots/").data), 2)   # the restore backed up what was there first

    def test_import_replace_and_delete_all_leave_backups(self):
        Sheet.objects.create(name="Not in the workbook")
        f = dsl_workbook()
        f.name = "x.xlsx"
        self.api(self.admin).post("/api/team/import/", {"file": f, "check": "1", "replace": "1"}, format="multipart")
        self.assertEqual(self.api(self.admin).get("/api/team/snapshots/").data, [])   # a check writes no backup
        f = dsl_workbook()
        f.name = "x.xlsx"
        self.api(self.admin).post("/api/team/import/", {"file": f, "replace": "1"}, format="multipart")
        self.assertIn("before replacing with the workbook", [b["reason"] for b in self.api(self.admin).get("/api/team/snapshots/").data])
        r = self.api(self.admin).post("/api/team/reset/", {"confirm": "DELETE"}, format="json")
        self.assertTrue(r.data["backup"].endswith("-before-deleting-all-team-data.json"))

    def test_backups_live_in_the_database_and_only_the_newest_are_kept(self):
        Sheet.objects.create(name="Kept")
        with mock.patch.object(snapshots, "KEEP", 2):
            names = [snapshots.take(f"backup {i}") for i in range(3)]
        self.assertEqual([b["name"] for b in snapshots.list_backups()], names[:0:-1])   # newest first; the oldest was dropped
        r = self.api(self.admin).get(f"/api/team/snapshots/{names[-1]}/")
        self.assertEqual((r.status_code, r["Content-Type"]), (200, "application/json"))
        self.assertEqual(json.loads(r.content)["sheets"][0]["name"], "Kept")
        self.assertEqual(self.api(self.admin).get(f"/api/team/snapshots/{names[0]}/").status_code, 404)

    def test_gaps_flag_completed_weeks_without_results(self):
        s = Sheet.objects.create(name="Pranto", owner=self.member, start_date=date(2026, 10, 1))
        KpiEntry.objects.create(sheet=s, week_start=date(2026, 10, 3), leads=2)
        KpiEntry.objects.create(sheet=s, week_start=date(2026, 10, 10))   # all zero: not entered
        self.assertEqual(services.missing_results(TODAY), [
            {"sheet": s.pk, "person": "Pranto", "weeks": ["2026-09-26", "2026-10-10", "2026-10-17"]}])   # the week of 24 Oct is not over yet
        self.assertEqual(services.missing_results(TODAY, owner_id=self.admin.pk), [])
        self.assertIn("gaps", self.api(self.member).get("/api/team/dashboard/").data)


class CountsInTests(TestCase):
    """A week counts in the month the workbook gives it; a week without one counts in the month holding most of its days."""

    def test_the_workbook_month_decides_where_a_week_counts(self):
        s = Sheet.objects.create(name="Pranto", start_date=date(2026, 9, 1))
        KpiEntry.objects.create(sheet=s, week_start=date(2026, 9, 26), leads=3, counts_in="2026-10")   # the week runs Sep 26 to Oct 2
        KpiEntry.objects.create(sheet=s, week_start=date(2026, 10, 3), leads=1)
        _, rows = services.dashboard_rows(TODAY)
        self.assertEqual(next(r for r in rows if r["id"] == s.pk)["kpi_month"]["leads"], 4)
        self.assertEqual(calc.month_for_number(date(2026, 12, 27), 1), "2027-01")   # a week that runs into the next year
        self.assertEqual(calc.month_for_number(date(2026, 1, 3), 12), "2025-12")

    def test_the_workbook_month_is_kept_in_backups(self):
        s = Sheet.objects.create(name="Pranto")
        KpiEntry.objects.create(sheet=s, week_start=date(2026, 9, 26), leads=3, counts_in="2026-10")
        data = snapshots._sheet_data(s)
        self.assertEqual(data["kpis"][0]["counts_in"], "2026-10")


class LinkSheetsTests(TestCase):
    """Imported sheets carry the person's name; approving that person links them automatically."""

    def test_approval_links_sheets_with_the_same_name(self):
        from accounts import services as acc
        admin = User.objects.create_user("a@x.com", name="Admin", status="approved", role="admin")
        orin = User.objects.create_user("orin@x.com", name="orin tasfia", status="pending")
        work = Sheet.objects.create(name="Orin", person="Orin Tasfia")
        plan = Sheet.objects.create(name="Planning - Orin", kind="plan", person="Orin Tasfia")
        taken = Sheet.objects.create(name="Orin old", person="Orin Tasfia", owner=admin)
        other = Sheet.objects.create(name="Shohan", person="Shohanur Rahaman")
        c = APIClient()
        c.force_authenticate(admin)
        r = c.post(f"/api/admin/users/{orin.pk}/approve/", {"role": "member"}, format="json")
        self.assertEqual(sorted(r.data["linked_sheets"]), ["Orin", "Planning - Orin"])
        self.assertEqual([Sheet.objects.get(pk=s.pk).owner for s in (work, plan, taken, other)], [orin, orin, admin, None])
        viewer = User.objects.create_user("s@x.com", name="Shohanur Rahaman", status="pending")
        self.assertEqual(acc.approve(viewer, admin, "viewer").linked_sheets, [])       # viewers don't fill in sheets

    def test_sign_in_links_a_sheet_created_later(self):
        from accounts import services as acc
        me = User.objects.create_user("p@x.com", name="Foysal Ahmed Pranto", status="approved", role="admin", google_sub="g1")
        s = Sheet.objects.create(name="Pranto", person="Foysal Ahmed Pranto")
        acc.sign_in_with_google({"sub": "g1", "email": "p@x.com", "name": "Foysal Ahmed Pranto", "picture": ""})
        self.assertEqual(Sheet.objects.get(pk=s.pk).owner, me)


class CalcTests(TestCase):
    cfg = calc.Cfg()

    def test_week_numbers_and_months(self):
        self.assertEqual(calc.week_no(date(2025, 12, 27), self.cfg), (1, 2026))   # New Year week is week 1
        self.assertEqual(calc.week_no(date(2026, 10, 24), self.cfg), (44, 2026))   # same as the sheet's Wk# column
        self.assertEqual(calc.month_of_week(date(2026, 5, 30)), (2026, 6))         # most of that week is in June
        self.assertAlmostEqual(calc.months_between(date(2026, 10, 15), date(2026, 11, 30)), 17 / 31 + 1)

    def test_time_zone_boundary(self):
        self.assertEqual(calc.today_in("Asia/Dhaka", datetime(2026, 10, 28, 18, 30, tzinfo=tz.utc)), date(2026, 10, 29))
        self.assertEqual(calc.today_in("Asia/Dhaka", datetime(2026, 10, 28, 17, 59, tzinfo=tz.utc)), date(2026, 10, 28))
        self.assertEqual(calc.seconds_to_midnight("Asia/Dhaka", datetime(2026, 10, 28, 17, 0, tzinfo=tz.utc)), 3600)

    def test_pace_and_weekend(self):
        self.assertEqual(calc.pace_of(10, 40, 2, 6)["key"], "behind")   # expected 13.3 by now; 10 is 75%
        self.assertEqual(calc.pace_of(12, 40, 2, 6)["key"], "near")
        self.assertEqual(calc.pace_of(40, 40, 1, 6)["key"], "met")
        friday = [calc.Day(date(2026, 10, 30), [1])]
        self.assertEqual(calc.totals(friday, WEEK, WEEK + timedelta(days=6), calc.Cfg(count_weekend=False), {1: 1})[0], 0)
        self.assertEqual(calc.totals(friday, WEEK, WEEK + timedelta(days=6), self.cfg, {1: 1})[0], 1)

    def test_average_uses_completed_weeks_only(self):
        e = [calc.Day(date(2026, 10, 10), [1] * 7), calc.Day(date(2026, 10, 24), [1] * 2)]   # 7 h in week 41, 2 h this week
        d = calc.dashboard({"hours": 40, "points": 100, "leads": 0, "opps": 0, "clients": 0, "revenue": 0, "start": date(2026, 10, 10)},
                           e, [], self.cfg, {1: 1}, date(2026, 10, 24))
        self.assertEqual(d["avg_week_hours"], 3.5)    # 7 h over the two completed weeks 10–23 Oct
