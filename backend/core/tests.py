from datetime import date, datetime
from datetime import timezone as tz
from unittest import mock

import requests
from django.core.mail import send_mail
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts import services as acc
from accounts.models import User
from team import services as team_services
from team.models import JobRole, Sheet, SheetEntry, Task
from tracker.models import Prospect
from tracker.services import settings_for

from .models import Announcement, AuditLog

NOW = datetime(2026, 10, 29, 4, 0, tzinfo=tz.utc)   # Thu 29 Oct 2026, 10:00 in Dhaka


@override_settings(EMAIL_BACKEND="core.mail.BrevoEmailBackend", BREVO_API_KEY="test-key")
class DeployTests(TestCase):
    def test_health_needs_no_sign_in(self):
        r = self.client.get("/api/health/")
        self.assertEqual((r.status_code, r.json()), (200, {"ok": True}))

    def test_email_goes_out_over_https_through_brevo(self):
        with mock.patch("core.mail.requests.post") as post:
            post.return_value.raise_for_status.return_value = None
            sent = send_mail("Hello", "Body text", "DSL TOS <team@example.com>", ["a@example.com"])
        self.assertEqual(sent, 1)
        body, headers = post.call_args.kwargs["json"], post.call_args.kwargs["headers"]
        self.assertEqual((body["sender"], body["to"], body["subject"], body["textContent"], headers["api-key"]),
                         ({"email": "team@example.com", "name": "DSL TOS"}, [{"email": "a@example.com"}], "Hello", "Body text", "test-key"))
        with mock.patch("core.mail.requests.post", side_effect=requests.ConnectionError("down")), self.assertRaises(RuntimeError):
            send_mail("Hello", "Body", "team@example.com", ["a@example.com"])


class ConsoleEmailTests(TestCase):
    def test_a_terminal_that_cannot_show_a_character_never_fails_an_email(self):
        import io

        from django.core.mail import EmailMessage

        from .mail import ConsoleEmailBackend
        out = io.TextIOWrapper(io.BytesIO(), encoding="cp1252")   # a Windows terminal code page
        sent = ConsoleEmailBackend(stream=out).send_messages([EmailMessage("Week 44 · digest", "Leads → opportunities → clients", "a@x.com", ["b@x.com"])])
        self.assertEqual(sent, 1)


class ExtrasTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        mk = lambda e, role, name: User.objects.create_user(e, name=name, status="approved", role=role)
        cls.admin, cls.member = mk("a@x.com", "admin", "Admin"), mk("m@x.com", "member", "Member One")

    def setUp(self):
        p = mock.patch.object(team_services, "now", return_value=NOW)
        p.start()
        self.addCleanup(p.stop)

    def api(self, u):
        c = APIClient()
        c.force_authenticate(u)
        return c

    # ----- activity log -----
    def test_activity_log_is_admin_only_and_flags_corrections(self):
        role = JobRole.objects.get(name="International Sales (AI)")
        sheet = Sheet.objects.create(name="Member", owner=self.member, role=role)
        calls = Task.objects.get(name="Make 8 Cold Calls")
        self.api(self.member).put(f"/api/team/sheets/{sheet.pk}/entries/2026-10-29/", {"slots": [calls.pk]}, format="json")
        self.api(self.admin).put(f"/api/team/sheets/{sheet.pk}/entries/2026-10-27/", {"slots": [calls.pk]}, format="json")   # locked day
        newbie = User.objects.create_user("n@x.com", name="New", status="pending")
        acc.approve(newbie, self.admin, "member")
        self.assertEqual(self.api(self.member).get("/api/admin/activity/").status_code, 403)
        r = self.api(self.admin).get("/api/admin/activity/").data
        actions = [x["action"] for x in r["results"]]
        self.assertIn("user.approve", actions)
        self.assertEqual(actions.count("entry.save"), 2)
        self.assertEqual(r["flagged_count"], 1)
        flagged = self.api(self.admin).get("/api/admin/activity/?flagged=1").data["results"]
        self.assertEqual((len(flagged), flagged[0]["actor"]["email"], flagged[0]["detail"]["day"]), (1, "a@x.com", "2026-10-27"))
        self.assertEqual(len(self.api(self.admin).get("/api/admin/activity/?action=user.").data["results"]), 1)

    def test_role_and_task_changes_are_recorded(self):
        self.api(self.admin).patch(f"/api/admin/users/{self.member.pk}/", {"role": "viewer"}, format="json")
        t = Task.objects.first()
        self.api(self.admin).patch(f"/api/team/tasks/{t.pk}/", {"points": "3"}, format="json")
        self.assertTrue(AuditLog.objects.filter(action="user.update", detail__after__role="viewer").exists())
        self.assertTrue(AuditLog.objects.filter(action="task.save", target=t.name).exists())

    # ----- announcements -----
    def test_announcements(self):
        self.assertEqual(self.api(self.member).post("/api/announcements/", {"title": "Hi"}, format="json").status_code, 403)
        r = self.api(self.admin).post("/api/announcements/", {"title": "Target week", "body": "Push demos", "pinned": True}, format="json")
        self.assertEqual((r.status_code, r.data["created_by"]), (201, "Admin"))
        Announcement.objects.create(title="Old news", expires_on=date(2026, 10, 1))
        seen = [a["title"] for a in self.api(self.member).get("/api/announcements/").data]
        self.assertEqual(seen, ["Target week"])                                       # expired ones are hidden
        self.assertEqual(len(self.api(self.admin).get("/api/announcements/?all=1").data), 2)
        self.assertEqual(self.api(self.member).delete(f"/api/announcements/{r.data['id']}/").status_code, 403)
        self.assertEqual(self.api(self.admin).delete(f"/api/announcements/{r.data['id']}/").status_code, 204)

    # ----- leaderboard -----
    def test_leaderboard(self):
        role = JobRole.objects.get(name="International Sales (AI)")
        a = Sheet.objects.create(name="A", person="Alpha", role=role, target_hours=10, target_points=10, start_date=date(2026, 10, 1))
        b = Sheet.objects.create(name="B", person="Beta", role=role, target_hours=10, target_points=10, start_date=date(2026, 10, 1))
        demo = Task.objects.get(name="Demo & Presentation Session")
        SheetEntry.objects.create(sheet=a, day=date(2026, 10, 25), slots=[demo.pk] * 3)
        SheetEntry.objects.create(sheet=b, day=date(2026, 10, 26), slots=[demo.pk])
        rows = {r["person"]: r for r in self.api(self.member).get("/api/team/leaderboard/").data["rows"]}
        self.assertEqual((rows["Alpha"]["hours"], rows["Alpha"]["points"], rows["Beta"]["points"]), (3, 30.0, 10.0))
        self.assertGreater(rows["Alpha"]["score"], rows["Beta"]["score"])

    # ----- shared pipelines -----
    def test_pipelines_are_private_until_shared(self):
        Prospect.objects.create(owner=self.member, company="Secret Co", stage="lead")
        self.assertEqual(self.api(self.admin).get("/api/tracker/team/").data["people"], [])
        self.api(self.member).patch("/api/tracker/settings/", {"share_with_admins": True}, format="json")
        people = self.api(self.admin).get("/api/tracker/team/").data["people"]
        self.assertEqual((people[0]["user"]["name"], people[0]["prospects"][0]["company"]), ("Member One", "Secret Co"))
        self.assertEqual(self.api(self.member).get("/api/tracker/team/").status_code, 403)
        st = settings_for(self.member)
        st.share_with_admins = False
        st.save()
        self.assertEqual(self.api(self.admin).get("/api/tracker/team/").data["people"], [])
