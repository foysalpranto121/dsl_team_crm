"""SRS v0.5 §5.11 Recognition (FR-MO2–MO6, D11, NFR-10), including acceptance test 13: recognition never changes the composite score."""
from datetime import date, datetime, timedelta
from datetime import timezone as tz
from unittest import mock

from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from accounts.models import User
from core.models import AuditLog
from playbook.models import PlaybookDay
from scoring.models import EventLog
from team import services as team_services
from team.models import JobRole, Sheet, SheetEntry, Task, TeamSettings

from . import calc as rc
from . import services
from .models import BadgeAward, FeedPost

NOW = datetime(2026, 11, 5, 6, 0, tzinfo=tz.utc)   # Thu 5 Nov 2026 in Dhaka; weeks run Sat–Fri, Friday off
TODAY = date(2026, 11, 5)
REC = {"requirement": "ERP for 40 users", "next_action": "Send the brochure", "next_follow_up": "2026-11-10"}


class CalcTests(SimpleTestCase):
    def test_day_streaks_skip_days_off_and_dont_break_on_today(self):
        off = lambda d: d.weekday() == 4     # noqa: E731  (Friday)
        closed = {date(2026, 10, 28), date(2026, 10, 29), date(2026, 10, 31), date(2026, 11, 1)}   # Wed, Thu, (Fri off), Sat, Sun
        cur, best, reached = rc.day_streaks(closed, date(2026, 10, 28), date(2026, 11, 1), off)
        self.assertEqual((cur, best, reached[4]), (4, 4, date(2026, 11, 1)))
        self.assertEqual(rc.day_streaks(closed, date(2026, 10, 28), date(2026, 11, 2), off)[0], 4)      # today isn't closed yet: still alive
        self.assertEqual(rc.day_streaks(closed, date(2026, 10, 28), date(2026, 11, 3), off)[:2], (0, 4))   # yesterday wasn't: it starts again
        self.assertEqual(rc.day_streaks(closed, date(2026, 10, 28), date(2026, 11, 3), lambda d: off(d) or d == date(2026, 11, 2))[0], 4)   # on leave: not broken

    def test_week_streaks_and_comeback(self):
        w = lambda n, hours, target=40: {"start": date(2026, 1, 1) + timedelta(days=7 * n), "hours": hours, "target": target}   # noqa: E731
        weeks = [w(0, 40), w(1, 45), w(2, 10), w(3, 5), w(4, 0, None), w(5, 41), w(6, 40)]
        cur, best, reached = rc.week_streaks(weeks)
        self.assertEqual((cur, best, reached[1], reached[2]), (2, 2, weeks[0]["start"], weeks[1]["start"]))
        self.assertEqual(rc.comeback(weeks), weeks[5]["start"])           # two low weeks, a week off, then back on target
        self.assertIsNone(rc.comeback([w(0, 40), w(1, 35), w(2, 40)]))     # one week at 87% isn't a comeback


class RecognitionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        mk = lambda e, role: User.objects.create_user(e, name=e.split("@")[0].title(), status="approved", role=role)  # noqa: E731
        cls.member, cls.other, cls.sup, cls.boss, cls.admin = mk("mina@x.com", "member"), mk("rafi@x.com", "member"), mk("sup@x.com", "supervisor"), mk("boss@x.com", "viewer"), mk("admin@x.com", "admin")
        st = TeamSettings.load()
        st.weekend_days = [5]
        st.save()
        cls.role = JobRole.objects.get(name="International Sales (AI)")
        cls.calls = Task.objects.get(name="Make 8 Cold Calls")
        cls.work = Sheet.objects.create(name="Mina", person="Mina", owner=cls.member, role=cls.role, target_hours=5, target_points=100, start_date=date(2026, 10, 3))
        cls.rafi = Sheet.objects.create(name="Rafi", person="Rafi", owner=cls.other, role=cls.role, target_hours=5, start_date=date(2026, 10, 3))

    def setUp(self):
        for p in (mock.patch.object(team_services, "now", return_value=NOW), mock.patch("django.utils.timezone.now", return_value=NOW)):
            p.start()
            self.addCleanup(p.stop)

    def api(self, u=None):
        c = APIClient()
        c.force_authenticate(u or self.member)
        return c

    def me(self, u=None, work=None):
        r = self.api(u).get("/api/recognition/me/" + (f"?work={work}" if work else ""))
        self.assertEqual(r.status_code, 200, r.data)
        return r.data

    def week(self, ws, hours=5, sheet=None):
        SheetEntry.objects.create(sheet=sheet or self.work, day=ws, slots=[self.calls.pk] * hours)

    def win(self, company="Walton", message=""):
        p = self.api().post("/api/tracker/prospects/", {"company": company, "stage": "negotiation", "value": "500000", **REC}, format="json").data
        self.api().patch(f"/api/tracker/prospects/{p['id']}/", {"stage": "won", "win_loss_why": "Best fit"}, format="json")
        r = self.api(self.sup).post(f"/api/tracker/reviews/wins/{p['id']}/", {"verified": True, "note": message}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        return p

    def test_streaks_and_days_off(self):
        self.assertEqual(self.me()["streaks"], {"days": {"current": 0, "best": 0}, "weeks": {"current": 0, "best": 0}})
        for d in (date(2026, 11, 2), date(2026, 11, 4)):                 # Mon and Wed closed; Tue missed
            PlaybookDay.objects.create(owner=self.member, day=d, closed_at=NOW)
        self.assertEqual(self.me()["streaks"]["days"], {"current": 1, "best": 1})
        r = self.api().post("/api/recognition/leave/", {"day": "2026-11-03", "reason": "Family"}, format="json")      # leave never breaks a streak
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(self.me()["streaks"]["days"], {"current": 2, "best": 2})
        self.assertEqual(self.api().post("/api/recognition/leave/", {"day": "2026-11-03"}, format="json").status_code, 400)   # already marked
        self.assertEqual(self.api().post("/api/recognition/leave/", {"day": "2026-11-06"}, format="json").status_code, 400)   # Friday is already off
        self.assertEqual(self.api().post("/api/recognition/leave/", {"day": "2026-01-01"}, format="json").status_code, 400)   # too far back
        self.assertEqual(self.api(self.other).delete(f"/api/recognition/leave/{r.data['id']}/").status_code, 400)            # not theirs
        self.assertEqual(self.api().delete(f"/api/recognition/leave/{r.data['id']}/").status_code, 204)
        self.assertEqual(self.me()["streaks"]["days"], {"current": 1, "best": 1})
        self.week(date(2026, 10, 24))                                     # last week, on target
        self.assertEqual(self.me()["streaks"]["weeks"]["current"], 1)
        self.assertEqual(self.api(self.other).get(f"/api/recognition/me/?work={self.work.pk}").status_code, 403)
        self.assertEqual(self.me(self.sup, self.work.pk)["mine"], False)

    def test_the_five_badges(self):
        self.assertEqual([b["name"] for b in self.me()["badges"]], ["First Work Order", "First On-Target Week", "4-Week On-Target Streak", "Comeback", "10-Day Closer"])
        self.assertTrue(all(b["earned_on"] is None for b in self.me()["badges"]))
        self.week(date(2026, 10, 17))                                     # after two quiet weeks: a first on-target week and a comeback, long enough ago to be quiet
        got = {b["key"]: b["earned_on"] for b in self.me()["badges"]}
        self.assertEqual((got["first_on_target"], got["comeback"]), (date(2026, 10, 17), date(2026, 10, 17)))
        self.assertIsNotNone(BadgeAward.objects.get(owner=self.member, badge="comeback").seen_at)      # old: no pop-up
        self.assertFalse(FeedPost.objects.filter(kind="badge").exists())                                # and no feed post
        self.week(date(2026, 10, 24))
        self.week(date(2026, 10, 31))
        self.assertIsNone({b["key"]: b["earned_on"] for b in self.me()["badges"]}["on_target_4"])        # three in a row
        # a badge earned just now does get a post and a quiet note
        for i in range(13):
            d = TODAY - timedelta(days=i)
            if d.weekday() != 4:
                PlaybookDay.objects.get_or_create(owner=self.member, day=d, defaults={"closed_at": NOW})
        c = self.api().get("/api/recognition/celebrate/").data
        self.assertEqual([b["name"] for b in c["badges"]], ["10-Day Closer"])
        self.assertEqual(self.api().post("/api/recognition/celebrate/", {"badges": [c["badges"][0]["id"]]}, format="json").status_code, 200)
        self.assertEqual(self.api().get("/api/recognition/celebrate/").data["badges"], [])
        self.assertEqual(self.api().get("/api/recognition/feed/").data["posts"][0]["title"], "Mina earned 10-Day Closer")

    def test_a_verified_win_is_celebrated_and_posted(self):
        p = self.win("Walton", "Great work on this one")
        c = self.api().get("/api/recognition/celebrate/").data
        self.assertEqual((c["wins"][0]["company"], c["wins"][0]["value"], c["wins"][0]["message"], c["wins"][0]["by"]), ("Walton", 500000, "Great work on this one", "Sup"))   # FR-MO4
        self.assertIn("First Work Order", [b["name"] for b in c["badges"]])
        self.assertEqual(self.api(self.other).get("/api/recognition/celebrate/").data["wins"], [])              # only the person's own
        self.api().post("/api/recognition/celebrate/", {"posts": [c["wins"][0]["id"]]}, format="json")
        self.assertEqual(self.api().get("/api/recognition/celebrate/").data["wins"], [])
        self.api(self.sup).post(f"/api/tracker/reviews/wins/{p['id']}/", {"verified": True}, format="json")      # verifying twice doesn't post twice
        self.assertEqual(FeedPost.objects.filter(kind="win").count(), 1)
        # D11: the client's name shows by policy, the value only if it's switched on; the person and supervisors always see theirs
        post = next(x for x in self.api(self.other).get("/api/recognition/feed/").data["posts"] if x["kind"] == "win")
        self.assertEqual((post["title"], post["company"], post["value"]), ("Mina won Walton", "Walton", None))
        self.assertEqual(next(x for x in self.api().get("/api/recognition/feed/").data["posts"] if x["kind"] == "win")["value"], 500000)
        self.api(self.admin).patch("/api/team/settings/", {"recognition": {"show_client": False, "show_value": True}}, format="json")
        post = next(x for x in self.api(self.boss).get("/api/recognition/feed/").data["posts"] if x["kind"] == "win")     # management sees the feed
        self.assertEqual((post["title"], post["company"], post["value"]), ("Mina won a new client", None, 500000))
        # FR-MO5: reactions
        c = self.api(self.other)
        self.assertEqual(c.post(f"/api/recognition/feed/{post['id']}/react/", {"kind": "nope"}, format="json").status_code, 400)
        self.assertEqual(c.post(f"/api/recognition/feed/{post['id']}/react/", {"kind": "clap"}, format="json").status_code, 200)
        got = next(x for x in c.get("/api/recognition/feed/").data["posts"] if x["id"] == post["id"])
        self.assertEqual((got["reactions"]["clap"], got["reacted"]), (1, ["clap"]))
        c.post(f"/api/recognition/feed/{post['id']}/react/", {"kind": "clap"}, format="json")                    # tap again: taken back
        self.assertEqual(next(x for x in c.get("/api/recognition/feed/").data["posts"] if x["id"] == post["id"])["reactions"]["clap"], 0)
        # The win no longer stands: its post goes
        self.api().patch(f"/api/tracker/prospects/{p['id']}/", {"stage": "negotiation", "next_action": "Again", "next_follow_up": "2026-11-10"}, format="json")
        self.assertFalse(FeedPost.objects.filter(kind="win").exists())

    def test_the_first_win_badge_goes_when_the_only_win_does(self):
        has = lambda: (BadgeAward.objects.filter(owner=self.member, badge="first_work_order").exists(), FeedPost.objects.filter(owner=self.member, kind="badge", badge="first_work_order").exists())   # noqa: E731
        again = {"stage": "negotiation", "next_action": "Again", "next_follow_up": "2026-11-10"}
        ways = {
            "left Won": lambda p: self.api().patch(f"/api/tracker/prospects/{p['id']}/", again, format="json"),
            "sent back": lambda p: self.api(self.sup).post(f"/api/tracker/reviews/wins/{p['id']}/", {"verified": False, "note": "Not signed yet"}, format="json"),
            "deleted": lambda p: self.api().delete(f"/api/tracker/prospects/{p['id']}/"),
        }
        for name, undo in ways.items():
            with self.subTest(name):
                p = self.win(f"Client {name}")
                self.api().get("/api/recognition/celebrate/")
                self.assertEqual(has(), (True, True))
                self.assertIn(undo(p).status_code, (200, 204))
                self.assertEqual(has(), (False, False))
        # With another win still standing, it stays.
        first = self.win("Walton")
        self.win("Akij")
        self.api().get("/api/recognition/celebrate/")
        self.api().delete(f"/api/tracker/prospects/{first['id']}/")
        self.assertEqual(has(), (True, True))

    def test_a_win_logged_as_an_event_when_kpis_are_typed(self):
        TeamSettings.objects.filter(pk=1).update(kpi_mode="manual")
        order = Task.objects.get(name="Client Work Order Receiving")
        self.role.tasks.add(order)
        r = self.api().post("/api/scoring/events/", {"sheet": self.work.pk, "day": str(TODAY), "activity": order.pk, "evidence": "WO-114"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertFalse(FeedPost.objects.exists())
        self.api(self.sup).post(f"/api/scoring/events/{r.data['id']}/decide/", {"verified": True}, format="json")
        self.assertEqual(FeedPost.objects.get(kind="win").company, "WO-114")
        # The evidence note isn't a client's name, so neither the feed nor the moment reads it as one.
        self.assertEqual(self.api(self.other).get("/api/recognition/feed/").data["posts"][0]["title"], "Mina: Client Work Order Receiving")
        self.assertEqual(self.api().get("/api/recognition/celebrate/").data["wins"][0]["title"], "Client Work Order Receiving: verified")
        self.api(self.sup).post(f"/api/scoring/events/{r.data['id']}/decide/", {"verified": False, "note": "Wrong one"}, format="json")
        self.assertFalse(FeedPost.objects.exists())
        self.assertEqual(EventLog.objects.get(pk=r.data["id"]).status, "rejected")

    def test_supervisor_prompts_and_thanks(self):
        self.week(date(2026, 10, 24))                                     # Mina hit last week's target, for the first time
        self.me()                                                         # awards her badges
        lens = self.api(self.sup).get("/api/playbook/today/").data["lens"]
        texts = [p["text"] for p in lens["prompts"]]
        self.assertIn("Mina had a first on-target week. Send a word of thanks?", texts)         # FR-MO6
        self.assertIn("Rafi hasn't had any recognition for 30 days. Anything worth a word?", texts)
        self.assertEqual(self.api().post("/api/recognition/thanks/", {"work": self.work.pk, "message": "Well done"}, format="json").status_code, 403)
        self.assertEqual(self.api(self.sup).post("/api/recognition/thanks/", {"work": self.work.pk, "message": ""}, format="json").status_code, 400)
        self.assertEqual(self.api(self.sup).post("/api/recognition/thanks/", {"work": self.work.pk, "message": "Well done"}, format="json").status_code, 200)
        self.assertTrue(AuditLog.objects.filter(action="recognition.thanks").exists())
        self.assertEqual(self.api().get("/api/recognition/feed/").data["posts"][0]["title"], "Sup thanked Mina")
        texts = [p["text"] for p in self.api(self.sup).get("/api/playbook/today/").data["lens"]["prompts"]]
        self.assertNotIn("Mina had a first on-target week. Send a word of thanks?", texts)      # said it

    def test_each_part_can_be_switched_off_and_the_score_never_moves(self):
        self.win("Walton")
        self.me()
        _, perf = team_services.performance_rows(2026, TODAY)
        scores = [[m.get("score") for m in r["months"]] for r in perf]
        c = self.api(self.admin)
        self.assertEqual(c.patch("/api/team/settings/", {"recognition": "x"}, format="json").status_code, 400)
        r = c.patch("/api/team/settings/", {"recognition": {"streaks": False, "badges": False, "wins": False, "reactions": False, "prompts": False, "rings": False, "recap": False}}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["recognition"]["show_client"], True)      # what it didn't mention stays
        d = self.me()
        self.assertEqual((d["streaks"], d["badges"]), (None, None))
        self.assertEqual(self.api().get("/api/recognition/feed/").data, {"enabled": False, "reactions": False, "posts": []})
        self.assertEqual(self.api().get("/api/recognition/celebrate/").data, {"wins": [], "badges": []})
        self.assertEqual(self.api(self.sup).get("/api/playbook/today/").data["lens"]["prompts"], [])
        pr = self.api().get("/api/progress/me/").data
        self.assertEqual((pr["rings"], pr["recap"]), (None, None))
        _, perf = team_services.performance_rows(2026, TODAY)
        self.assertEqual([[m.get("score") for m in r["months"]] for r in perf], scores)      # acceptance test 13: switching it off moves no score
        self.assertEqual(services.config()["wins"], False)
