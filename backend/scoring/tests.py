"""SRS v0.5 §5.4, §7, D2: the score ledger, with acceptance tests 4 (changing a points value doesn't alter last month's score unless a
recalculation is run) and 6 (every number drills down to ledger entries)."""
from datetime import date, datetime
from datetime import timezone as tz
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from core.models import AuditLog
from team import calc, planning, snapshots
from team import services as team_services
from team.models import JobRole, Sheet, SheetEntry, Task, TeamSettings
from tracker.models import Prospect

from . import services
from .models import EventLog, ScoreLedger, ScoringVersion

NOW = datetime(2026, 11, 5, 6, 0, tzinfo=tz.utc)   # Thu 5 Nov 2026 in Dhaka; weeks run Sat–Fri, Friday off
OCT15, NOV3 = date(2026, 10, 15), date(2026, 11, 3)
TODAY = date(2026, 11, 5)
NEXT = {"requirement": "ERP for 40 users", "next_action": "Send the brochure", "next_follow_up": "2026-11-08"}


class LedgerTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        mk = lambda e, role: User.objects.create_user(e, name=e.split("@")[0].title(), status="approved", role=role)  # noqa: E731
        cls.member, cls.sup, cls.admin, cls.boss = mk("mina@x.com", "member"), mk("sup@x.com", "supervisor"), mk("admin@x.com", "admin"), mk("boss@x.com", "viewer")
        st = TeamSettings.load()
        st.weekend_days = [5]
        st.save()
        cls.role = JobRole.objects.get(name="International Sales (AI)")
        cls.calls = Task.objects.get(name="Make 8 Cold Calls")             # 1 pt
        cls.demo = Task.objects.get(name="Demo & Presentation Session")    # 10 pts
        cls.sheet = Sheet.objects.create(name="Mina", owner=cls.member, role=cls.role, target_hours=40, target_points=100, target_leads=4, target_opps=2,
                                         target_clients=1, target_revenue=100000, start_date=date(2026, 1, 1))

    def setUp(self):
        p = mock.patch.object(team_services, "now", return_value=NOW)
        p.start()
        self.addCleanup(p.stop)

    def api(self, u=None):
        c = APIClient()
        c.force_authenticate(u or self.member)
        return c

    def perf(self):
        r = self.api().get("/api/team/performance/?year=2026").data
        return next(x for x in r["rows"] if x["id"] == self.sheet.pk), r

    def rows(self, **f):
        return ScoreLedger.objects.filter(sheet=self.sheet, **f).order_by("day", "slot")

    def seed(self):
        SheetEntry.objects.create(sheet=self.sheet, day=OCT15, slots=[self.calls.pk, self.calls.pk, self.demo.pk])   # 12 points in October
        SheetEntry.objects.create(sheet=self.sheet, day=NOV3, slots=[self.calls.pk, self.calls.pk])                  # 2 points in November

    def test_rows_follow_the_hours(self):
        self.assertEqual(ScoringVersion.objects.count(), 1)                 # setting up amends the first version: no history to protect yet
        e = SheetEntry.objects.create(sheet=self.sheet, day=OCT15, slots=[self.calls.pk, None, self.demo.pk])
        got = [(r.slot, r.activity_name, r.points, r.source, r.member_id) for r in self.rows()]
        self.assertEqual(got, [(0, "Make 8 Cold Calls", 1, "legacy", self.member.pk), (2, "Demo & Presentation Session", 10, "legacy", self.member.pk)])
        self.assertEqual(self.rows().first().category, self.calls.type)
        e.meta = [{"status": "not_done"}, {}, {"review": "pending", "planned": self.calls.pk}]
        e.save()
        self.assertEqual(self.rows().count(), 0)                            # marked not done; a deviation waiting for approval counts zero
        e.meta = [{"status": "partly", "planned": self.calls.pk}, {}, {"review": "approved", "planned": self.calls.pk}]
        e.save()
        self.assertEqual([r.source for r in self.rows()], ["plan", "deviation"])   # approved: counts, retroactively
        n = planning.decide(self.sup, [{"work": self.sheet.pk, "day": OCT15, "slot": 0, "kind": "log"}], "flag", "Looks copied")
        self.assertEqual((n, self.rows().count()), (1, 1))                  # D1: flagged entries lose their points
        e.delete()
        self.assertEqual(self.rows().count(), 0)
        r = self.api().put(f"/api/team/sheets/{self.sheet.pk}/entries/{TODAY}/", {"slots": [self.calls.pk], "remarks": ""}, format="json")   # FR-S2: straight away
        self.assertEqual((r.status_code, r.data["hours"], r.data["points"], self.rows().get().source), (200, 1.0, 1.0, "unplanned"))
        plan = Sheet.objects.create(name="Plan", kind=Sheet.Kind.PLAN, owner=self.member)
        SheetEntry.objects.create(sheet=plan, day=TODAY, slots=[self.demo.pk])
        self.assertFalse(ScoreLedger.objects.filter(sheet=plan).exists())    # a plan isn't scored

    def test_numbers_match_working_them_out_from_the_hours(self):
        self.seed()
        SheetEntry.objects.create(sheet=self.sheet, day=date(2026, 3, 9), slots=[self.demo.pk], meta=[{"review": "flagged"}])
        SheetEntry.objects.create(sheet=self.sheet, day=date(2026, 3, 10), slots=[self.calls.pk] * 8)
        st = TeamSettings.load()
        cfg = team_services.cfg_of(st)
        pts = {t.id: float(t.points) for t in Task.objects.all()}
        days = [calc.Day(e.day, e.counted_slots()) for e in self.sheet.entries.all()]
        kpis = team_services.kpi_rows(self.sheet)
        _, dash = team_services.dashboard_rows(TODAY)
        _, perf = team_services.performance_rows(2026, TODAY)
        by_hand = calc.dashboard(self.sheet.targets, days, kpis, cfg, pts, TODAY)
        by_ledger = next(r for r in dash if r["id"] == self.sheet.pk)
        for k in ("week_hours", "last_week_hours", "avg_week_hours", "month_points", "last_month_points", "avg_month_points", "ytd_hours", "ytd_points", "today_hours"):
            self.assertEqual(by_ledger[k], by_hand[k], k)
        hand = calc.performance(self.sheet.targets, days, kpis, cfg, pts, self.role.weights, 2026, TODAY)
        got = next(r for r in perf if r["id"] == self.sheet.pk)
        self.assertEqual([m.get("score") for m in got["months"]], [m.get("score") for m in hand["months"]])
        self.assertEqual(got["year"], hand["year"])

    def test_acceptance_4_a_points_change_leaves_last_month_alone(self):
        self.seed()
        before, _ = self.perf()
        oct_, nov = before["months"][9], before["months"][10]
        self.assertEqual((oct_["points"], nov["points"], oct_["version"]), (12, 2, 1))
        r = self.api(self.admin).patch(f"/api/team/tasks/{self.calls.pk}/", {"points": "5"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        v = ScoringVersion.objects.order_by("-number").first()
        self.assertEqual((v.number, v.effective_from, v.kind, v.created_by, v.changes), (2, date(2026, 11, 1), "config", self.admin, ["Make 8 Cold Calls: 1 → 5 points"]))
        self.assertTrue(AuditLog.objects.filter(action="scoring.version", actor=self.admin).exists())   # FR-C9
        after, _ = self.perf()
        self.assertEqual(after["months"][9]["points"], 12)                  # last month: as it was
        self.assertEqual(after["months"][9]["score"], oct_["score"])
        self.assertEqual(after["months"][10]["points"], 10)                 # this month: the new value, as FR-S4 says
        self.assertEqual((after["months"][9]["version"], after["months"][10]["version"]), (1, 2))
        self.assertEqual({r.version.number for r in self.rows(day=OCT15)}, {1})
        # a correction to last month keeps last month's value
        e = SheetEntry.objects.get(sheet=self.sheet, day=OCT15)
        e.slots = e.slots + [self.calls.pk]
        e.save()
        self.assertEqual(self.rows(day=OCT15, slot=3).get().points, 1)
        self.assertEqual(self.perf()[0]["months"][9]["points"], 13)
        # §7: history moves only through an explicit, audit-logged recalculation. The preview changes nothing.
        pv = self.api(self.admin).post("/api/scoring/recalculate/preview/", {"from": "2026-10"}, format="json")
        self.assertEqual(pv.status_code, 200, pv.data)
        row = next(x for x in pv.data["rows"] if x["month"] == "2026-10")
        self.assertEqual((row["person"], row["points_before"], row["points_after"]), ("Mina", 13, 25))
        self.assertEqual(self.perf()[0]["months"][9]["points"], 13)
        self.assertEqual(ScoringVersion.objects.count(), 2)
        self.assertEqual(self.api(self.sup).post("/api/scoring/recalculate/", {"from": "2026-10", "reason": "Fix"}, format="json").status_code, 403)
        self.assertEqual(self.api(self.admin).post("/api/scoring/recalculate/", {"from": "2026-10", "reason": ""}, format="json").status_code, 400)
        self.assertEqual(self.api(self.admin).post("/api/scoring/recalculate/preview/", {"from": "2027-01"}, format="json").status_code, 400)
        r = self.api(self.admin).post("/api/scoring/recalculate/", {"from": "2026-10", "reason": "Points were wrong all along"}, format="json")
        self.assertEqual((r.status_code, r.data["version"], r.data["from"]), (200, 3, date(2026, 10, 1)), r.data)
        self.assertEqual(self.perf()[0]["months"][9]["points"], 25)
        log = AuditLog.objects.filter(action="scoring.recalculate").first()
        self.assertEqual((log.flagged, log.actor, log.detail["reason"]), (True, self.admin, "Points were wrong all along"))
        self.assertEqual(self.perf()[0]["months"][8]["version"], 1)         # September was never touched
        vs = self.api(self.boss).get("/api/scoring/versions/").data["versions"]
        self.assertEqual([(x["number"], x["kind"]) for x in vs], [(3, "recalc"), (2, "config"), (1, "base")])

    def test_weights_and_targets_are_pinned_too(self):
        self.seed()
        before, _ = self.perf()
        role_body = {f"w_{m}": v for m, v in {"hours": 50, "points": 50, "leads": 0, "opps": 0, "clients": 0, "revenue": 0}.items()}
        self.assertEqual(self.api(self.admin).patch(f"/api/team/roles/{self.role.pk}/", role_body, format="json").status_code, 200)
        self.assertEqual(self.api(self.admin).patch(f"/api/team/sheets/{self.sheet.pk}/", {"target_points": "10"}, format="json").status_code, 200)
        after, _ = self.perf()
        self.assertEqual(after["months"][9]["score"], before["months"][9]["score"])       # October: its own weights and targets
        self.assertEqual(after["months"][9]["weights"]["hours"], before["months"][9]["weights"]["hours"])
        self.assertEqual(after["months"][10]["weights"]["hours"], 50)
        self.assertEqual(after["months"][10]["target"]["points"], 10)
        changes = [c for v in ScoringVersion.objects.all() for c in v.changes]
        self.assertTrue(any("International Sales (AI) weights" in c for c in changes), changes)
        self.assertTrue(any(c == "Mina: monthly points target 100 → 10" for c in changes), changes)
        _, dash = team_services.dashboard_rows(date(2026, 10, 31), finished_month=True)
        self.assertEqual(next(r for r in dash if r["id"] == self.sheet.pk)["month_target"], 100)   # a finished month shows its own target

    def test_weekend_rule_is_pinned(self):
        fri_oct, fri_nov = date(2026, 10, 16), date(2026, 11, 6)
        SheetEntry.objects.create(sheet=self.sheet, day=fri_oct, slots=[self.calls.pk])
        SheetEntry.objects.create(sheet=self.sheet, day=fri_nov, slots=[self.calls.pk])
        self.assertEqual(self.api(self.admin).patch("/api/team/settings/", {"count_weekend": False}, format="json").status_code, 200)
        self.assertEqual([r.day for r in self.rows()], [fri_oct])            # the old rule still holds for last month
        self.assertEqual(self.perf()[0]["months"][9]["points"], 1)

    def test_events_count_once_verified(self):
        nda = Task.objects.create(name="Signed NDA", type="Sales", points=20, scoring_mode=Task.ScoringMode.EVENT)
        self.role.tasks.add(nda)
        c = self.api()
        body = {"sheet": self.sheet.pk, "day": str(TODAY), "activity": nda.pk, "quantity": 2, "evidence": "NDA-2026-14"}
        self.assertEqual(c.post("/api/scoring/events/", {**body, "evidence": ""}, format="json").status_code, 400)
        self.assertEqual(c.post("/api/scoring/events/", {**body, "activity": self.calls.pk}, format="json").status_code, 400)
        self.assertEqual(c.post("/api/scoring/events/", {**body, "day": "2026-11-09"}, format="json").status_code, 403)
        r = c.post("/api/scoring/events/", body, format="json")
        self.assertEqual((r.status_code, r.data["status"], r.data["points"]), (201, "pending", 40), r.data)
        ev = r.data["id"]
        self.assertEqual(self.rows().count(), 0)                             # D2: nothing until it's verified
        got = c.get(f"/api/team/sheets/{self.sheet.pk}/entries/?from={TODAY}&to={TODAY}").data
        self.assertEqual(([x["id"] for x in got["events"]], [x["name"] for x in got["event_choices"]]), ([ev], ["Signed NDA"]))
        self.assertNotIn(nda.pk, got["choices"])                             # an event isn't an hour slot
        bad = c.put(f"/api/team/sheets/{self.sheet.pk}/entries/{TODAY}/", {"slots": [nda.pk], "remarks": ""}, format="json")
        self.assertEqual(bad.status_code, 403)
        self.assertIn("is an event", bad.data["detail"])
        self.assertEqual(c.post(f"/api/scoring/events/{ev}/decide/", {"verified": True}, format="json").status_code, 403)
        self.assertEqual(self.api(self.sup).post(f"/api/scoring/events/{ev}/decide/", {"verified": False}, format="json").status_code, 400)   # needs a reason
        self.assertEqual([x["id"] for x in self.api(self.sup).get("/api/scoring/events/?scope=team&status=pending").data], [ev])
        self.assertEqual(c.get("/api/scoring/events/?scope=team").status_code, 403)
        self.assertEqual(self.api(self.sup).post(f"/api/scoring/events/{ev}/decide/", {"verified": True}, format="json").status_code, 200)
        row = self.rows().get()
        self.assertEqual((row.slot, row.hours, row.points, row.quantity, row.source), (None, 0, 40, 2, "event"))
        now, _ = self.perf()
        self.assertEqual((now["months"][10]["points"], now["months"][10]["hours"]), (40, 0))   # §7: quantity × points, no hours
        self.assertEqual(c.delete(f"/api/scoring/events/{ev}/").status_code, 400)            # only while it's waiting
        self.assertEqual(self.api(self.sup).post(f"/api/scoring/events/{ev}/decide/", {"verified": False, "note": "Wrong NDA"}, format="json").status_code, 200)
        self.assertEqual(self.rows().count(), 0)
        again = c.post("/api/scoring/events/", body, format="json").data["id"]
        self.assertEqual(c.delete(f"/api/scoring/events/{again}/").status_code, 204)
        self.assertEqual(self.api(self.admin).delete(f"/api/team/tasks/{nda.pk}/").status_code, 400)   # it's on record

    def test_a_verified_win_is_the_work_order_event(self):
        order = Task.objects.get(name="Client Work Order Receiving")
        self.assertEqual((order.scoring_mode, float(order.points)), ("event", 100))          # §12.1
        self.assertEqual(self.api().post("/api/scoring/events/", {"sheet": self.sheet.pk, "day": str(TODAY), "activity": order.pk, "evidence": "WO-1"}, format="json").status_code, 400)
        p = self.api().post("/api/tracker/prospects/", {"company": "Walton", "stage": "negotiation", "value": "500000", **NEXT}, format="json").data
        self.api().patch(f"/api/tracker/prospects/{p['id']}/", {"stage": "won", "win_loss_why": "Best fit"}, format="json")
        self.assertEqual(self.rows().count(), 0)                             # won, not verified yet
        self.assertEqual(self.api(self.sup).post(f"/api/tracker/reviews/wins/{p['id']}/", {"verified": True}, format="json").status_code, 200)
        row = self.rows().get()
        self.assertEqual((row.points, row.activity_name, row.source), (100, "Client Work Order Receiving", "event"))
        ev = EventLog.objects.get(record_id=p["id"])
        self.assertEqual(self.api(self.sup).post(f"/api/scoring/events/{ev.pk}/decide/", {"verified": False, "note": "x"}, format="json").status_code, 400)   # the pipeline decides
        wins = team_services.wins_between(TODAY, TODAY)
        self.assertEqual([(w["what"], w["details"]) for w in wins], [("Client Work Order Receiving", "Walton")])
        self.assertEqual(self.api(self.sup).post(f"/api/tracker/reviews/wins/{p['id']}/", {"verified": True}, format="json").status_code, 200)
        self.assertEqual(self.rows().count(), 1)                             # verifying twice doesn't count twice
        r = self.api().patch(f"/api/tracker/prospects/{p['id']}/", {"stage": "negotiation", "next_action": "Again", "next_follow_up": "2026-11-08"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(self.rows().count(), 0)                             # it left Won: the points go with it
        self.api().patch(f"/api/tracker/prospects/{p['id']}/", {"stage": "won"}, format="json")
        self.api(self.sup).post(f"/api/tracker/reviews/wins/{p['id']}/", {"verified": True}, format="json")
        self.assertEqual(self.rows().count(), 1)
        self.assertEqual(self.api().delete(f"/api/tracker/prospects/{p['id']}/").status_code, 204)
        self.assertEqual(self.rows().count(), 0)
        self.assertFalse(Prospect.objects.filter(pk=p["id"]).exists())

    def test_acceptance_6_every_number_opens_its_entries(self):
        self.seed()
        _, dash = team_services.dashboard_rows(TODAY)
        row = next(r for r in dash if r["id"] == self.sheet.pk)
        c = self.api(self.boss)
        got = c.get(f"/api/scoring/ledger/?sheet={self.sheet.pk}&from=2026-11-01&to=2026-11-30").data
        self.assertEqual(got["totals"], {"hours": 2, "points": row["month_points"], "entries": 2})
        first = got["rows"][0]
        self.assertEqual((first["day"], first["activity"], first["points"], first["source"], first["version"], first["person"]), (NOV3, "Make 8 Cold Calls", 1, "legacy", 1, "Mina"))
        week = c.get(f"/api/scoring/ledger/?sheet={self.sheet.pk}&from={row['week_start']}&to={row['week_end']}").data
        self.assertEqual(week["totals"]["hours"], row["week_hours"])
        october = c.get("/api/scoring/ledger/?from=2026-10-01&to=2026-10-31").data                      # the whole team
        self.assertEqual(october["totals"]["points"], 12)
        self.assertEqual(october["by_activity"][0], {"name": "Demo & Presentation Session", "hours": 1, "points": 10, "entries": 1})   # FR-S6
        self.assertEqual({x["name"] for x in october["by_category"]}, {self.calls.type, self.demo.type})
        self.assertEqual(c.get("/api/scoring/ledger/?from=2026-10-31&to=2026-10-01").status_code, 400)
        self.assertEqual(c.get(f"/api/scoring/ledger/?sheet={self.sheet.pk}&from=x&to=2026-10-01").status_code, 400)
        self.assertEqual(c.get("/api/scoring/ledger/?from=2026-10-01&to=2026-10-31&metric=nope").status_code, 400)
        # a KPI number opens the records behind it, and a typed week says it was typed
        p = self.api().post("/api/tracker/prospects/", {"company": "Walton", "stage": "qualified", **NEXT}, format="json").data
        kpi = c.get(f"/api/scoring/ledger/?sheet={self.sheet.pk}&from=2026-11-01&to=2026-11-30&metric=leads").data
        self.assertEqual((kpi["totals"], kpi["rows"][0]["what"], kpi["rows"][0]["kind"], kpi["rows"][0]["record"]),
                         ({"value": 1, "entries": 1}, "Walton", "record", p["id"]))
        from team.models import KpiEntry
        KpiEntry.objects.create(sheet=self.sheet, week_start=date(2026, 10, 10), leads=3)
        typed = c.get(f"/api/scoring/ledger/?sheet={self.sheet.pk}&from=2026-10-01&to=2026-10-31&metric=leads").data
        self.assertEqual((typed["totals"]["value"], typed["rows"][0]["kind"]), (3, "typed"))

    def test_team_row_and_restore(self):
        self.seed()
        other = Sheet.objects.create(name="Sup", owner=self.sup, role=self.role, target_hours=40, target_points=100, start_date=date(2026, 1, 1))
        SheetEntry.objects.create(sheet=other, day=OCT15, slots=[self.demo.pk])
        mine, r = self.perf()
        self.assertEqual(r["team"]["months"][9]["points"], 22)               # FR-S4: the team's total
        scores = [x["months"][9]["score"] for x in r["rows"]]
        self.assertAlmostEqual(r["team"]["months"][9]["score"], sum(scores) / len(scores))
        self.assertEqual(r["team"]["year"]["points"], 24)
        nda = Task.objects.create(name="Signed NDA", type="Sales", points=20, scoring_mode=Task.ScoringMode.EVENT)
        self.role.tasks.add(nda)
        ev = services.log_event(self.member, self.sheet, TODAY, nda, 1, "NDA-1")
        services.decide_event(self.sup, ev, True)
        name = snapshots.take("test", self.admin)
        snapshots.restore(name, self.admin)
        after = Sheet.objects.get(name="Mina")
        self.assertEqual(ScoreLedger.objects.filter(sheet=after, day=OCT15).count(), 3)
        self.assertEqual(ScoreLedger.objects.get(sheet=after, slot__isnull=True).points, 20)  # the event came back, verified
        self.assertEqual(ScoringVersion.objects.order_by("-number").first().kind, "restore")
