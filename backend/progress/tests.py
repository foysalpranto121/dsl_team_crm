"""SRS v0.5 §5.9 Weekly Review (FR-WR1, FR-WR2, FR-CL2), My Progress (FR-MO1, FR-MO7, FR-G2) and the AI Coach's reading of the numbers (FR-AC2–AC6)."""
from datetime import date, datetime
from datetime import timezone as tz
from unittest import mock

from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from accounts.models import User
from core.models import AuditLog
from team import planning
from team import services as team_services
from team.models import JobRole, KpiEntry, Sheet, SheetEntry, Task, TeamSettings, WeekPlan
from tracker.models import Prospect

from . import calc as pc

NOW = datetime(2026, 11, 5, 6, 0, tzinfo=tz.utc)   # Thu 5 Nov 2026, noon in Dhaka; weeks run Sat–Fri, Friday off, so Thursday is the last working day
TODAY, WEEK, NEXT_WEEK = date(2026, 11, 5), date(2026, 10, 31), date(2026, 11, 7)
REC = {"requirement": "ERP for 40 users", "next_action": "Send the brochure", "next_follow_up": "2026-11-10"}


class CalcTests(SimpleTestCase):
    def test_projection_has_a_range_from_how_the_weeks_vary(self):
        self.assertIsNone(pc.project(5, 0, 20, [1, 2], 5))
        self.assertEqual(pc.project(10, 5, 20, [], 5), {"mid": 40.0, "low": 40.0, "high": 40.0})
        got = pc.project(10, 5, 20, [2, 4, 6, 8], 5)
        self.assertEqual(got["mid"], 40.0)
        self.assertLess(got["low"], 40)
        self.assertGreater(got["high"], 40)
        self.assertGreaterEqual(pc.project(10, 5, 20, [0, 100], 5)["low"], 10)      # never under what's already done

    def test_forecast_finds_the_fewest_more_of_one_kpi(self):
        metrics = [{"key": "leads", "one": "qualified lead", "many": "qualified leads", "weight": 15, "target": 20}, {"key": "clients", "one": "client", "many": "clients", "weight": 10, "target": 2},
                   {"key": "opps", "one": "opportunity", "many": "opportunities", "weight": 0, "target": 8}]
        got = pc.to_full_score(0.9, metrics)
        self.assertEqual((got["key"], got["units"], got["text"]), ("clients", 2, "Two more clients get you to 100%."))
        self.assertEqual(pc.to_full_score(0.95, metrics)["text"], "One more client gets you to 100%.")
        self.assertIsNone(pc.to_full_score(1.0, metrics))
        far = pc.to_full_score(0.31, metrics)                         # 14 more clients isn't a useful thing to say: what one more would add is
        self.assertEqual((far["key"], far["units"], far["text"]), ("clients", 1, "One more client adds 5% to your score."))
        self.assertIsNone(pc.to_full_score(None, metrics))

    def test_catch_up_chain_and_money(self):
        self.assertEqual(pc.catch_up(5_000_000, 1_250_000, 0, 0, 0.4, 0.4, 6), {"clients": 4, "opps": 10, "leads": 25, "calls": 150})   # the SRS's own example
        self.assertEqual(pc.catch_up(0, None, 0, 3, 0.4, 0.4, None), {"clients": 0, "opps": 0, "leads": 3, "calls": 0})
        self.assertEqual((pc.money(5_000_000), pc.money(25_000_000), pc.money(90_000)), ("BDT 50 lakh", "BDT 2.5 crore", "BDT 90,000"))
        self.assertEqual((pc.calls_in("Make 8 Cold Calls"), pc.calls_in("Demo Session"), pc.plural(1, "client"), pc.plural(2, "opportunity", "opportunities")), (8, 0, "1 client", "2 opportunities"))

    def test_quality_flags_never_blame_just_ask(self):
        d = lambda n, slots, remarks, pts=1: {"day": date(2026, 10, n), "slots": slots, "remarks": remarks, "points": pts}  # noqa: E731
        kinds = [f["kind"] for f in pc.quality_flags([d(1, [1, 2], "Called the list"), d(2, [1, 2], "Called the list"), d(3, [1, 2], "Called the list"), d(4, [3], "x")])]
        self.assertEqual(kinds, ["copied"])
        self.assertEqual([f["kind"] for f in pc.quality_flags([d(1, [1], "ok"), d(2, [2], "fine"), d(3, [3], "done")])], ["vague"])
        days = [d(n, [n], "", 2) for n in range(1, 7)] + [d(9, [9], "", 40)]
        self.assertEqual([f["kind"] for f in pc.quality_flags(days)], ["spike"])
        self.assertEqual(pc.quality_flags([]), [])


class ProgressTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        mk = lambda e, role: User.objects.create_user(e, name=e.split("@")[0].title(), status="approved", role=role)  # noqa: E731
        cls.member, cls.other, cls.sup, cls.boss = mk("mina@x.com", "member"), mk("rafi@x.com", "member"), mk("sup@x.com", "supervisor"), mk("boss@x.com", "viewer")
        st = TeamSettings.load()
        st.weekend_days = [5]
        st.save()
        cls.role = JobRole.objects.get(name="International Sales (AI)")
        cls.calls = Task.objects.get(name="Make 8 Cold Calls")
        cls.demo = Task.objects.get(name="Demo & Presentation Session")
        cls.work = Sheet.objects.create(name="Mina", person="Mina", owner=cls.member, role=cls.role, target_hours=40, target_points=100, target_leads=4, target_opps=2, target_clients=1, target_revenue=1000000, start_date=date(2026, 1, 1))
        cls.rafi = Sheet.objects.create(name="Rafi", person="Rafi", owner=cls.other, role=cls.role, target_hours=40, target_points=100, start_date=date(2026, 1, 1))

    def setUp(self):
        for p in (mock.patch.object(team_services, "now", return_value=NOW), mock.patch("django.utils.timezone.now", return_value=NOW)):
            p.start()
            self.addCleanup(p.stop)

    def api(self, u=None):
        c = APIClient()
        c.force_authenticate(u or self.member)
        return c

    def add(self, company="Walton", **body):
        r = self.api().post("/api/tracker/prospects/", {"company": company, **REC, **body}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        return r.data

    def act(self, **body):
        return self.api().post("/api/progress/review/", body, format="json")

    def test_the_weekly_review_from_start_to_submit(self):
        p = self.add("Walton", stage="qualified")                     # counts one qualified lead this week
        self.api().post(f"/api/tracker/prospects/{p['id']}/log/", {"type": "call", "outcome": "Asked for a quote"}, format="json")
        d = self.api().get("/api/progress/review/").data
        self.assertEqual((d["week_start"], d["kpi"]["numbers"]["leads"], d["kpi"]["derived"], d["steps"]), (WEEK, 1, True, {"kpi": False, "deals": False, "focus": False, "plan": False}))
        deal = d["deals"][0]                                          # FR-CL2: compiled from the week's log entries
        self.assertEqual((deal["company"], deal["stage"]), ("Walton", "Qualified Lead"))
        self.assertIn("1 contact · Last outcome: Asked for a quote", deal["summary"])
        self.assertEqual(d["focus_options"][0][:3], "Log")
        bad = self.act(action="submit")
        self.assertEqual(bad.status_code, 400)
        self.assertIn("the KPI numbers, the deal statuses, one focus, next week's plan", bad.data["detail"])
        self.assertTrue(self.act(action="confirm_kpi").data["steps"]["kpi"])
        self.assertTrue(self.act(action="confirm_deals").data["steps"]["deals"])
        self.assertEqual(self.act(action="focus", focus="x").status_code, 400)
        self.assertEqual(self.act(action="focus", focus="Get the Walton quote out").data["focus"], "Get the Walton quote out")
        self.assertEqual(self.act(action="submit_plan").status_code, 400)        # nothing planned next week yet
        plan_sheet = planning.plan_sheet_for(self.work, create=True)
        SheetEntry.objects.create(sheet=plan_sheet, day=NEXT_WEEK, slots=[self.calls.pk, self.calls.pk])
        d = self.act(action="submit_plan").data
        self.assertEqual((d["next_plan"]["sent_hours"], d["next_plan"]["status"], d["ready"]), (2, "submitted", True))
        d = self.act(action="submit").data
        self.assertIsNotNone(d["submitted_at"])
        self.assertTrue(AuditLog.objects.filter(action="review.submit").exists())
        self.assertEqual(WeekPlan.objects.get(sheet=plan_sheet, week_start=NEXT_WEEK).status, "submitted")
        # a change after confirming asks for confirmation again (the numbers moved)
        self.api().patch(f"/api/tracker/prospects/{p['id']}/", {"stage": "requirements"}, format="json")
        self.assertFalse(self.api().get("/api/progress/review/").data["steps"]["kpi"])
        # FR-WR2: the team's review, from the same data
        t = self.api(self.sup).get("/api/progress/team-review/").data
        row = next(r for r in t["rows"] if r["person"] == "Mina")
        self.assertEqual((row["reviewed"], row["focus"], row["plan_sent"], row["deals_touched"], row["leads"], row["opps"]), (True, "Get the Walton quote out", True, 1, 1, 1))
        self.assertEqual((t["reviewed"], t["plans_sent"]), (1, 1))
        self.assertEqual(self.api().get("/api/progress/team-review/").status_code, 403)
        self.assertEqual(self.api(self.boss).get("/api/progress/team-review/").status_code, 200)
        self.assertEqual(self.api(self.sup).post("/api/progress/review/", {"action": "focus", "focus": "abc"}, format="json").status_code, 400)   # no daily log of their own
        self.assertEqual(self.api(self.other).get(f"/api/progress/review/?work={self.work.pk}").status_code, 403)

    def test_recap_finds_what_went_well(self):
        SheetEntry.objects.create(sheet=self.work, day=date(2026, 10, 26), slots=[self.calls.pk])          # the week before
        SheetEntry.objects.create(sheet=self.work, day=date(2026, 11, 1), slots=[self.calls.pk, self.calls.pk])
        SheetEntry.objects.create(sheet=self.work, day=date(2026, 11, 2), slots=[self.demo.pk])
        r = self.api().get("/api/progress/review/").data["recap"]
        self.assertEqual((r["hours"], r["points"], r["hours_before"], r["best_day"]["day"], r["best_day"]["points"]), (3, 12, 1, date(2026, 11, 2), 10))
        self.assertIn("2 more output hours than the week before", r["improved"])
        self.assertIn("11 more points than the week before", r["improved"])

    def test_my_progress_rings_gaps_forecast_and_coach(self):
        SheetEntry.objects.create(sheet=self.work, day=date(2026, 11, 1), slots=[self.calls.pk] * 8)
        SheetEntry.objects.create(sheet=self.work, day=TODAY, slots=[self.calls.pk, self.demo.pk])
        KpiEntry.objects.create(sheet=self.work, week_start=date(2026, 10, 24), leads=1, source="typed")
        d = self.api().get("/api/progress/me/").data
        self.assertEqual((d["person"], d["rings"]["day"]["value"], d["rings"]["week"]["value"], d["rings"]["week"]["target"], d["rings"]["month"]["value"]), ("Mina", 2, 10, 40, 19))
        m = {x["key"]: x for x in d["metrics"]}
        self.assertEqual(m["hours"]["gap"], "You need 30 output hours this week.")       # Thursday is the last working day
        self.assertEqual(m["leads"]["gap"], "You need 4 qualified leads this month.")
        self.assertEqual(m["leads"]["action"]["to"], "/tracker?tab=pipeline")
        self.assertEqual(m["hours"]["action"]["label"], "Plan Make 8 Cold Calls slots")   # FR-G2
        self.assertTrue(m["points"]["means"])
        self.assertEqual(m["points"]["projected"]["mid"], 98.8)    # 19 points in 5 of 26 working days (Fridays off)
        self.assertLessEqual(m["points"]["projected"]["low"], m["points"]["projected"]["mid"])
        self.assertIn("more", d["forecast"]["text"])                  # FR-MO1
        self.assertIn("Your biggest gap is", d["biggest_gap"]["text"])
        self.assertIn(" ← ", d["catch_up"]["text"])                   # FR-AC2
        self.assertIn("default rates", d["catch_up"]["basis"])
        a = d["analysis"]                                             # FR-AC3
        self.assertEqual((a["hours"], a["points"], a["points_per_hour"], a["logged_hours"], a["deviations"]), (10, 19, 1.9, 10, 0))
        self.assertEqual(a["mix"][0]["category"], self.calls.type)
        self.assertEqual(a["calls"], 72)
        self.assertEqual(self.api(self.other).get(f"/api/progress/me/?work={self.work.pk}").status_code, 403)    # D9
        self.assertEqual(self.api(self.sup).get(f"/api/progress/me/?work={self.work.pk}").data["person"], "Mina")
        self.assertEqual(self.api(self.sup).get("/api/progress/me/").status_code, 400)    # no daily log of their own
        # FR-AC8: the off switch takes the coach away and leaves everything else
        self.api(User.objects.create_user("a@x.com", name="A", status="approved", role="admin")).patch("/api/team/settings/", {"playbook": {"sources": {"suggested": False}}}, format="json")
        off = self.api().get("/api/progress/me/").data
        self.assertEqual((off["coach"], off["catch_up"], off["analysis"], off["suggested"]), (False, None, None, []))
        self.assertEqual(off["rings"]["week"]["value"], 10)
        self.assertIsNone(self.api(self.sup).get("/api/progress/brief/").data)

    def test_the_morning_brief_and_a_records_coach(self):
        p = self.add("Walton", stage="qualified", segment="Tender")
        Prospect.objects.filter(pk=p["id"]).update(stage_since=date(2026, 9, 1))
        SheetEntry.objects.create(sheet=self.work, day=date(2026, 11, 4), slots=[self.calls.pk, self.calls.pk])
        self.assertEqual(self.api().get("/api/progress/brief/").status_code, 403)
        b = self.api(self.sup).get("/api/progress/brief/").data
        mina = next(x for x in b["members"] if x["person"] == "Mina")
        self.assertEqual(mina["lines"][0]["text"], "Wednesday: 2 output hours, 2 points.")     # FR-AC6
        self.assertLessEqual(len(mina["lines"]), 5)
        self.assertIn("1 deal past the usual time", " ".join(x["text"] for x in mina["lines"]))
        self.assertLessEqual(len(b["actions"]), 3)
        self.assertTrue(all(x["to"].startswith("/") for x in b["actions"]))                     # each linked to its source
        # FR-AC4: next best action, last contact, days in stage, similar past wins and losses (a teammate's stays anonymous)
        Prospect.objects.create(owner=self.other, company="Secret Ltd", requirement="x", stage="lost", stage_since=date(2026, 5, 1), segment="Tender", win_loss_why="Lost on price", lost_reason="Price")
        c = self.api().get(f"/api/progress/records/{p['id']}/coach/").data
        self.assertEqual((c["next"]["text"], c["days_in_stage"], c["stage"], c["similar"][0]["outcome"], c["similar"][0]["who"], c["similar"][0]["why"]),
                         ("Send the brochure", 65, "Qualified Lead", "Lost", "A teammate's deal", "Lost on price"))
        self.assertEqual(self.api(self.other).get(f"/api/progress/records/{p['id']}/coach/").status_code, 403)
