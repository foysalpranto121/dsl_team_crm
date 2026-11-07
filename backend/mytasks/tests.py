"""My Tasks (SRS v0.5 §5.6, D5)."""
from datetime import date, datetime
from datetime import timezone as tz
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from team import services as team_services
from team.models import JobRole, Sheet, SheetEntry, Task, TeamSettings

from .models import PersonalTask
from .services import TaskError, parse_when

NOW = datetime(2026, 10, 29, 4, 0, tzinfo=tz.utc)   # Thu 29 Oct 2026 in Dhaka; Friday is the weekend
TODAY = date(2026, 10, 29)


class NaturalDates(TestCase):
    def test_words_weekdays_and_dates(self):
        cases = {"": TODAY, "today": TODAY, "tomorrow": date(2026, 10, 30), "in 3 days": date(2026, 11, 1), "+2": date(2026, 10, 31),
                 "sun": date(2026, 11, 1), "Thursday": TODAY, "next sun": date(2026, 11, 8), "15 Nov": date(2026, 11, 15), "nov 15": date(2026, 11, 15),
                 "15/11": date(2026, 11, 15), "2 Jan": date(2027, 1, 2), "2026-12-24": date(2026, 12, 24), "next week": date(2026, 11, 5)}
        for text, want in cases.items():
            self.assertEqual(parse_when(text, TODAY), want, text)
        with self.assertRaises(TaskError):
            parse_when("someday", TODAY)


class MyTasksTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        mk = lambda e, role: User.objects.create_user(e, name=e.split("@")[0].title(), status="approved", role=role)  # noqa: E731
        cls.member, cls.other, cls.sup = mk("mina@x.com", "member"), mk("omar@x.com", "member"), mk("sup@x.com", "supervisor")
        st = TeamSettings.load()
        st.weekend_days = [5]
        st.save()
        role = JobRole.objects.get(name="International Sales (AI)")
        cls.calls = Task.objects.get(name="Make 8 Cold Calls")
        cls.work = Sheet.objects.create(name="Mina", owner=cls.member, role=role)

    def setUp(self):
        p = mock.patch.object(team_services, "now", return_value=NOW)
        p.start()
        self.addCleanup(p.stop)

    def api(self, u):
        c = APIClient()
        c.force_authenticate(u)
        return c

    def add(self, u=None, **body):
        return self.api(u or self.member).post("/api/tasks/items/", body, format="json")

    def test_views_repeat_drop_and_privacy(self):
        self.assertEqual(self.add(title="  Call   the bank ", due="tomorrow").data["due_date"], "2026-10-30")
        today = self.add(title="Send the brochure", priority="high").data
        self.add(title="Old one", due_date="2026-10-20")
        self.add(self.other, title="Not Mina's")
        names = lambda view: [t["title"] for t in self.api(self.member).get(f"/api/tasks/items/?view={view}").data]  # noqa: E731
        self.assertEqual((names("today"), names("upcoming"), names("overdue")), (["Send the brochure"], ["Call the bank"], ["Old one"]))
        self.assertEqual(self.add(title="x", due="someday").status_code, 400)
        # Done; a weekly task comes back a week later; a daily one skips the weekend (Friday).
        weekly = self.add(title="Weekly report", repeat="weekly").data
        r = self.api(self.member).post(f"/api/tasks/items/{weekly['id']}/done/")
        self.assertEqual((r.data["status"], PersonalTask.objects.get(pk=r.data["next_task"]).due_date), ("done", date(2026, 11, 5)))
        daily = self.add(title="Inbox zero", repeat="daily").data
        nxt = self.api(self.member).post(f"/api/tasks/items/{daily['id']}/done/").data["next_task"]
        self.assertEqual(PersonalTask.objects.get(pk=nxt).due_date, date(2026, 10, 31))
        self.assertEqual(self.api(self.other).post(f"/api/tasks/items/{today['id']}/done/").status_code, 404)   # not theirs to see
        self.assertIn("Weekly report", names("done"))
        # Supervisors assign; members can't; nobody assigns to themselves.
        self.assertEqual(self.api(self.member).post("/api/tasks/assign/", {"person": self.other.pk, "title": "x"}, format="json").status_code, 403)
        self.assertEqual(self.api(self.sup).post("/api/tasks/assign/", {"person": self.sup.pk, "title": "x"}, format="json").status_code, 400)
        a = self.api(self.sup).post("/api/tasks/assign/", {"person": self.member.pk, "title": "Visit Walton", "due": "sun", "activity": self.calls.pk}, format="json")
        self.assertEqual((a.status_code, a.data["assigned_by_name"], a.data["due_date"]), (201, "Sup", "2026-11-01"))
        self.assertEqual(self.api(self.member).delete(f"/api/tasks/items/{a.data['id']}/").status_code, 403)
        self.assertEqual(self.api(self.member).post(f"/api/tasks/items/{a.data['id']}/drop/", {"reason": ""}, format="json").status_code, 400)
        # The team view shows counts and assigned tasks, never personal titles (FR-MT6).
        t = self.api(self.sup).get("/api/tasks/team/").data
        mina = next(p for p in t["people"] if p["name"] == "Mina")
        self.assertEqual((mina["overdue"], [x["title"] for x in t["assigned"]]), (1, ["Visit Walton"]))
        self.assertNotIn("Send the brochure", str(t))

    def test_logging_a_task_as_an_hour(self):
        TeamSettings.objects.filter(pk=1).update(unplanned_mode="strict")
        own = self.add(title="Cold calls", activity=self.calls.pk).data
        done = self.api(self.member).post(f"/api/tasks/items/{own['id']}/done/").data
        self.assertEqual(done["free_hour"], 0)
        self.api(self.member).post(f"/api/tasks/items/{own['id']}/log/", {"hour": 0}, format="json")
        e = SheetEntry.objects.get(sheet=self.work, day=TODAY)
        self.assertEqual((e.slots, e.meta[0]["review"], e.meta[0]["task"]), ([self.calls.pk], "pending", own["id"]))   # self-made, strict: waits
        self.assertEqual(self.api(self.member).post(f"/api/tasks/items/{own['id']}/log/", {"hour": 1}, format="json").status_code, 400)  # once only
        assigned = self.api(self.sup).post("/api/tasks/assign/", {"person": self.member.pk, "title": "Calls for the campaign", "activity": self.calls.pk}, format="json").data
        self.api(self.member).post(f"/api/tasks/items/{assigned['id']}/done/")
        r = self.api(self.member).post(f"/api/tasks/items/{assigned['id']}/log/", {"hour": 1}, format="json")
        self.assertEqual((r.status_code, r.data["logged"]["hour"]), (200, 1))
        e.refresh_from_db()
        self.assertEqual((e.meta[1]["review"], e.meta[1]["assigned"], len([x for x in e.counted_slots() if x])), ("approved", True, 1))   # pre-approved
        # Saving the day again from My Day keeps the pre-approval.
        self.api(self.member).put(f"/api/team/sheets/{self.work.pk}/entries/{TODAY}/", {"slots": [self.calls.pk, self.calls.pk],
                                  "meta": [{"status": "done", "task": own["id"]}, {"status": "done"}]}, format="json")
        e.refresh_from_db()
        self.assertEqual((e.meta[1]["review"], e.meta[1]["task"]), ("approved", assigned["id"]))
