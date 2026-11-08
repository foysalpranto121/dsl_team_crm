"""SRS v0.5 §5.7 Stage Frameworks, with acceptance tests 8 (dated steps on working days), 10 (outcome → Client Log + rule) and
11 (Overloaded: steps held, supervisor sees it, clears when the backlog falls)."""
from datetime import date, datetime, timedelta
from datetime import timezone as tz
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from core.models import AuditLog
from mytasks.models import PersonalTask
from team import services as team_services
from team.models import JobRole, Sheet, SheetEntry, TeamSettings
from tracker.models import ClientLogEntry, Prospect

from . import services
from .models import Framework, FrameworkAssignment, OverloadFlag, StepInstance

NOW = datetime(2026, 11, 5, 6, 0, tzinfo=tz.utc)   # Thu 5 Nov 2026 in Dhaka; Friday is the weekend
D = date.fromisoformat
REC = {"requirement": "ERP for 40 users", "next_action": "Send the brochure", "next_follow_up": "2026-11-08"}
SIX = [  # acceptance test 8: a 6-step framework
    {"key": "s1", "title": "Discovery call", "day_offset": 0, "type": "call"},
    {"key": "s2", "title": "Send a case study", "day_offset": 1, "type": "email"},
    {"key": "s3", "title": "Follow-up call", "day_offset": 2, "type": "call"},
    {"key": "s4", "title": "Visit the decision maker", "day_offset": 3, "type": "visit"},
    {"key": "s5", "title": "Ask for the requirements", "day_offset": 5, "type": "email"},
    {"key": "s6", "title": "Requirements check", "day_offset": 8, "type": "call", "stop_on": ["Not interested"]},
]
RULES = [
    {"outcome": "No answer", "action": "retry", "retry_days": 2, "retry_max": 1},
    {"outcome": "Connected", "step_key": "s1", "action": "jump", "jump_key": "s4"},
    {"outcome": "Not interested", "action": "flag"},
]


class FrameworkTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        mk = lambda e, role: User.objects.create_user(e, name=e.split("@")[0].title(), status="approved", role=role)  # noqa: E731
        cls.member, cls.sup, cls.boss = mk("mina@x.com", "member"), mk("sup@x.com", "supervisor"), mk("boss@x.com", "viewer")
        st = TeamSettings.load()
        st.weekend_days, st.holidays = [5], ["2026-11-10"]           # Fridays off; Tue 10 Nov a holiday
        st.save()
        cls.role = JobRole.objects.get(name="International Sales (AI)")
        cls.sheet = Sheet.objects.create(name="Mina", owner=cls.member, role=cls.role)

    def setUp(self):
        p = mock.patch.object(team_services, "now", return_value=NOW)
        p.start()
        self.addCleanup(p.stop)

    def api(self, u=None):
        c = APIClient()
        c.force_authenticate(u or self.member)
        return c

    def build(self, steps=SIX, rules=RULES, stage="qualified", **extra):
        r = self.api(self.sup).post("/api/frameworks/items/", {"name": "14-day follow-up", "stage": stage, "steps": steps, "rules": rules, **extra}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        d = self.api(self.sup).post(f"/api/frameworks/items/{r.data['id']}/default/")
        self.assertEqual((d.status_code, d.data["is_default"]), (200, True))
        return r.data

    def add(self, company="Walton", **body):
        r = self.api().post("/api/tracker/prospects/", {"company": company, **REC, **body}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        return r.data

    def steps(self, pid):
        return list(StepInstance.objects.filter(record_id=pid).order_by("position", "attempt"))

    def complete(self, inst, outcome, **body):
        return self.api().post(f"/api/frameworks/steps/{inst.pk}/complete/", {"outcome": outcome, **body}, format="json")

    def test_calendar(self):
        cal = services.Calendar()
        thu = D("2026-11-05")
        self.assertEqual([cal.add(thu, n) for n in (0, 1, 2, 3, 4)], [thu, D("2026-11-07"), D("2026-11-08"), D("2026-11-09"), D("2026-11-11")])
        self.assertEqual(cal.add(D("2026-11-06"), 0), D("2026-11-07"))     # entering on a Friday: day 0 is Saturday
        self.assertEqual(cal.between(thu, D("2026-11-11")), 4)               # Sat, Sun, Mon, Wed

    def test_acceptance_8_dated_steps_on_working_days(self):
        self.assertEqual(self.api().post("/api/frameworks/items/", {"name": "x", "stage": "qualified", "steps": SIX}, format="json").status_code, 403)
        fw = self.build()
        self.assertEqual((fw["version"], len(fw["steps"]), fw["stage_name"]), (1, 6, "Qualified Lead"))
        self.assertEqual(len(self.api().get("/api/frameworks/items/").data), 1)             # members read the active ones
        p = self.add("Walton")                                       # at Lead: no framework there
        self.assertEqual(self.steps(p["id"]), [])
        r = self.api().patch(f"/api/tracker/prospects/{p['id']}/", {"stage": "qualified"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        got = [(s.title, s.due_date.isoformat(), s.status) for s in self.steps(p["id"])]
        self.assertEqual(got, [("Discovery call", "2026-11-05", "open"), ("Send a case study", "2026-11-07", "open"),   # Fri skipped
                               ("Follow-up call", "2026-11-08", "open"), ("Visit the decision maker", "2026-11-09", "open"),
                               ("Ask for the requirements", "2026-11-12", "open"),                                  # Tue 10 holiday
                               ("Requirements check", "2026-11-16", "open")])
        rec = self.api().get(f"/api/tracker/prospects/{p['id']}/").data
        self.assertEqual((rec["next_action"], rec["next_follow_up"], rec["framework"]["open"]), ("Discovery call", "2026-11-05", 6))   # FR-CL3
        # FR-CL3 met by the framework: a record added straight into the stage needs no typed next step
        q = self.api().post("/api/tracker/prospects/", {"company": "Square", "requirement": "HRM", "stage": "qualified"}, format="json")
        self.assertEqual((q.status_code, q.data["next_action"]), (201, "Discovery call"))
        self.assertEqual(self.api().get("/api/tracker/config/").data["framework_defaults"], [{"stage": "qualified", "segment": "", "name": "14-day follow-up", "steps": 6}])

    def test_acceptance_10_outcome_writes_log_and_applies_rule(self):
        self.build()
        p = self.add("Walton", stage="qualified")
        s1 = self.steps(p["id"])[0]
        self.assertEqual(self.complete(s1, "Maybe").status_code, 400)                      # only the framework's outcomes
        r = self.complete(s1, "No answer", note="Rang twice")
        self.assertEqual((r.status_code, r.data["result"]["action"]), (200, "retry"), r.data)
        log = ClientLogEntry.objects.filter(record_id=p["id"], type="call").first()           # FR-SF8
        self.assertEqual((log.outcome, log.note), ("No answer", "Discovery call: Rang twice"))
        retry = StepInstance.objects.get(record_id=p["id"], step_key="s1", attempt=2)
        self.assertEqual((retry.due_date, retry.status), (D("2026-11-08"), "open"))        # 2 working days: Sat, Sun
        self.assertEqual(log.next_date, D("2026-11-07"))                                     # next date pre-filled from the framework
        r = self.complete(retry, "No answer")
        self.assertEqual(r.data["result"]["action"], "next")                                 # max 1 retry: no third try
        self.assertFalse(StepInstance.objects.filter(record_id=p["id"], step_key="s1", attempt=3).exists())

        q = self.add("Square", stage="qualified")
        r = self.complete(self.steps(q["id"])[0], "Connected")                                # jump to s4
        self.assertEqual(r.data["result"]["action"], "jump")
        got = {s.step_key: (s.status, s.due_date.isoformat()) for s in self.steps(q["id"])}
        self.assertEqual(got, {"s1": ("done", "2026-11-05"), "s2": ("skipped", "2026-11-07"), "s3": ("skipped", "2026-11-08"),
                               "s4": ("open", "2026-11-07"), "s5": ("open", "2026-11-09"), "s6": ("open", "2026-11-14")})

        r = self.complete(self.steps(q["id"])[3], "Not interested")                         # flag for stage review
        self.assertEqual(r.data["result"]["action"], "flag")
        rv = self.api(self.sup).get("/api/tracker/reviews/").data["stages"]
        self.assertEqual([(x["company"], x["note"]) for x in rv], [("Square", "Visit the decision maker: Not interested")])
        self.assertEqual(self.api(self.sup).post(f"/api/frameworks/reviews/{rv[0]['id']}/", {"note": "Talk on Monday"}, format="json").status_code, 200)
        self.assertEqual(self.api(self.sup).get("/api/tracker/reviews/").data["stages"], [])
        self.complete(self.steps(q["id"])[4], "Done")
        last = self.steps(q["id"])[5]
        r = self.complete(last, "Connected")                                                  # FR-CL3: the last step needs a next action
        self.assertEqual((r.status_code, r.data.get("code")), (400, "next_required"))
        self.assertEqual(StepInstance.objects.get(pk=last.pk).status, "open")              # nothing half-saved
        r = self.complete(last, "Connected", next_date="2026-11-09", next_action="Book the demo")
        self.assertEqual(r.status_code, 200, r.data)
        rec = Prospect.objects.get(pk=q["id"])
        self.assertEqual((rec.next_action, rec.next_follow_up), ("Book the demo", D("2026-11-09")))
        self.assertFalse(FrameworkAssignment.objects.get(record_id=q["id"]).active)

        w = self.add("Akij", stage="qualified")                                              # a stop condition ends the framework
        for s in self.steps(w["id"])[:5]:
            self.complete(s, "Done")
        r = self.complete(self.steps(w["id"])[5], "Not interested", next_date="2026-11-09", next_action="Close it")
        self.assertEqual(r.data["result"]["action"], "stop")

    def test_stage_change_keep_or_drop_and_member_pick(self):
        self.build()
        self.build(steps=[{"key": "a1", "title": "Confirm the requirements", "day_offset": 0, "type": "email"}], rules=[], stage="requirements")
        p = self.add("Walton", stage="qualified")
        r = self.api().patch(f"/api/tracker/prospects/{p['id']}/", {"stage": "requirements", "old_steps": "drop"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        st = self.steps(p["id"])
        self.assertEqual(sorted({s.status for s in st if s.step_key.startswith("s")}), ["dropped"])
        self.assertTrue(ClientLogEntry.objects.filter(record_id=p["id"], note__startswith="Framework steps dropped").exists())   # never silently
        self.assertTrue(AuditLog.objects.filter(action="framework.drop_steps").exists())
        q = self.add("Square", stage="qualified")
        self.api().patch(f"/api/tracker/prospects/{q['id']}/", {"stage": "requirements"}, format="json")              # keep (the default)
        self.assertEqual(StepInstance.objects.filter(record_id=q["id"], status="open").count(), 7)
        # FR-SF4: another approved framework for one record
        alt = self.api(self.sup).post("/api/frameworks/items/", {"name": "Tender requirements", "stage": "requirements",
                                                                 "steps": [{"title": "Read the tender", "day_offset": 0, "type": "prep"}]}, format="json").data
        info = self.api().get(f"/api/frameworks/records/{q['id']}/").data
        self.assertEqual(sorted(c["name"] for c in info["choices"]), ["14-day follow-up", "Tender requirements"])
        r = self.api().post(f"/api/frameworks/records/{q['id']}/pick/", {"framework": alt["id"], "old_steps": "drop"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        info = self.api().get(f"/api/frameworks/records/{q['id']}/").data
        self.assertEqual((info["assignment"]["name"], info["assignment"]["chosen"]), ("Tender requirements", True))
        self.assertEqual(self.api(self.sup).post(f"/api/frameworks/records/{q['id']}/pick/", {"framework": alt["id"]}, format="json").status_code, 403)

    def test_acceptance_11_overloaded(self):
        st = TeamSettings.load()
        st.overload_items = 2
        st.save()
        self.build()
        old = [PersonalTask.objects.create(owner=self.member, title=f"Old {i}", due_date=D("2026-11-02")) for i in range(3)]
        load = self.api(self.sup).get("/api/frameworks/load/").data                        # the supervisor sees the note
        mina = next(x for x in load["people"] if x["name"] == "Mina")
        self.assertEqual((mina["overdue"], bool(mina["flag"])), (3, True))
        self.assertTrue(AuditLog.objects.filter(action="overload.raise").exists())
        p = self.add("Walton", stage="qualified")                                            # new steps wait in the queue
        self.assertEqual({s.status for s in self.steps(p["id"])}, {"held"})
        self.assertEqual(self.api().get("/api/frameworks/load/me/").data["waiting"], 6)
        self.assertEqual(self.complete(self.steps(p["id"])[0], "Done").status_code, 400)   # not forwarded yet
        for t in old[:2]:                                                                    # the backlog falls: the flag clears
            self.assertEqual(self.api().post(f"/api/tasks/items/{t.pk}/done/").status_code, 200)
        self.assertIsNotNone(OverloadFlag.objects.get(owner=self.member).cleared_at)
        self.assertEqual({s.status for s in self.steps(p["id"])}, {"open"})
        # a supervisor may override a raised flag: new steps go through
        PersonalTask.objects.create(owner=self.member, title="Late", due_date=D("2026-11-02"))
        PersonalTask.objects.create(owner=self.member, title="Later", due_date=D("2026-11-03"))
        flag = services.check(self.member.pk)
        self.assertIsNotNone(flag)
        self.assertEqual(self.api().post(f"/api/frameworks/load/{flag.pk}/override/").status_code, 403)
        self.assertEqual(self.api(self.sup).post(f"/api/frameworks/load/{flag.pk}/override/", {"note": "Busy week"}, format="json").status_code, 200)
        q = self.add("Square", stage="qualified")
        self.assertEqual({s.status for s in self.steps(q["id"])}, {"open"})

    def test_versions_apply_to_open_records(self):
        fw = self.build()
        p = self.add("Walton", stage="qualified")
        steps = [dict(s) for s in SIX]
        steps[1]["day_offset"] = 4                                                           # "Send a case study" moves later
        steps.append({"title": "Thank-you note", "day_offset": 9, "type": "email"})
        r = self.api(self.sup).put(f"/api/frameworks/items/{fw['id']}/", {"name": fw["name"], "stage": "qualified", "steps": steps, "rules": RULES}, format="json")
        self.assertEqual((r.status_code, r.data["version"], r.data["is_default"]), (200, 2, True), r.data)
        self.assertEqual(self.steps(p["id"])[1].due_date, D("2026-11-07"))                # edits affect new records only
        same = self.api(self.sup).patch(f"/api/frameworks/items/{fw['id']}/", {"description": "Two weeks"}, format="json")
        self.assertEqual(same.data["version"], 2)                                            # a new description isn't a new version
        pv = self.api(self.sup).get(f"/api/frameworks/items/{fw['id']}/preview/").data
        ch = {c["title"]: (c["change"], c["old"], c["new"]) for c in pv["records"][0]["changes"]}
        self.assertEqual(ch["Send a case study"], ("moved", D("2026-11-07"), D("2026-11-11")))   # 4 working days: Sat, Sun, Mon, Wed
        self.assertEqual(ch["Thank-you note"][0], "added")
        self.assertEqual(self.api(self.sup).post(f"/api/frameworks/items/{fw['id']}/apply/").data, {"records": 1})
        self.assertEqual(StepInstance.objects.get(record_id=p["id"], step_key="s2").due_date, D("2026-11-11"))
        self.assertEqual(FrameworkAssignment.objects.get(record_id=p["id"]).version, 2)
        self.assertEqual(len(self.api(self.sup).get(f"/api/frameworks/items/{fw['id']}/versions/").data), 2)
        self.assertEqual(self.api(self.sup).delete(f"/api/frameworks/items/{fw['id']}/").status_code, 400)   # used: switch it off instead

    def test_packs_and_log_hour(self):
        self.assertEqual(Framework.objects.count(), 0)                                       # FR-SF10: nothing until a pack is loaded
        self.assertEqual(self.api().post("/api/frameworks/packs/", {"key": "b2b-sales"}, format="json").status_code, 403)
        r = self.api(self.sup).post("/api/frameworks/packs/", {"key": "b2b-sales"}, format="json").data
        self.assertEqual((len(r["created"]), all(c["default"] for c in r["created"])), (7, True))
        self.assertEqual(len(self.api(self.sup).post("/api/frameworks/packs/", {"key": "b2b-sales"}, format="json").data["skipped"]), 7)
        # FR-SF2: a step with an Activity Type can fill an hour and earn its points
        task = self.role.tasks.filter(active=True).first()
        fw = Framework.objects.get(name="First contact")
        s = fw.steps.first()
        s.activity = task
        s.save()
        p = self.add("Walton")
        first = self.steps(p["id"])[0]
        r = self.complete(first, "Connected")
        self.assertEqual(r.data["free_hour"], 0, r.data)
        self.assertEqual(self.api().post(f"/api/frameworks/steps/{first.pk}/log-hour/", {"hour": 0}, format="json").status_code, 200)
        e = SheetEntry.objects.get(sheet=self.sheet, day=D("2026-11-05"))
        self.assertEqual((e.slots[0], e.meta[0].get("step")), (task.pk, first.pk))
        self.assertEqual(self.api().post(f"/api/frameworks/steps/{first.pk}/log-hour/", {"hour": 1}, format="json").status_code, 400)

    def test_drop_and_reschedule(self):
        self.build()
        p = self.add("Walton", stage="qualified")
        s1, s2 = self.steps(p["id"])[:2]
        self.assertEqual(self.api().post(f"/api/frameworks/steps/{s1.pk}/drop/", {"reason": ""}, format="json").status_code, 400)
        self.assertEqual(self.api().post(f"/api/frameworks/steps/{s1.pk}/drop/", {"reason": "Client asked for email only"}, format="json").status_code, 200)
        self.assertTrue(ClientLogEntry.objects.filter(record_id=p["id"], note__startswith="Step dropped: Discovery call").exists())
        r = self.api().post(f"/api/frameworks/steps/{s2.pk}/reschedule/", {"due_date": "2026-11-06"}, format="json")
        self.assertEqual(r.data["due_date"], "2026-11-07")                                   # Friday → the next working day
        self.assertEqual(Prospect.objects.get(pk=p["id"]).next_follow_up, D("2026-11-07"))
        self.assertEqual(self.api(self.sup).post(f"/api/frameworks/steps/{s2.pk}/drop/", {"reason": "nope"}, format="json").status_code, 404)
        self.assertEqual(self.api(self.boss).get(f"/api/frameworks/records/{p['id']}/").status_code, 200)    # management looks
        self.assertEqual(len(self.api().get("/api/frameworks/steps/?view=today").data), 0)
        self.assertEqual(len(self.api().get("/api/frameworks/steps/?view=upcoming").data), 5)
        self.assertEqual(TeamSettings.load().holidays, ["2026-11-10"])
        self.assertEqual(self.api(self.sup).get("/api/frameworks/load/").data["threshold_items"], 10)
        _ = timedelta
