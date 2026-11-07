from datetime import date, datetime
from datetime import timezone as tz
from io import StringIO
from unittest import mock

from django.core import mail
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import User
from core.models import Announcement, AuditLog
from team import services as team_services
from team.models import JobRole, KpiEntry, Sheet, SheetEntry, Task
from tracker.models import Prospect
from tracker.services import settings_for

from . import services
from .models import DigestLog
from core.features import switch_on

NOW = datetime(2026, 10, 29, 4, 0, tzinfo=tz.utc)   # Thu 29 Oct 2026, 10:00 in Dhaka. Week: Sat 24 – Fri 30, Friday off.
TODAY = date(2026, 10, 29)


class OpsTests(TestCase):
    """SRS v0.3 §14.9: morning huddle (FR-TM1) and weekly management digest (FR-TM4)."""

    @classmethod
    def setUpTestData(cls):
        switch_on("huddle", "digest", "renewals")   # V2 features are off by default (SRS v0.5 §0)
        mk = lambda email, role, name, status="approved": User.objects.create_user(email, name=name, status=status, role=role)
        cls.admin, cls.boss = mk("admin@x.com", "admin", "Admin"), mk("boss@x.com", "viewer", "Boss")
        cls.nadia, cls.arif = mk("nadia@x.com", "member", "Nadia Rahman"), mk("arif@x.com", "member", "Arif Hossain")
        mk("new@x.com", "member", "Newcomer", status="pending")
        cls.role = JobRole.objects.get(name="International Sales (AI)")
        cls.calls = Task.objects.get(name="Make 8 Cold Calls")             # 1 pt
        cls.demo = Task.objects.get(name="Demo & Presentation Session")    # 10 pts
        cls.order = Task.objects.get(name="Client Work Order Receiving")   # 100 pts, a win
        sheet = lambda name, owner, kind="work": Sheet.objects.create(
            name=name, owner=owner, kind=kind, role=cls.role, target_hours=35, target_points=300, target_leads=30, target_opps=15,
            target_clients=5, target_revenue=100000, start_date=date(2026, 10, 1))
        cls.s_nadia, cls.s_arif = sheet("Nadia", cls.nadia), sheet("Arif", cls.arif)
        cls.p_nadia = sheet("Planning - Nadia", cls.nadia, kind="plan")

    def setUp(self):
        cache.clear()   # throttle counts
        clock = mock.patch.object(team_services, "now", return_value=NOW)
        clock.start()
        self.addCleanup(clock.stop)

    def as_user(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    # ---------- huddle ----------

    def test_working_days_and_weeks(self):
        cfg = team_services.cfg_of(team_services.TeamSettings.load())
        self.assertEqual(services.previous_working_day(TODAY, cfg), date(2026, 10, 28))
        self.assertEqual(services.previous_working_day(date(2026, 10, 31), cfg), date(2026, 10, 29))   # Saturday looks back past Friday
        self.assertEqual(services.last_full_week(TODAY, cfg), date(2026, 10, 17))

    def test_huddle_yesterday_wins_and_shout_out(self):
        SheetEntry.objects.create(sheet=self.s_nadia, day=date(2026, 10, 28), slots=[self.order.pk, self.calls.pk, self.calls.pk], remarks="BRAC order")
        SheetEntry.objects.create(sheet=self.s_arif, day=date(2026, 10, 28), slots=[self.calls.pk] * 4)
        h = self.as_user(self.nadia).get("/api/ops/huddle/").json()
        y = h["yesterday"]
        self.assertEqual((y["day"], y["people"], y["logged"], y["hours"], y["points"], y["target_hours"]), ("2026-10-28", 2, 2, 7, 106, 11.67))
        self.assertEqual((y["shout_out"]["person"], y["shout_out"]["points"]), ("Nadia Rahman", 102))
        self.assertEqual([(w["person"], w["what"], w["details"]) for w in h["wins"]["items"]], [("Nadia Rahman", "Client Work Order Receiving", "BRAC order")])
        # A member sees only their own missing results, no stuck deals and no approval queue.
        a = h["attention"]
        self.assertEqual({g["person"] for g in a["missing_results"]}, {"Nadia"})
        self.assertEqual((a["pending_people"], a["stuck"]), (None, None))
        self.assertFalse(h["focus"]["can_set"])
        a = self.as_user(self.admin).get("/api/ops/huddle/").json()["attention"]
        self.assertEqual(a["pending_people"], 1)
        self.assertEqual({g["person"] for g in a["missing_results"]}, {"Nadia", "Arif"})

    def test_huddle_plan_coverage(self):
        SheetEntry.objects.create(sheet=self.p_nadia, day=TODAY, slots=[self.calls.pk, self.calls.pk, self.demo.pk, None])
        p = self.as_user(self.arif).get("/api/ops/huddle/").json()["plan"]
        self.assertEqual((p["people"], p["planned"], p["hours"], p["workday"]), (2, 1, 3, True))
        want = {}
        for t in (self.calls, self.calls, self.demo):
            want[t.type or "Other"] = want.get(t.type or "Other", 0) + 1
        self.assertEqual({x["type"]: x["hours"] for x in p["by_type"]}, want)

    def test_stuck_deals_come_only_from_shared_pipelines(self):
        st = settings_for(self.nadia)
        st.share_with_admins = True
        st.save()
        Prospect.objects.create(owner=self.nadia, company="Bangladesh Bank", stage="lead", next_follow_up=date(2026, 10, 20))
        Prospect.objects.create(owner=self.nadia, company="Walton", stage="opp", last_contacted=date(2026, 10, 1))
        Prospect.objects.create(owner=self.nadia, company="Fresh deal", stage="lead", next_follow_up=date(2026, 11, 2))
        Prospect.objects.create(owner=self.nadia, company="Signed", stage="client", next_follow_up=date(2026, 10, 1))
        Prospect.objects.create(owner=self.arif, company="Private", stage="lead", next_follow_up=date(2026, 10, 1))   # not shared
        stuck = self.as_user(self.admin).get("/api/ops/huddle/").json()["attention"]["stuck"]
        self.assertEqual([(d["company"], d["reason"]) for d in stuck["items"]],
                         [("Walton", "No contact for 28 days"), ("Bangladesh Bank", "Follow-up 9 days overdue")])
        self.assertEqual((stuck["total"], stuck["shared_pipelines"]), (2, 1))

    def test_one_focus_for_today(self):
        SheetEntry.objects.create(sheet=self.s_nadia, day=date(2026, 10, 27), slots=[self.demo.pk] * 3)
        f = self.as_user(self.admin).get("/api/ops/huddle/").json()["focus"]
        # Leads, opportunities, clients and revenue are all at zero; leads come first. 60 to go over Thu and Sat.
        self.assertEqual((f["suggested"]["metric"], f["suggested"]["text"]),
                         ("leads", "Qualified leads: 60 to go this month — about 30 each working day."))
        self.assertIsNone(f["current"])
        admin = self.as_user(self.admin)
        self.assertEqual(admin.post("/api/ops/huddle/focus/", {"text": "Hi"}, format="json").status_code, 400)
        self.assertEqual(self.as_user(self.nadia).post("/api/ops/huddle/focus/", {"text": "Call every lead"}, format="json").status_code, 403)
        self.assertEqual(admin.post("/api/ops/huddle/focus/", {"text": "Book two demos each"}, format="json").status_code, 201)
        self.assertEqual(admin.post("/api/ops/huddle/focus/", {"text": "Call every new lead before lunch"}, format="json").status_code, 201)
        posted = Announcement.objects.filter(title=services.FOCUS_TITLE)
        self.assertEqual([(a.body, a.pinned, a.expires_on) for a in posted], [("Call every new lead before lunch", True, TODAY)])   # replaced, not added
        self.assertEqual(self.as_user(self.nadia).get("/api/ops/huddle/").json()["focus"]["current"]["text"], "Call every new lead before lunch")
        self.assertIn("Call every new lead before lunch", [a["body"] for a in self.as_user(self.nadia).get("/api/announcements/").json()])
        self.assertTrue(AuditLog.objects.filter(action="huddle.focus").exists())

    # ---------- weekly digest ----------

    def week_of_oct_17(self):
        SheetEntry.objects.create(sheet=self.s_nadia, day=date(2026, 10, 18), slots=[self.demo.pk] * 4)    # 4 h, 40 pts
        SheetEntry.objects.create(sheet=self.s_arif, day=date(2026, 10, 20), slots=[self.order.pk])        # 1 h, a win
        KpiEntry.objects.create(sheet=self.s_nadia, week_start=date(2026, 10, 17), leads=3, opps=1, clients=1, revenue=50000)

    def test_digest_numbers_and_who_may_see_it(self):
        self.week_of_oct_17()
        r = self.as_user(self.admin).get("/api/ops/digest/").json()   # default: last finished week, Sat 17 – Fri 23 Oct
        d = r["data"]
        self.assertEqual((r["week_start"], d["week"]["end"]), ("2026-10-17", "2026-10-23"))
        self.assertEqual((d["week_totals"]["hours"], d["week_totals"]["target"], d["week_totals"]["leads"], d["week_totals"]["revenue"]), (5, 70, 3, 50000))
        self.assertEqual([(w["person"], w["what"]) for w in d["wins"]], [("Arif Hossain", "Client Work Order Receiving")])
        self.assertEqual({c["person"] for c in d["scorecards"]}, {"Nadia Rahman", "Arif Hossain"})
        risks = {x["person"]: x["why"] for x in d["risks"]}
        self.assertIn("no weekly results entered", risks["Arif Hossain"])
        self.assertNotIn("no weekly results entered", risks["Nadia Rahman"])
        self.assertEqual((d["funnel"]["leads"], d["funnel"]["opps"], d["funnel"]["clients"]), (3, 1, 1))
        self.assertIn("Nadia Rahman", r["html"])
        self.assertIn("Week ", r["subject"])
        self.assertEqual(r["recipients"], ["admin@x.com", "boss@x.com"])            # admins and management, approved only
        self.assertFalse(r["automatic"])
        self.assertEqual(self.as_user(self.boss).get("/api/ops/digest/").status_code, 200)
        self.assertEqual(self.as_user(self.nadia).get("/api/ops/digest/").status_code, 403)
        self.assertEqual(self.as_user(self.admin).get("/api/ops/digest/?week=2026-10-29").status_code, 400)   # not over yet

    def test_send_once_unless_sent_again(self):
        self.week_of_oct_17()
        admin = self.as_user(self.admin)
        self.assertEqual(self.as_user(self.boss).post("/api/ops/digest/send/", {}, format="json").status_code, 403)   # management reads, admins send
        r = admin.post("/api/ops/digest/send/", {}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(len(mail.outbox), 1)
        msg = mail.outbox[0]
        self.assertEqual(msg.to, ["admin@x.com", "boss@x.com"])
        self.assertIn("Week ", msg.subject)
        self.assertEqual(msg.alternatives[0][1], "text/html")
        self.assertIn("Nadia Rahman", msg.body)
        log = DigestLog.objects.get(week_start=date(2026, 10, 17))
        self.assertEqual(log.sent_by, self.admin)
        self.assertEqual(admin.post("/api/ops/digest/send/", {}, format="json").status_code, 409)
        self.assertEqual(admin.post("/api/ops/digest/send/", {"force": True}, format="json").status_code, 200)
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(self.as_user(self.admin).get("/api/ops/digest/").json()["sent"]["recipients"], ["admin@x.com", "boss@x.com"])
        self.assertTrue(AuditLog.objects.filter(action="digest.send").exists())

    def test_weekly_schedule_needs_the_secret_and_sends_once(self):
        anon = APIClient()
        with override_settings(DIGEST_CRON_SECRET=""):
            self.assertEqual(anon.post("/api/ops/digest/run/").status_code, 404)            # off until a secret is set
        with override_settings(DIGEST_CRON_SECRET="a-long-random-secret"):
            self.assertEqual(anon.post("/api/ops/digest/run/").status_code, 403)
            self.assertEqual(anon.post("/api/ops/digest/run/", HTTP_X_CRON_SECRET="wrong").status_code, 403)
            r = anon.post("/api/ops/digest/run/", HTTP_X_CRON_SECRET="a-long-random-secret")
            self.assertEqual((r.status_code, r.json()), (200, {"sent": True, "week_start": "2026-10-17"}))
            r = anon.post("/api/ops/digest/run/", HTTP_X_CRON_SECRET="a-long-random-secret")
            self.assertEqual(r.json()["sent"], False)                                         # already went out this week
        self.assertEqual(len(mail.outbox), 1)
        self.assertIsNone(DigestLog.objects.get().sent_by)

    def test_management_command(self):
        out = StringIO()
        call_command("send_weekly_digest", stdout=out)
        self.assertIn("Sent the digest for the week of 2026-10-17", out.getvalue())
        call_command("send_weekly_digest", stdout=out)
        self.assertIn("already went out", out.getvalue())
        call_command("send_weekly_digest", "--force", stdout=out)
        self.assertEqual(len(mail.outbox), 2)
