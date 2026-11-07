from datetime import date, datetime
from datetime import timezone as tz
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from accounts.models import User
from core.models import AuditLog
from team import services as team_services
from team.models import JobRole, KpiEntry, Sheet, SheetEntry, Task

from .models import DisplayScreen, hash_token
from core.features import switch_on

NOW = datetime(2026, 10, 29, 4, 0, tzinfo=tz.utc)   # Thu 29 Oct 2026, 10:00 in Dhaka. Week: Sat 24 – Fri 30, Friday off.
TODAY = date(2026, 10, 29)


class OfficeTvTests(TestCase):
    """SRS v0.3 §14.5 Office TV mode: FR-TV1 (display-only token), FR-TV2 (panels), FR-TV3 (wins to celebrate)."""

    @classmethod
    def setUpTestData(cls):
        switch_on("tv")   # V2 features are off by default (SRS v0.5 §0)
        mk = lambda email, role, name: User.objects.create_user(email, name=name, status="approved", role=role)
        cls.admin = mk("admin@x.com", "admin", "Admin")
        cls.nadia, cls.arif = mk("nadia@x.com", "member", "Nadia Rahman"), mk("arif@x.com", "member", "Arif Hossain")
        cls.role = JobRole.objects.get(name="International Sales (AI)")
        cls.calls = Task.objects.get(name="Make 8 Cold Calls")             # 1 pt
        cls.demo = Task.objects.get(name="Demo & Presentation Session")    # 10 pts
        cls.order = Task.objects.get(name="Client Work Order Receiving")   # 100 pts; a win (migration 0006)
        sheet = lambda name, owner: Sheet.objects.create(
            name=name, owner=owner, role=cls.role, target_hours=35, target_points=300, target_leads=30, target_opps=15,
            target_clients=5, target_revenue=100000, start_date=date(2026, 9, 1))
        cls.s_nadia, cls.s_arif = sheet("Nadia", cls.nadia), sheet("Arif", cls.arif)

    def setUp(self):
        clock = mock.patch.object(team_services, "now", return_value=NOW)
        clock.start()
        self.addCleanup(clock.stop)

    # ---------- helpers ----------

    def as_user(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def as_tv(self, token):
        c = APIClient()
        c.credentials(HTTP_X_DISPLAY_TOKEN=token)
        return c

    def new_screen(self, **fields):
        r = self.as_user(self.admin).post("/api/display/screens/", {"name": "Sales floor", **fields}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()

    def change(self, screen, **fields):
        r = self.as_user(self.admin).patch(f"/api/display/screens/{screen['id']}/", fields, format="json")
        self.assertEqual(r.status_code, 200, r.content)

    def feed(self, screen):
        r = self.as_tv(screen["token"]).get("/api/display/feed/")
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    # ---------- managing screens ----------

    def test_admins_create_screens_and_see_the_link_once(self):
        s = self.new_screen()
        self.assertGreater(len(s["token"]), 30)
        self.assertEqual(s["token_hint"], s["token"][:6])
        self.assertEqual(DisplayScreen.objects.get(pk=s["id"]).token_hash, hash_token(s["token"]))   # only the hash is kept
        listed = self.as_user(self.admin).get("/api/display/screens/").json()
        self.assertEqual([x["name"] for x in listed], ["Sales floor"])
        self.assertNotIn("token", listed[0])
        self.assertTrue(AuditLog.objects.filter(action="display.create", target="Sales floor").exists())
        member = self.as_user(self.nadia)
        self.assertEqual(member.get("/api/display/screens/").status_code, 403)
        self.assertEqual(member.post("/api/display/screens/", {"name": "Mine"}, format="json").status_code, 403)

    def test_screen_settings_are_checked(self):
        admin = self.as_user(self.admin)
        for bad in ({"panels": ["wins", "weather"]}, {"panels": []}, {"panels": ["wins", "wins"]}, {"rotate_seconds": 3}, {"leaders": "worst"}):
            r = admin.post("/api/display/screens/", {"name": "TV", **bad}, format="json")
            self.assertEqual(r.status_code, 400, bad)

    def test_the_feed_needs_the_link_of_an_active_screen(self):
        s = self.new_screen()
        self.assertEqual(APIClient().get("/api/display/feed/").status_code, 401)                 # no link
        signed_in = APIClient()
        signed_in.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(self.admin)}")
        self.assertEqual(signed_in.get("/api/display/feed/").status_code, 401)                   # a person's sign-in is not a screen
        self.assertEqual(self.as_tv("not-the-link").get("/api/display/feed/").status_code, 401)
        self.feed(s)
        self.assertIsNotNone(DisplayScreen.objects.get(pk=s["id"]).last_seen_at)
        self.assertEqual(self.as_tv(s["token"]).post("/api/display/feed/").status_code, 405)    # read-only
        self.change(s, active=False)
        self.assertEqual(self.as_tv(s["token"]).get("/api/display/feed/").status_code, 401)

    def test_a_new_link_replaces_the_old_one(self):
        s = self.new_screen()
        self.feed(s)
        r = self.as_user(self.admin).post(f"/api/display/screens/{s['id']}/rotate/")
        self.assertEqual(r.status_code, 200)
        new = r.json()
        self.assertNotEqual(new["token"], s["token"])
        self.assertIsNone(new["last_seen_at"])                       # shows as waiting until the TV opens the new link
        self.assertEqual(self.as_tv(s["token"]).get("/api/display/feed/").status_code, 401)
        self.feed(new)
        self.assertTrue(AuditLog.objects.filter(action="display.rotate").exists())
        self.assertEqual(self.as_user(self.nadia).post(f"/api/display/screens/{s['id']}/rotate/").status_code, 403)

    # ---------- what the TV shows ----------

    def test_team_progress_is_the_dashboard_added_up(self):
        SheetEntry.objects.create(sheet=self.s_nadia, day=TODAY, slots=[self.calls.pk] * 3)                # today: 3 h, 3 pts
        SheetEntry.objects.create(sheet=self.s_arif, day=date(2026, 10, 25), slots=[self.demo.pk] * 4)     # Sunday: 4 h, 40 pts
        KpiEntry.objects.create(sheet=self.s_nadia, week_start=date(2026, 10, 3), leads=6, clients=1, revenue=50000)
        s = self.new_screen()
        p = self.feed(s)["progress"]
        self.assertEqual((p["people"], p["logged_today"]), (2, 1))                       # a count, never names
        self.assertEqual(p["today"], {"value": 3, "target": 11.67, "workday": True})      # 70 h a week over 6 working days
        self.assertEqual((p["week"]["value"], p["week"]["target"]), (7, 70))
        self.assertEqual((p["month"]["value"], p["month"]["target"]), (43, 600))
        dash = self.as_user(self.admin).get("/api/team/dashboard/").json()["rows"]
        self.assertEqual(p["week"]["value"], sum(r["week_hours"] for r in dash))
        self.assertEqual(p["month"]["value"], sum(r["month_points"] for r in dash))
        kpis = {k["key"]: k for k in p["kpis"]}
        self.assertEqual((kpis["leads"]["value"], kpis["leads"]["target"]), (6, 60))
        self.assertEqual((kpis["revenue"]["value"], kpis["revenue"]["target"], kpis["revenue"]["pct"]), (None, None, 0.25))   # amount hidden
        self.change(s, show_values=True)
        kpis = {k["key"]: k for k in self.feed(s)["progress"]["kpis"]}
        self.assertEqual((kpis["revenue"]["value"], kpis["revenue"]["target"]), (50000, 200000))

    def test_wins_come_from_win_tasks_and_details_need_permission(self):
        self.assertTrue(Task.objects.get(pk=self.order.pk).counts_as_win)
        SheetEntry.objects.create(sheet=self.s_nadia, day=TODAY, slots=[self.order.pk, self.calls.pk], remarks="Bangladesh Bank ERP, BDT 20 lakh")
        SheetEntry.objects.create(sheet=self.s_arif, day=date(2026, 10, 20), slots=[self.order.pk, self.order.pk])   # two hours, one win
        SheetEntry.objects.create(sheet=self.s_arif, day=date(2026, 9, 20), slots=[self.order.pk])                    # older than 30 days
        SheetEntry.objects.create(sheet=self.s_arif, day=date(2026, 10, 21), slots=[self.demo.pk])                    # not a win
        s = self.new_screen()
        w = self.feed(s)["wins"]
        self.assertTrue(w["configured"])
        self.assertEqual([(i["person"], i["what"], i["day"], i["today"], i["details"]) for i in w["items"]],
                         [("Nadia Rahman", "Client Work Order Receiving", "2026-10-29", True, None),
                          ("Arif Hossain", "Client Work Order Receiving", "2026-10-20", False, None)])
        self.change(s, show_values=True)
        self.assertEqual(self.feed(s)["wins"]["items"][0]["details"], "Bangladesh Bank ERP, BDT 20 lakh")
        # Admins choose which tasks are wins (members can't).
        self.assertEqual(self.as_user(self.nadia).patch(f"/api/team/tasks/{self.order.pk}/", {"counts_as_win": False}, format="json").status_code, 403)
        self.assertEqual(self.as_user(self.admin).patch(f"/api/team/tasks/{self.order.pk}/", {"counts_as_win": False}, format="json").status_code, 200)
        self.assertEqual(self.feed(s)["wins"], {"configured": False, "items": []})

    def test_leaders_show_only_the_top_few(self):
        SheetEntry.objects.create(sheet=self.s_nadia, day=date(2026, 10, 20), slots=[self.demo.pk] * 4)    # 40 pts
        SheetEntry.objects.create(sheet=self.s_arif, day=date(2026, 10, 21), slots=[self.calls.pk] * 4)    # 4 pts
        Sheet.objects.create(name="Quiet", role=self.role, target_hours=35, target_points=300)               # no activity: never listed
        s = self.new_screen(leaders_count=1)
        lead = self.feed(s)["leaders"]
        self.assertEqual((lead["mode"], [r["person"] for r in lead["rows"]]), ("top", ["Nadia Rahman"]))
        self.change(s, leaders_count=5)
        self.assertEqual([r["person"] for r in self.feed(s)["leaders"]["rows"]], ["Nadia Rahman", "Arif Hossain"])
        self.change(s, leaders="off")
        self.assertEqual(self.feed(s)["leaders"], {"mode": "off", "rows": []})

    def test_improvers_compare_this_months_pace_with_last_month(self):
        SheetEntry.objects.create(sheet=self.s_nadia, day=date(2026, 9, 15), slots=[self.demo.pk] * 3)     # Sep: 30 of 300 = 10%
        SheetEntry.objects.create(sheet=self.s_nadia, day=date(2026, 10, 20), slots=[self.demo.pk] * 4)    # Oct: 40, pace ≈ 14%
        SheetEntry.objects.create(sheet=self.s_arif, day=date(2026, 9, 15), slots=[self.demo.pk] * 10)     # Sep: 100 = 33%
        SheetEntry.objects.create(sheet=self.s_arif, day=date(2026, 10, 20), slots=[self.calls.pk] * 4)    # Oct: 4, pace ≈ 1%: slipped
        rows = self.feed(self.new_screen(leaders="improvers"))["leaders"]["rows"]
        self.assertEqual([r["person"] for r in rows], ["Nadia Rahman"])
        self.assertAlmostEqual(rows[0]["change"], 40 / 288.46 - 0.1, places=3)                           # 300 × 25 of 26 working days
