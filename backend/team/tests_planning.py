"""Planning, approval and the hour-log rules (SRS v0.5 §5.2, §5.3, §6, D1)."""
from datetime import date, datetime
from datetime import timezone as tz
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from core.models import AuditLog

from . import services as team_services
from .models import JobRole, Sheet, SheetEntry, Task, TeamSettings, WeekPlan

NOW = datetime(2026, 10, 29, 4, 0, tzinfo=tz.utc)   # Thu 29 Oct 2026, 10:00 in Dhaka; weeks run Sat–Fri, Friday off
TODAY, NEXT_SAT, NEXT_SUN, NEXT_MON = date(2026, 10, 29), date(2026, 10, 31), date(2026, 11, 1), date(2026, 11, 2)


class PlanningTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        mk = lambda e, role: User.objects.create_user(e, name=e.split("@")[0].title(), status="approved", role=role)  # noqa: E731
        cls.admin, cls.sup, cls.member, cls.viewer = mk("admin@x.com", "admin"), mk("sup@x.com", "supervisor"), mk("mina@x.com", "member"), mk("boss@x.com", "viewer")
        st = TeamSettings.load()
        st.weekend_days = [5]
        st.save()
        role = JobRole.objects.get(name="International Sales (AI)")
        cls.calls = Task.objects.get(name="Make 8 Cold Calls")             # 1 pt
        cls.demo = Task.objects.get(name="Demo & Presentation Session")    # 10 pts
        cls.work = Sheet.objects.create(name="Mina", owner=cls.member, role=role, target_hours=40)
        cls.sup_work = Sheet.objects.create(name="Sup", owner=cls.sup, role=role, target_hours=40)

    def setUp(self):
        p = mock.patch.object(team_services, "now", return_value=NOW)
        p.start()
        self.addCleanup(p.stop)

    def api(self, u):
        c = APIClient()
        c.force_authenticate(u)
        return c

    def week(self, u, day, work=None):
        return self.api(u).get(f"/api/team/plans/week/?week={day}" + (f"&work={work}" if work else "")).data

    def plan(self, u, plan_id, day, slots):
        return self.api(u).put(f"/api/team/sheets/{plan_id}/entries/{day}/", {"slots": slots}, format="json")

    def decide(self, u, items, decision, **kw):
        body = {"items": [{"work": w, "day": str(d), "slot": s, "kind": k} for w, d, s, k in items], "decision": decision, **kw}
        return self.api(u).post("/api/team/board/decide/", body, format="json")

    def log(self, u, day, slots, meta=None):
        return self.api(u).put(f"/api/team/sheets/{self.work.pk}/entries/{day}/", {"slots": slots, **({"meta": meta} if meta else {})}, format="json")

    # ----- FR-P1, FR-P2, §6: plan → submit → approve all, part, reject, edit and approve -----
    def test_plan_states_from_draft_to_approved_hour_by_hour(self):
        w = self.week(self.member, NEXT_SAT)
        pid = w["plan_sheet"]
        self.assertEqual((w["status"], w["can"]["plan"]), (None, True))
        self.plan(self.member, pid, NEXT_SUN, [self.calls.pk, self.calls.pk, self.demo.pk])
        self.plan(self.member, pid, NEXT_MON, [self.demo.pk])
        w = self.week(self.member, NEXT_SAT)
        self.assertEqual((w["status"], w["counts"]["draft"], w["submittable"]), ("draft", 4, 4))
        r = self.api(self.member).post("/api/team/plans/action/", {"week": str(NEXT_SAT), "action": "submit", "goals": "Book 2 demos"}, format="json")
        self.assertEqual((r.status_code, r.data["status"], r.data["counts"]["submitted"], r.data["plan"]["goals"]), (200, "submitted", 4, "Book 2 demos"))
        locked = self.plan(self.member, pid, NEXT_SUN, [self.demo.pk, self.calls.pk, self.demo.pk])
        self.assertEqual(locked.status_code, 403)
        self.assertIn("Hour 1 is waiting for approval", str(locked.data))

        # Who may decide: supervisors and admins, never on their own plan; members and management can't.
        self.assertEqual(self.decide(self.member, [(self.work.pk, NEXT_SUN, 0, "plan")], "approve").status_code, 403)
        self.assertEqual(self.api(self.viewer).get("/api/team/board/").status_code, 403)
        board = self.api(self.sup).get(f"/api/team/board/?week={NEXT_SAT}").data
        mina = next(m for m in board["members"] if m["work"] == self.work.pk)
        self.assertEqual((mina["pending"]["plan"], board["pending"]["plan"], mina["status"]), (4, 4, "submitted"))
        self.assertEqual(self.decide(self.sup, [(self.work.pk, NEXT_SUN, 2, "plan")], "reject").status_code, 400)   # a comment is required

        # Approve part, reject part (with a comment) → partially approved.
        self.assertEqual(self.decide(self.sup, [(self.work.pk, NEXT_SUN, 0, "plan"), (self.work.pk, NEXT_SUN, 1, "plan"), (self.work.pk, NEXT_MON, 0, "plan")],
                                     "approve").data["changed"], 3)
        self.decide(self.sup, [(self.work.pk, NEXT_SUN, 2, "plan")], "reject", note="Too early for a demo; do follow-ups")
        w = self.week(self.member, NEXT_SAT)
        self.assertEqual((w["status"], w["status_label"], w["counts"]["approved"], w["counts"]["rejected"], w["plan"]["review_note"]),
                         ("partial", "Partially approved", 3, 1, "Too early for a demo; do follow-ups"))
        self.assertEqual(self.plan(self.member, pid, NEXT_SUN, [self.demo.pk, self.calls.pk, self.demo.pk]).status_code, 403)   # approved: binding

        # The rejected hour goes back to draft when changed; resubmit; the supervisor edits it and approves.
        self.assertEqual(self.plan(self.member, pid, NEXT_SUN, [self.calls.pk, self.calls.pk, self.calls.pk]).status_code, 200)
        self.assertEqual(self.week(self.member, NEXT_SAT)["counts"], {"draft": 1, "submitted": 0, "approved": 3, "rejected": 0})
        self.api(self.member).post("/api/team/plans/action/", {"week": str(NEXT_SAT), "action": "submit"}, format="json")
        self.decide(self.sup, [(self.work.pk, NEXT_SUN, 2, "plan")], "approve", task=self.demo.pk)
        w = self.week(self.member, NEXT_SAT)
        self.assertEqual((w["status"], w["days"][1]["slots"][:3], w["totals"]["approved"]), ("approved", [self.calls.pk, self.calls.pk, self.demo.pk], 4))
        self.assertTrue(AuditLog.objects.filter(action="review.plan.reject", detail__note="Too early for a demo; do follow-ups").exists())

        # Nobody approves their own plan.
        sup_plan = self.week(self.sup, NEXT_SAT)["plan_sheet"]
        self.plan(self.sup, sup_plan, NEXT_SUN, [self.calls.pk])
        self.api(self.sup).post("/api/team/plans/action/", {"week": str(NEXT_SAT), "action": "submit"}, format="json")
        self.assertEqual(self.decide(self.sup, [(self.sup_work.pk, NEXT_SUN, 0, "plan")], "approve").status_code, 403)
        self.assertEqual(self.decide(self.admin, [(self.sup_work.pk, NEXT_SUN, 0, "plan")], "approve").data["changed"], 1)

    # ----- FR-P6: the cut-off -----
    def test_a_days_plan_closes_at_the_end_of_the_previous_working_day(self):
        pid = self.week(self.member, TODAY)["plan_sheet"]
        late = self.plan(self.member, pid, TODAY, [self.calls.pk])
        self.assertEqual(late.status_code, 403)
        self.assertIn("had to be in by the end of Wed 28 Oct", str(late.data))
        self.assertEqual(self.plan(self.member, pid, NEXT_SAT, [self.calls.pk]).status_code, 200)   # Friday is off, so today is the last day for Saturday
        TeamSettings.objects.filter(pk=1).update(plan_cutoff="same_day")
        self.assertEqual(self.plan(self.member, pid, TODAY, [self.calls.pk]).status_code, 200)

    # ----- FR-T1–T3, D1, §6: logging against the approved plan -----
    def approve_today(self, slots):
        pid = self.week(self.admin, TODAY, self.work.pk)["plan_sheet"]
        self.plan(self.admin, pid, TODAY, slots)     # admins may plan any day
        self.api(self.admin).post("/api/team/plans/action/", {"week": str(TODAY), "work": self.work.pk, "action": "submit"}, format="json")
        self.decide(self.sup, [(self.work.pk, TODAY, i, "plan") for i in range(len(slots))], "approve")

    def test_deviations_count_zero_until_approved_and_unplanned_hours_count_provisionally(self):
        self.approve_today([self.calls.pk, self.demo.pk])
        log = self.api(self.member).get(f"/api/team/sheets/{self.work.pk}/entries/?from={TODAY}&to={TODAY}").data
        self.assertEqual(log["planned"], {str(TODAY): [self.calls.pk, self.demo.pk] + [None] * 8})
        no_reason = self.log(self.member, TODAY, [self.calls.pk, self.calls.pk])
        self.assertEqual(no_reason.status_code, 403)
        self.assertIn('the approved plan says "Demo & Presentation Session"', str(no_reason.data))
        r = self.log(self.member, TODAY, [self.calls.pk, self.calls.pk, None, self.calls.pk],
                     [{"status": "done"}, {"status": "done", "reason": "The client asked for a call instead"}, None, {"status": "done", "qty": 8}])
        self.assertEqual((r.status_code, r.data["logged"], r.data["hours"], r.data["points"]), (200, 3, 2, 2.0))   # the deviation waits
        meta = r.data["meta"]
        self.assertEqual((meta[1]["review"], meta[3]["unplanned"], meta[3].get("review"), meta[3]["qty"]), ("pending", True, None, 8))
        sup_bell = self.api(self.sup).get("/api/team/plans/mine/").data
        self.assertEqual(sup_bell["to_review"], 1)
        self.assertEqual(self.decide(self.sup, [(self.work.pk, TODAY, 1, "log")], "approve").data["changed"], 1)
        hours = lambda: SheetEntry.objects.get(sheet=self.work, day=TODAY)  # noqa: E731
        from .calc import day_hours
        self.assertEqual(day_hours(hours().counted_slots()), 3)
        # A supervisor flags an hour: it loses its points until unflagged (D1).
        self.decide(self.sup, [(self.work.pk, TODAY, 3, "log")], "flag", note="Not a real call block")
        self.assertEqual(day_hours(hours().counted_slots()), 2)
        self.decide(self.sup, [(self.work.pk, TODAY, 3, "log")], "unflag")
        self.assertEqual(day_hours(hours().counted_slots()), 3)
        # Strict mode: a new unplanned hour waits for approval.
        TeamSettings.objects.filter(pk=1).update(unplanned_mode="strict")
        r = self.log(self.member, TODAY, [self.calls.pk, self.calls.pk, None, self.calls.pk, self.calls.pk],
                     [{"status": "done"}, {"status": "done", "reason": "The client asked for a call instead"}, None, {"status": "done"}, {"status": "done"}])
        self.assertEqual((r.data["meta"][4]["review"], r.data["meta"][1]["review"], r.data["hours"]), ("pending", "approved", 3))
        # A planned hour marked Not done needs a reason and counts nothing.
        bad = self.log(self.member, TODAY, [None, self.calls.pk], [{"status": "not_done"}, {"status": "done", "reason": "The client asked for a call instead"}])
        self.assertEqual(bad.status_code, 403)
        r = self.log(self.member, TODAY, [None, self.calls.pk], [{"status": "not_done", "reason": "Client meeting ran over"}, {"status": "done", "reason": "The client asked for a call instead"}])
        self.assertEqual((r.data["meta"][0], r.data["hours"]), ({"status": "not_done", "reason": "Client meeting ran over", "planned": self.calls.pk}, 1))
        # History: 2 approved hours, 0 done as planned (one Not done, one deviation) → 0% adherence this week.
        h = self.api(self.member).get("/api/team/plans/history/").data["weeks"][0]
        self.assertEqual((h["week_start"], h["approved_hours"], h["logged_hours"], h["output_hours"], h["adherence"]), (date(2026, 10, 24), 2, 1, 1, 0.0))

    # ----- FR-P4: copy-forward and templates; withdraw -----
    def test_templates_copy_forward_and_withdraw(self):
        pid = self.week(self.member, NEXT_SAT)["plan_sheet"]
        self.plan(self.member, pid, NEXT_SUN, [self.calls.pk, self.demo.pk])
        self.plan(self.member, pid, NEXT_MON, [self.calls.pk])
        r = self.api(self.member).post("/api/team/plans/templates/", {"week": str(NEXT_SAT), "name": " Standard  week "}, format="json")
        self.assertEqual([(x["name"], x["hours"]) for x in r.data], [("Standard week", 3)])
        following = date(2026, 11, 7)
        r = self.api(self.member).post("/api/team/plans/copy/", {"week": str(following), "source": "template", "template": r.data[0]["id"]}, format="json")
        self.assertEqual((r.data["filled"], r.data["totals"]["hours"]), (2, 3))
        week3 = date(2026, 11, 14)
        r = self.api(self.member).post("/api/team/plans/copy/", {"week": str(week3), "source": "last_week"}, format="json")
        self.assertEqual(r.data["filled"], 2)
        r = self.api(self.member).post("/api/team/plans/copy/", {"week": str(NEXT_SAT), "source": "day", "day": str(NEXT_SUN)}, format="json")
        self.assertEqual(r.data["filled"], 4)   # Sat, Tue, Wed, Thu (Mon was planned already, Friday is off)
        self.api(self.member).post("/api/team/plans/action/", {"week": str(NEXT_SAT), "action": "submit"}, format="json")
        r = self.api(self.member).post("/api/team/plans/action/", {"week": str(NEXT_SAT), "action": "withdraw"}, format="json")
        self.assertEqual((r.data["hours"], r.data["status"]), (11, "draft"))
        self.assertEqual(WeekPlan.objects.get(sheet_id=pid, week_start=NEXT_SAT).slot_states[str(NEXT_SUN)], [])
