"""SRS v0.5 §5.8 Daily Playbook, with acceptance tests 9 (Home combines planned slots, framework steps, tasks, carried items and at most 3
suggestions; the ring updates as items complete; closing items auto-tick) and 13 (every suggestion shows evidence and can be dismissed; with
suggestions off the Playbook still works; none of it changes the composite score)."""
from datetime import date, datetime, timedelta
from datetime import timezone as tz
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from core.models import AuditLog
from frameworks.models import StepInstance
from mytasks.models import PersonalTask
from team import planning
from team import services as team_services
from team.models import JobRole, Sheet, SheetEntry, Task, TeamSettings, WeekPlan
from tracker.models import ClientLogEntry, Prospect

from .models import AiSuggestion, PlaybookDay

NOW = datetime(2026, 11, 5, 6, 0, tzinfo=tz.utc)   # Thu 5 Nov 2026, noon in Dhaka; weeks run Sat–Fri, Friday off
TODAY, YESTERDAY, TOMORROW = date(2026, 11, 5), date(2026, 11, 4), date(2026, 11, 7)    # the next working day is Saturday
WEEK = date(2026, 10, 31)
REC = {"requirement": "ERP for 40 users", "next_action": "Send the brochure", "next_follow_up": "2026-11-10"}
STEPS = [{"key": "s1", "title": "Discovery call", "day_offset": 0, "type": "call"}, {"key": "s2", "title": "Send a case study", "day_offset": 1, "type": "email"}]


class PlaybookTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        mk = lambda e, role: User.objects.create_user(e, name=e.split("@")[0].title(), status="approved", role=role)  # noqa: E731
        cls.member, cls.sup, cls.admin, cls.boss = mk("mina@x.com", "member"), mk("sup@x.com", "supervisor"), mk("admin@x.com", "admin"), mk("boss@x.com", "viewer")
        st = TeamSettings.load()
        st.weekend_days = [5]
        st.save()
        cls.role = JobRole.objects.get(name="International Sales (AI)")
        cls.calls = Task.objects.get(name="Make 8 Cold Calls")
        cls.demo = Task.objects.get(name="Demo & Presentation Session")
        cls.work = Sheet.objects.create(name="Mina", person="Mina", owner=cls.member, role=cls.role, target_hours=40, target_points=100)

    def setUp(self):
        for p in (mock.patch.object(team_services, "now", return_value=NOW), mock.patch("django.utils.timezone.now", return_value=NOW)):
            p.start()
            self.addCleanup(p.stop)

    def api(self, u=None):
        c = APIClient()
        c.force_authenticate(u or self.member)
        return c

    def today(self, u=None):
        r = self.api(u).get("/api/playbook/today/")
        self.assertEqual(r.status_code, 200, r.data)
        return r.data

    def plan(self, day=TODAY, slots=None):
        """An approved plan for the day."""
        plan_sheet = planning.plan_sheet_for(self.work, create=True)
        slots = slots or [self.calls.pk, self.demo.pk]
        SheetEntry.objects.create(sheet=plan_sheet, day=day, slots=slots)
        p, _ = WeekPlan.objects.get_or_create(sheet=plan_sheet, week_start=WEEK)
        p.slot_states = {**(p.slot_states or {}), day.isoformat(): ["approved"] * len(slots)}
        p.status = WeekPlan.Status.APPROVED
        p.save()

    def framework(self):
        fw = self.api(self.sup).post("/api/frameworks/items/", {"name": "Follow-up", "stage": "qualified", "steps": STEPS}, format="json").data
        self.api(self.sup).post(f"/api/frameworks/items/{fw['id']}/default/")

    def add(self, company="Walton", **body):
        r = self.api().post("/api/tracker/prospects/", {"company": company, **REC, **body}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        return r.data

    def keys(self, items):
        return [i["key"] for i in items]

    def test_acceptance_9_home_combines_everything_and_the_ring_follows(self):
        self.plan()
        self.framework()
        p = self.add("Walton", stage="qualified")                   # steps: day 0 today, day 1 on Saturday
        old = self.add("Square", stage="qualified")
        StepInstance.objects.filter(record_id=old["id"]).update(due_date=YESTERDAY)   # carried over
        StepInstance.objects.filter(record_id=old["id"], step_key="s2").update(status="skipped")
        t1 = PersonalTask.objects.create(owner=self.member, title="Prepare the brochure", due_date=TODAY)
        t2 = PersonalTask.objects.create(owner=self.member, title="Old task", due_date=YESTERDAY)
        d = self.today()
        self.assertEqual((d["phase"], d["primary"]["kind"], d["primary"]["label"]), ("morning", "open", "Start my day"))   # FR-DP1
        step = StepInstance.objects.get(record_id=p["id"], step_key="s1")
        carried = StepInstance.objects.get(record_id=old["id"], step_key="s1")
        self.assertEqual(self.keys(d["do_now"]), ["slot:0", "slot:1", f"step:{step.pk}", f"task:{t1.pk}", f"step:{carried.pk}", f"task:{t2.pk}"])   # P1, P2, P3, P4
        self.assertEqual(d["do_now"][0]["title"], "H-1 Make 8 Cold Calls")
        self.assertEqual(d["do_now"][2]["title"], "Day 0: Discovery call")
        self.assertTrue(d["do_now"][4]["carried"])                  # FR-DP7
        # FR-DP4: slots 2+2, step 2, task 1, carried step 2, carried task 1, four closing items 1 each = 14. The Client Log has nothing to do yet.
        self.assertEqual((d["ring"]["total"], d["ring"]["done"], d["ring"]["pct"]), (14, 1, 7))
        self.assertEqual([x["done"] for x in d["closing"]], [False, True, False, False, False])
        started = self.api().post("/api/playbook/today/", {"action": "start"}, format="json").data
        self.assertEqual((started["phase"], started["primary"]["label"], started["opened_at"], started["elapsed_seconds"], started["running"]), ("execute", "Do the next item", NOW, 0, True))
        self.assertEqual(started["primary"]["item"], "slot:0")

        r = self.api().post("/api/playbook/slot/", {"hour": 0, "status": "done"}, format="json")
        self.assertEqual((r.status_code, r.data["ring"]["done"]), (200, 4), r.data)    # the hour, and the timesheet ticks itself (FR-DP3)
        self.assertEqual(self.keys(r.data["done"]), ["slot:0"])
        self.assertTrue(next(x for x in r.data["closing"] if x["key"] == "timesheet")["done"])
        self.assertEqual(SheetEntry.objects.get(sheet=self.work, day=TODAY).slots[0], self.calls.pk)
        self.assertEqual(self.api().post("/api/playbook/slot/", {"hour": 1, "status": "not_done"}, format="json").status_code, 400)   # needs a reason
        r = self.api().post("/api/playbook/slot/", {"hour": 1, "status": "not_done", "reason": "Client postponed"}, format="json")
        self.assertTrue(next(x for x in r.data["closing"] if x["key"] == "missed")["done"])
        self.assertEqual(self.api().post("/api/playbook/slot/", {"hour": 7, "status": "done"}, format="json").status_code, 400)       # not planned
        # Doing the work where it lives moves the ring: a step's outcome, a task's Done
        self.assertEqual(self.api().post(f"/api/frameworks/steps/{step.pk}/complete/", {"outcome": "Connected"}, format="json").status_code, 200)
        self.assertEqual(self.api().post(f"/api/tasks/items/{t1.pk}/done/").status_code, 200)
        self.assertEqual(self.api().post(f"/api/frameworks/steps/{carried.pk}/complete/", {"outcome": "Done", "next_date": "2026-11-10", "next_action": "Call again"}, format="json").status_code, 200)
        self.assertEqual(self.api().post(f"/api/tasks/items/{t2.pk}/done/").status_code, 200)
        d = self.today()
        self.assertEqual(d["do_now"], [])
        self.assertEqual((d["phase"], d["primary"]["label"]), ("close", "Close my day"))  # FR-DP1
        self.assertEqual(d["ring"]["pct"], 93)                       # all but tomorrow's plan
        self.assertEqual(self.api().post("/api/playbook/note/", {"note": "Good day"}, format="json").status_code, 200)
        self.assertTrue(next(x for x in self.today()["closing"] if x["key"] == "note")["done"])
        plan_sheet = planning.plan_sheet_for(self.work)
        WeekPlan.objects.filter(sheet=plan_sheet, week_start=date(2026, 11, 7)).delete()
        WeekPlan.objects.create(sheet=plan_sheet, week_start=date(2026, 11, 7), status="submitted", slot_states={TOMORROW.isoformat(): ["submitted"]})
        d = self.today()
        self.assertEqual((d["ring"]["pct"], d["ring"]["message"]), (100, "Everything's done. Well done."))
        closed = self.api().post("/api/playbook/today/", {"action": "close"}, format="json").data
        self.assertEqual((closed["phase"], closed["primary"], closed["running"], closed["closed_at"]), ("closed", None, False, NOW))
        self.assertTrue(PlaybookDay.objects.get(owner=self.member, day=TODAY).snapshot["closed"])     # FR-DP6
        self.assertEqual(self.api().post("/api/playbook/today/", {"action": "reopen"}, format="json").data["phase"], "close")

    def test_fix_now_stays_on_the_ring_once_dealt_with(self):
        p = self.add("Walton")                                      # at Lead, no framework there: waiting for first contact
        plan_sheet = planning.plan_sheet_for(self.work, create=True)
        SheetEntry.objects.create(sheet=plan_sheet, day=TOMORROW, slots=[self.calls.pk])
        WeekPlan.objects.create(sheet=plan_sheet, week_start=date(2026, 11, 7), status="rejected", slot_states={TOMORROW.isoformat(): ["rejected"]})
        self.api().post("/api/playbook/today/", {"action": "start"}, format="json")
        d = self.today()
        self.assertEqual(self.keys(d["do_now"]), ["plan-rejected:2026-11-07", f"lead:{p['id']}"])
        self.assertEqual((d["do_now"][1]["weight"], d["phase"], d["primary"]["label"]), (3, "morning", "Fix this first"))
        before = d["ring"]["done"]
        self.assertEqual(self.api().post(f"/api/tracker/prospects/{p['id']}/log/", {"type": "call", "outcome": "Reached them"}, format="json").status_code, 201)
        d = self.today()
        self.assertNotIn(f"lead:{p['id']}", self.keys(d["do_now"]))
        self.assertIn(f"lead:{p['id']}", self.keys(d["done"]))       # still counted, as done
        self.assertEqual(d["ring"]["done"], before + 3)
        self.assertEqual(self.today()["ring"]["done"], before + 3)   # and it stays that way

    def test_a_dated_next_action_is_on_the_list(self):
        p = self.add("Walton", next_follow_up=str(TODAY), stage="qualified")
        d = self.today()
        self.assertEqual((d["do_now"][0]["key"], d["do_now"][0]["title"], d["do_now"][0]["group"]), (f"next:{p['id']}", "Walton: Send the brochure", "step"))
        self.api().post(f"/api/tracker/prospects/{p['id']}/log/", {"type": "call", "outcome": "Reached", "next_date": "2026-11-10", "next_action": "Call again"}, format="json")
        d = self.today()
        self.assertEqual(d["do_now"], [])
        self.assertIn(f"next:{p['id']}", self.keys(d["done"]))

    def test_carry_over_after_three_days_asks_for_a_decision(self):
        t = PersonalTask.objects.create(owner=self.member, title="Very old task", due_date=date(2026, 10, 29), activity=self.calls)     # 5 working days
        fresh = PersonalTask.objects.create(owner=self.member, title="Bare task", due_date=date(2026, 10, 29))
        recent = PersonalTask.objects.create(owner=self.member, title="Recent", due_date=YESTERDAY)
        d = {i["key"]: i for i in self.today()["do_now"]}
        self.assertEqual((d[f"task:{t.pk}"]["decide"], d[f"task:{recent.pk}"]["decide"]), (True, False))
        self.assertEqual(self.api().post("/api/playbook/add-to-plan/", {"type": "task", "id": fresh.pk}, format="json").status_code, 400)     # no Activity Type
        r = self.api().post("/api/playbook/add-to-plan/", {"type": "task", "id": t.pk}, format="json")
        self.assertEqual((r.status_code, r.data["day"], r.data["hour"]), (200, TOMORROW, 0), r.data)
        t.refresh_from_db()
        self.assertEqual(t.due_date, TOMORROW)
        self.assertEqual(SheetEntry.objects.get(sheet=planning.plan_sheet_for(self.work), day=TOMORROW).slots, [self.calls.pk])
        self.assertNotIn(f"task:{t.pk}", self.keys(self.today()["do_now"]))    # moved to another day: not on today's list

    def test_yesterdays_missed_hour_carries_until_done_or_let_go(self):
        self.plan(day=YESTERDAY, slots=[self.calls.pk])
        d = self.today()
        key = f"missed:{YESTERDAY}:0"
        self.assertEqual((d["do_now"][0]["key"], d["do_now"][0]["carried"], d["do_now"][0]["acknowledge"]), (key, True, True))
        self.assertEqual(self.api().post("/api/playbook/let-go/", {"key": "step:1"}, format="json").status_code, 400)
        r = self.api().post("/api/playbook/let-go/", {"key": key, "reason": "Client cancelled"}, format="json")
        self.assertEqual((r.status_code, r.data["do_now"]), (200, []), r.data)
        self.assertTrue(AuditLog.objects.filter(action="playbook.let_go").exists())       # FR-DP7: drops are logged
        self.assertEqual(self.today()["do_now"], [])

    def test_do_now_cap_weights_and_settings(self):
        for i in range(5):
            PersonalTask.objects.create(owner=self.member, title=f"Task {i}", due_date=TODAY)
        d = self.today()
        self.assertEqual(len(d["do_now"]), 5)
        c = self.api(self.admin)
        self.assertEqual(c.patch("/api/team/settings/", {"playbook": {"do_now_cap": 0}}, format="json").status_code, 400)
        self.assertEqual(c.patch("/api/team/settings/", {"playbook": {"tone": "shouty"}}, format="json").status_code, 400)
        r = c.patch("/api/team/settings/", {"playbook": {"do_now_cap": 2, "weights": {"task": 4, "closing": 0}, "tone": "plain", "phases": {"close": "Wrap up"}, "closing": {"note": False}}}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        d = self.today()
        self.assertEqual((len(d["do_now"]), len(d["up_next"]), d["ring"]["total"]), (2, 3, 20))      # FR-DP2, FR-DP11
        self.assertEqual((d["phase_labels"]["close"], d["ring"]["message"]), ("Wrap up", "Your list is ready."))
        self.assertNotIn("note", [x["key"] for x in d["closing"]])
        c.patch("/api/team/settings/", {"playbook": {"sources": {"task": False}}}, format="json")
        self.assertEqual(self.today()["do_now"], [])

    def test_acceptance_13_suggestions_show_evidence_can_be_dismissed_and_can_be_off(self):
        rows = [self.add(f"Client {i}", stage="qualified", value="1000") for i in range(5)]
        Prospect.objects.filter(pk__in=[r["id"] for r in rows]).update(last_contacted=TODAY - timedelta(days=20), next_follow_up=date(2026, 11, 20))
        d = self.today()
        self.assertEqual(len(d["suggested"]), 3)                     # at most three
        s = d["suggested"][0]
        self.assertIn("untouched for 20 days", s["title"])
        self.assertTrue(s["why"].startswith("Last contact"))         # the evidence
        self.assertIn("/tracker?tab=pipeline&record=", s["to"])
        self.assertEqual(self.api().post(f"/api/playbook/suggestions/{s['id']}/", {"useful": True}, format="json").status_code, 200)
        self.assertEqual(AiSuggestion.objects.get(pk=s["id"]).feedback, "useful")
        self.assertEqual(self.api(self.sup).post(f"/api/playbook/suggestions/{s['id']}/", {"dismiss": True}, format="json").status_code, 400)   # someone else's
        self.assertEqual(self.api().post(f"/api/playbook/suggestions/{s['id']}/", {"dismiss": True}, format="json").status_code, 200)
        after = self.today()["suggested"]
        self.assertEqual(len(after), 3)
        self.assertNotIn(s["id"], [x["id"] for x in after])          # it doesn't come back
        _, perf = team_services.performance_rows(2026, TODAY)
        ring_free = [m.get("score") for m in perf[0]["months"]]
        # Suggestions off: the Playbook works the same
        self.api(self.admin).patch("/api/team/settings/", {"playbook": {"sources": {"suggested": False}}}, format="json")
        off = self.today()
        self.assertEqual(off["suggested"], [])
        self.assertIn("ring", off)
        self.api().post("/api/playbook/today/", {"action": "close"}, format="json")
        _, perf = team_services.performance_rows(2026, TODAY)
        self.assertEqual([m.get("score") for m in perf[0]["months"]], ring_free)   # the Playbook never changes the composite (§7)

    def test_reminders_notes_and_light_days(self):
        p = self.add("Walton", tender_deadline="2026-11-07", next_follow_up="2026-11-10")
        d = self.today()
        self.assertIn("Tender closes in 2 days: Walton", [x["title"] for x in d["reminders"]])
        self.assertEqual(self.api().post("/api/playbook/note/", {"text": "x"}, format="json").status_code, 400)
        self.assertEqual(self.api().post("/api/playbook/note/", {"text": "Asked for the price list", "client": p["id"]}, format="json").data, {"client": "Walton"})
        self.assertTrue(ClientLogEntry.objects.filter(record_id=p["id"], type="note", note="Asked for the price list").exists())   # FR-DP5
        self.assertEqual(self.api().post("/api/playbook/note/", {"text": "Not mine", "client": 999999}, format="json").status_code, 400)
        self.api().post("/api/playbook/note/", {"text": "Call the bank"}, format="json")
        d = self.today()
        self.assertEqual(d["note"], "Call the bank")
        self.assertEqual(d["light"]["free_hours"], 10)               # FR-DP8
        self.assertIn("need 40 more output hours", d["light"]["message"])

    def test_the_supervisors_lens_shows_completion_not_contents(self):
        PersonalTask.objects.create(owner=self.member, title="Private thing", due_date=TODAY)
        self.today()
        self.api().post("/api/playbook/today/", {"action": "start"}, format="json")
        self.assertIsNone(self.today()["lens"])
        lens = self.today(self.sup)["lens"]
        row = next(x for x in lens["people"] if x["name"] == "Mina")
        self.assertEqual((row["started"], row["closed"], row["yesterday_closed"], row["overloaded"]), (True, False, False, False))
        self.assertEqual(row["pct"], 40)                              # 2 of 5: nothing to log and nothing missed yet
        self.assertNotIn("Private thing", str(lens))                  # FR-DP9
        self.assertEqual(self.api(self.boss).get("/api/playbook/today/").status_code, 403)
        admin = self.today(self.admin)
        self.assertEqual(admin["has_log"], False)                     # an admin has no daily log, but has the lens
        self.assertEqual([x["key"] for x in admin["closing"]], ["client_log", "note"])
        hist = self.api().get("/api/playbook/history/").data
        self.assertEqual(hist, [])
        PlaybookDay.objects.create(owner=self.member, day=YESTERDAY, snapshot={"pct": 70, "seconds": 3600}, closed_at=NOW)
        self.assertEqual(self.api().get("/api/playbook/history/").data, [{"day": YESTERDAY, "pct": 70, "closed": True, "minutes": 60}])
