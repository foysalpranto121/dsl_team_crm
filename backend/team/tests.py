from datetime import date, datetime, timedelta
from datetime import timezone as tz
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from core.models import AuditLog

from . import calc, services
from .models import JobRole, KpiEntry, Sheet, SheetEntry, Task, TeamSettings

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

    def test_today_endpoint(self):
        r = self.api(self.member).get("/api/team/today/").data
        self.assertEqual((r["today"], r["week_start"], r["seconds_to_lock"]), (TODAY, WEEK, 14 * 3600))
        self.assertEqual({s["name"] for s in r["my_sheets"]}, {"Member", "Planning - Member"})


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
