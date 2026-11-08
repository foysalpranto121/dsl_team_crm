import json
from datetime import date, datetime
from datetime import timezone as tz
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from team import services as team_services

from .models import Activity, PlanDay, Prospect

NOW = datetime(2026, 11, 5, 6, 0, tzinfo=tz.utc)   # Thu 5 Nov 2026, 12:00 in Dhaka
NEXT = {"requirement": "CRM for 20 users", "next_action": "Call back", "next_follow_up": "2026-11-08"}   # an open record needs these (SRS v0.5)


class TrackerTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.me = User.objects.create_user("me@x.com", name="Me", status="approved", role="member")
        cls.other = User.objects.create_user("other@x.com", name="Other", status="approved", role="admin")

    def setUp(self):
        p = mock.patch.object(team_services, "now", return_value=NOW)
        p.start()
        self.addCleanup(p.stop)
        self.api = APIClient()
        self.api.force_authenticate(self.me)

    def setup_period(self, **kw):
        body = {"period_start": "2026-11-01", "period_days": 30, "targets": {"points": 300, "leads": 30, "opps": 15, "clients": 5},
                "weeks": [{"leads": 5, "opps": 1, "clients": 0, "points": 70, "focus": "Setup"}], **kw}
        r = self.api.patch("/api/tracker/settings/", body, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        return r.data

    def test_private_to_each_person(self):
        p = Prospect.objects.create(owner=self.other, company="Their Co")
        self.assertEqual(self.api.get("/api/tracker/prospects/").data, [])
        self.assertEqual(self.api.get(f"/api/tracker/prospects/{p.pk}/").status_code, 404)
        self.assertEqual(self.api.patch(f"/api/tracker/prospects/{p.pk}/", {"stage": "lead"}, format="json").status_code, 404)
        self.assertEqual(self.api.delete(f"/api/tracker/prospects/{p.pk}/").status_code, 404)

    def test_stage_dates_are_stamped_once(self):
        r = self.api.post("/api/tracker/prospects/", {"company": "Acme", "country": "UAE", "stage": "requirements", **NEXT}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual((r.data["lead_date"], r.data["opp_date"], r.data["client_date"], r.data["stage_name"]), ("2026-11-05", "2026-11-05", None, "Requirements Shared"))
        pid = r.data["id"]
        Prospect.objects.filter(pk=pid).update(lead_date=date(2026, 11, 2))
        r = self.api.patch(f"/api/tracker/prospects/{pid}/", {"stage": "won", "value": "50000", "win_loss_why": "Best fit"}, format="json")
        self.assertEqual((r.data["lead_date"], r.data["client_date"]), ("2026-11-02", "2026-11-05"))   # earlier dates kept
        r = self.api.patch(f"/api/tracker/prospects/{pid}/", {"stage": "lost", "lost_reason": "No budget", "win_loss_why": "Budget cut"}, format="json")
        self.assertEqual((r.data["stage"], r.data["client_date"]), ("lost", "2026-11-05"))          # history isn't wiped

    def test_points_and_weeks_like_the_original_tracker(self):
        self.setup_period()
        for company, stage in (("A", "qualified"), ("B", "requirements"), ("C", "won")):
            r = self.api.post("/api/tracker/prospects/", {"company": company, "stage": stage, "value": "1000", "win_loss_why": "Fit", **NEXT}, format="json")
            self.assertEqual(r.status_code, 201, r.data)
        r = self.api.post("/api/tracker/activities/", {"date": "2026-11-03", "type": "email", "qty": 30}, format="json")
        self.assertEqual(r.data["points"], 3.0)                       # 30 × 0.1
        self.api.post("/api/tracker/activities/", {"date": "2026-11-04", "type": "demo", "qty": 1}, format="json")
        self.assertEqual(self.api.post("/api/tracker/activities/", {"date": "2026-11-04", "type": "m_lead", "qty": 1}, format="json").status_code, 400)
        s = self.api.get("/api/tracker/summary/").data
        # leads 3 (A, B, C all reached lead), opps 2, clients 1: 3×3 + 2×5 + 1×15 = 34, plus activities 3 + 4
        self.assertEqual(s["totals"], {"leads": 3, "opps": 2, "clients": 1, "points": 41.0})
        self.assertEqual((s["period"]["day_index"], len(s["weeks"]), str(s["weeks"][-1]["to"])), (5, 4, "2026-11-30"))   # last week runs to the end
        self.assertEqual(s["weeks"][0]["actual"]["points"], 41.0)
        self.assertEqual(s["funnel"], {"prospects": 3, "contacted": 3, "leads": 3, "opps": 2, "clients": 1})
        self.api.patch("/api/tracker/settings/", {"rules": {"email": 0.5}}, format="json")
        self.assertEqual(self.api.get("/api/tracker/summary/").data["totals"]["points"], 53.0)   # email now 30 × 0.5

    def test_follow_ups_due(self):
        Prospect.objects.create(owner=self.me, company="Late", next_follow_up=date(2026, 11, 1))
        Prospect.objects.create(owner=self.me, company="Today", next_follow_up=date(2026, 11, 5))
        Prospect.objects.create(owner=self.me, company="Later", next_follow_up=date(2026, 11, 9))
        Prospect.objects.create(owner=self.me, company="Won", stage="won", next_follow_up=date(2026, 11, 1))
        due = self.api.get("/api/tracker/summary/").data["due"]
        self.assertEqual([(d["company"], d["overdue"]) for d in due], [("Late", True), ("Today", False)])

    def test_daily_plan_templates_save_and_reset(self):
        self.setup_period(plan_template="centralai")
        r = self.api.get("/api/tracker/plan/?from=2026-11-01&to=2026-11-06").data["days"]
        self.assertEqual(r[0]["tasks"][0]["text"][:21], "Ask your manager exac")      # day 1 of the Central AI plan
        self.assertEqual(len(r[3]["tasks"]), 2 + 5)                                  # day 4: two special tasks + the routine
        self.assertTrue(r[5]["weekend"] and len(r[5]["tasks"]) == 1)                # Friday 6 Nov: no routine
        tasks = [{"id": t["id"], "text": t["text"], "done": i == 0} for i, t in enumerate(r[3]["tasks"])] + [{"text": "My own task"}]
        saved = self.api.put("/api/tracker/plan/2026-11-04/", {"tasks": tasks, "note": "good day"}, format="json").data
        self.assertEqual((len(saved["tasks"]), saved["tasks"][0]["done"], bool(saved["tasks"][-1]["id"])), (8, True, True))
        s = self.api.get("/api/tracker/summary/").data
        self.assertEqual(s["weeks"][0]["plan"]["done"], 1)
        self.assertEqual(self.api.delete("/api/tracker/plan/2026-11-04/").status_code, 204)
        self.assertFalse(PlanDay.objects.exists())
        self.setup_period(plan_template="blank")
        self.assertEqual(self.api.get("/api/tracker/plan/?from=2026-11-01&to=2026-11-01").data["days"][0]["tasks"], [])

    def test_period_rolls_over_and_past_periods_stay_visible(self):
        self.setup_period(period_start="2026-10-01", plan_template="centralai")
        s = self.api.get("/api/tracker/summary/").data["period"]
        self.assertEqual((s["n"], s["current"], str(s["start"]), str(s["end"]), s["day_index"]), (1, 1, "2026-11-01", "2026-11-30", 5))   # November, by itself
        old = self.api.get("/api/tracker/summary/?period=0").data
        self.assertEqual((str(old["period"]["start"]), str(old["period"]["end"]), old["period"]["days"]), ("2026-10-01", "2026-10-31", 31))
        self.assertEqual(str(old["weeks"][-1]["to"]), "2026-10-31")
        plan = self.api.get("/api/tracker/plan/").data
        self.assertEqual((str(plan["days"][0]["date"]), plan["days"][0]["day"], len(plan["days"])), ("2026-11-01", 1, 30))
        self.assertEqual(len(plan["days"][0]["tasks"]), 5)                           # later periods: the routine only, no launch tasks
        self.assertEqual(self.api.get("/api/tracker/plan/?period=0").data["days"][0]["tasks"][0]["text"][:21], "Ask your manager exac")
        self.assertEqual(self.api.get("/api/tracker/plan/?period=-1").status_code, 400)
        self.setup_period(period_start="2026-10-03", period_days=14)                 # not a month: repeats every 14 days
        s = self.api.get("/api/tracker/summary/").data["period"]
        self.assertEqual((s["n"], str(s["start"]), str(s["end"])), (2, "2026-10-31", "2026-11-13"))

    def test_csv_import_and_export(self):
        csv = ("Company Name for Emails,First Name,Last Name,Title,Email,Country,Industry,Stage\n"
               "Acme Study,Sara,Khan,Founder,sara@acme.ae,UAE,Education / Study abroad,Lead\n"
               "Acme Study,Sara,Khan,Founder,sara@acme.ae,UAE,Education / Study abroad,\n"
               ",No,Company,,,,,\n"
               "Beta Clinic,,,,ops@beta.my,Malaysia,Clinic / Healthcare,\n")
        r = self.api.post("/api/tracker/prospects/import/", {"file": SimpleUploadedFile("apollo.csv", csv.encode())}, format="multipart")
        self.assertEqual(r.data, {"added": 2, "skipped": 2, "unknown_stages": []})
        acme = Prospect.objects.get(company="Acme Study")
        # stage matched by name; an open record gets a next step (FR-CL3); importing isn't a new lead this week
        self.assertEqual((acme.contact, acme.stage, acme.next_action, str(acme.next_follow_up), acme.lead_date), ("Sara Khan", "lead", "First contact", "2026-11-05", None))
        out = self.api.get("/api/tracker/prospects/export/")
        text = out.content.decode("utf-8-sig")
        self.assertIn("Company,Requirement,Segment,Stage,Expected value", text)
        self.assertIn("Acme Study,,,Lead,", text)
        bad = self.api.post("/api/tracker/prospects/import/", {"file": SimpleUploadedFile("x.csv", b"Name,Email\nA,a@b.c\n")}, format="multipart")
        self.assertEqual(bad.status_code, 400)

    def test_backup_from_the_old_tracker(self):
        backup = {"app": "central-ai-crm", "version": 2,
                  "config": {"owner": "Pranto", "start": "2026-11-01", "days": 30, "targets": {"points": 300, "leads": 30, "opps": 15, "clients": 5},
                             "weeks": [{"leads": 5, "opps": 1, "clients": 0, "points": 70, "focus": "Setup"}], "rules": {"email": 0.2}},
                  "leads": [{"id": "x1", "company": "Old Co", "email": "a@old.co", "niche": "Real estate", "stage": "lead", "leadDate": "2026-11-02", "next": "2026-11-06"}],
                  "acts": [{"id": "a1", "date": "2026-11-02", "type": "email", "qty": 20, "note": "batch"}],
                  "plan": {"2026-11-02": {"tasks": [{"id": "d2-0", "text": "Build demo bots", "done": True}], "note": ""}}}
        f = SimpleUploadedFile("backup.json", json.dumps(backup).encode(), "application/json")
        r = self.api.post("/api/tracker/import-backup/", {"file": f}, format="multipart")
        self.assertEqual(r.data, {"prospects": 1, "activities": 1, "plan_days": 1})
        st = self.api.get("/api/tracker/settings/").data
        self.assertEqual((st["product"], st["plan_template"], st["targets"]["leads"]), ("Central AI", "centralai", 30))
        self.assertEqual(Prospect.objects.get(owner=self.me).industry, "Real estate")
        self.assertEqual(self.api.get("/api/tracker/summary/").data["totals"]["points"], 3 + 20 * 0.2)
        again = self.api.post("/api/tracker/import-backup/", {"file": SimpleUploadedFile("backup.json", json.dumps(backup).encode())}, format="multipart")
        self.assertEqual(again.data["prospects"], 0)                                 # no duplicate prospects
        wrong = self.api.post("/api/tracker/import-backup/", {"file": SimpleUploadedFile("b.json", b'{"app":"other"}')}, format="multipart")
        self.assertEqual(wrong.status_code, 400)

    def test_viewers_have_their_own_tracker_too(self):
        viewer = User.objects.create_user("v@x.com", status="approved", role="viewer")
        c = APIClient()
        c.force_authenticate(viewer)
        self.assertEqual(c.post("/api/tracker/prospects/", {"company": "Mine", **NEXT}, format="json").status_code, 201)
        self.assertEqual(Activity.objects.count(), 0)
