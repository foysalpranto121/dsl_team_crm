"""SRS v0.5 §5.5 and §5.9: the lightweight pipeline, weekly KPIs worked out from stage events, the Client Log, and reviews."""
from datetime import date, datetime
from datetime import timezone as tz
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from core.models import AuditLog
from team import services as team_services
from team.models import JobRole, KpiEntry, Sheet, TeamSettings

from .models import ClientLogEntry, PipelineStage, Prospect, StageEvent

NOW = datetime(2026, 11, 5, 6, 0, tzinfo=tz.utc)   # Thu 5 Nov 2026 in Dhaka; the week runs Sat 31 Oct – Fri 6 Nov
WEEK = date(2026, 10, 31)
NEXT = {"requirement": "ERP for 40 users", "next_action": "Send the brochure", "next_follow_up": "2026-11-08"}


class PipelineKpiTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        mk = lambda e, role: User.objects.create_user(e, name=e.split("@")[0].title(), status="approved", role=role)  # noqa: E731
        cls.member, cls.sup, cls.admin, cls.boss = mk("mina@x.com", "member"), mk("sup@x.com", "supervisor"), mk("admin@x.com", "admin"), mk("boss@x.com", "viewer")
        st = TeamSettings.load()
        st.weekend_days, st.kpi_mode, st.kpi_from = [5], "derived", None
        st.save()
        cls.sheet = Sheet.objects.create(name="Mina", owner=cls.member, role=JobRole.objects.get(name="International Sales (AI)"))

    def setUp(self):
        p = mock.patch.object(team_services, "now", return_value=NOW)
        p.start()
        self.addCleanup(p.stop)

    def api(self, u=None):
        c = APIClient()
        c.force_authenticate(u or self.member)
        return c

    def add(self, company="Walton", **body):
        r = self.api().post("/api/tracker/prospects/", {"company": company, **NEXT, **body}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        return r.data

    def move(self, pid, stage, **body):
        return self.api().patch(f"/api/tracker/prospects/{pid}/", {"stage": stage, **body}, format="json")

    def week(self, u=None):
        r = self.api(u).get(f"/api/team/kpi-week/?week={WEEK}").data
        return r, next(x for x in r["rows"] if x["sheet"] == self.sheet.pk)

    def test_record_rules(self):
        c = self.api()
        bad = c.post("/api/tracker/prospects/", {"company": "Square", "stage": "Qualified Lead"}, format="json")
        self.assertEqual(set(bad.data), {"requirement", "next_action", "next_follow_up"})   # FR-K1, FR-CL3
        p = self.add("Square", stage="Qualified Lead")                                      # stages by name too
        self.assertEqual((p["stage"], p["probability"], p["health"]["state"]), ("qualified", 10, "warning"))   # no contact logged yet
        self.assertEqual(set(self.move(p["id"], "proposal").data), {"value"})               # FR-K1: value from Proposal on
        self.assertEqual(set(self.move(p["id"], "lost").data), {"win_loss_why", "lost_reason"})
        self.assertEqual(self.move(p["id"], "lost", lost_reason="Bad reason", win_loss_why="x").data["lost_reason"][0][:10], "Choose one")
        r = self.move(p["id"], "lost", lost_reason="Chose a competitor", win_loss_why="Cheaper offer", win_loss_competitor="Odoo partner")
        self.assertEqual((r.status_code, r.data["stage_kind"], r.data["health"]), (200, "lost", None))
        self.assertEqual(self.api().patch(f"/api/tracker/prospects/{p['id']}/", {"deal_value": "900"}, format="json").data, {"deal_currency": ["Which currency is the deal priced in?"]})
        self.assertEqual(c.post("/api/tracker/prospects/", {"company": "X", "stage": "nowhere", **NEXT}, format="json").status_code, 400)

    def test_kpis_from_stage_events(self):
        a = self.add("Walton")                                      # at Lead: no KPI yet
        self.assertEqual(KpiEntry.objects.filter(sheet=self.sheet).count(), 0)
        self.move(a["id"], "requirements")                          # SRS §11 test 7: reaching Requirements Shared is an opportunity
        k = KpiEntry.objects.get(sheet=self.sheet, week_start=WEEK)
        self.assertEqual((k.leads, k.opps, k.clients, k.source), (1, 1, 0, "derived"))   # skipping Qualified still counts the lead
        r, row = self.week()
        self.assertEqual((r["derived"], row["editable"], row["kpi"]["opps"]), (True, False, 1))   # the weekly view matches; nothing to type
        self.assertEqual(self.api().put(f"/api/team/sheets/{self.sheet.pk}/kpis/{WEEK}/", {"leads": 9}, format="json").status_code, 403)
        # Backwards is flagged for review; moving forward again doesn't count twice.
        self.move(a["id"], "qualified")
        ev = StageEvent.objects.get(record_id=a["id"], backward=True)
        self.assertEqual(ev.review, "flagged")
        self.move(a["id"], "demo")
        k.refresh_from_db()
        self.assertEqual((k.leads, k.opps), (1, 1))
        moves = self.api(self.sup).get("/api/tracker/reviews/").data["moves"]
        self.assertEqual([(m["company"], m["from"], m["to"]) for m in moves], [("Walton", "Requirements Shared", "Qualified Lead")])
        self.assertEqual(self.api().get("/api/tracker/reviews/").status_code, 403)
        self.assertEqual(self.api(self.sup).post(f"/api/tracker/reviews/moves/{ev.pk}/", {"note": "Client paused"}, format="json").status_code, 200)
        self.assertEqual(self.api(self.sup).get("/api/tracker/reviews/").data["moves"], [])
        # A win counts as a client and as revenue only once the work order is verified.
        self.move(a["id"], "won", value="250000", win_loss_why="Best demo")
        k.refresh_from_db()
        self.assertEqual((k.clients, float(k.revenue)), (0, 0.0))
        ev = self.api().get(f"/api/team/sheets/{self.sheet.pk}/kpis/{WEEK}/evidence/").data
        self.assertEqual(([x["company"] for x in ev["counted"]["opps"]], [x["company"] for x in ev["waiting"]]), (["Walton"], ["Walton"]))
        self.assertEqual(self.api(self.sup).post(f"/api/tracker/reviews/wins/{a['id']}/", {"verified": False}, format="json").status_code, 400)  # needs a why
        self.assertEqual(self.api(self.sup).post(f"/api/tracker/reviews/wins/{a['id']}/", {"verified": True}, format="json").status_code, 200)
        k.refresh_from_db()
        self.assertEqual((k.clients, float(k.revenue)), (1, 250000.0))
        # Imported records count as reached, not as this week's KPIs.
        csv = "Customer,Opportunity,Stage,Expected Revenue\nBeta Bank,Core banking,Requirements Shared,90000\nGamma,Website,Who knows,\n"
        r = self.api().post("/api/tracker/prospects/import/", {"file": SimpleUploadedFile("odoo.csv", csv.encode())}, format="multipart").data
        self.assertEqual((r["added"], r["unknown_stages"]), (2, ["Who knows"]))
        beta = Prospect.objects.get(company="Beta Bank")
        self.assertEqual((beta.stage, beta.requirement, float(beta.value)), ("requirements", "Core banking", 90000.0))
        self.move(beta.pk, "proposal")
        k.refresh_from_db()
        self.assertEqual((k.leads, k.opps), (1, 1))

    def test_confirm_adjust_and_cut_over(self):
        a = self.add("Walton", stage="qualified")
        url = f"/api/team/sheets/{self.sheet.pk}/kpis/{WEEK}"
        r = self.api().post(f"{url}/confirm/")
        self.assertEqual((r.status_code, r.data["confirmed"]["leads"], r.data["stale"]), (200, 1, False))   # FR-K3: one tap
        self.assertEqual(self.api(self.sup).post(f"{url}/confirm/").status_code, 403)                       # only your own week
        self.assertEqual(self.api().post(f"{url}/adjust/", {"leads": 3, "note": "x"}, format="json").status_code, 403)   # members don't adjust
        self.assertEqual(self.api(self.sup).post(f"{url}/adjust/", {"leads": 3, "note": ""}, format="json").status_code, 400)
        r = self.api(self.sup).post(f"{url}/adjust/", {"leads": 3, "note": "Two leads logged late"}, format="json")
        self.assertEqual((r.data["leads"], r.data["derived"]["leads"], r.data["adjust"], r.data["stale"]), (3, 1, {"leads": 2}, True))
        self.assertTrue(AuditLog.objects.filter(action="kpi.adjust", flagged=True).exists())
        self.move(a["id"], "requirements")                          # later pipeline changes still show, on top of the adjustment
        k = KpiEntry.objects.get(sheet=self.sheet, week_start=WEEK)
        self.assertEqual((k.leads, k.opps), (3, 1))
        # Management reads the records behind the numbers; another member doesn't.
        self.assertEqual(self.api(self.boss).get(f"{url}/evidence/").status_code, 200)
        other = User.objects.create_user("omar@x.com", status="approved", role="member")
        self.assertEqual(self.api(other).get(f"{url}/evidence/").status_code, 403)
        # FR-K5: weeks before the cut-over stay typed; manual mode types every week.
        st = TeamSettings.load()
        self.assertEqual(self.api(self.admin).patch("/api/team/settings/", {"kpi_from": "2026-11-02"}, format="json").status_code, 400)   # not a week start
        self.api(self.admin).patch("/api/team/settings/", {"kpi_from": "2026-11-07"}, format="json")
        r, row = self.week(self.admin)
        self.assertEqual((r["derived"], row["editable"]), (False, True))
        self.api(self.admin).patch("/api/team/settings/", {"kpi_mode": "manual", "kpi_from": None}, format="json")
        st.refresh_from_db()
        r, row = self.week()
        self.assertEqual((st.kpi_mode, r["derived"], row["editable"]), ("manual", False, True))

    def test_client_log_and_stage_settings(self):
        a = self.add("Walton")
        r = self.api().post(f"/api/tracker/prospects/{a['id']}/log/", {"type": "call", "outcome": "Asked for a quote", "next_date": "2026-11-09"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        p = Prospect.objects.get(pk=a["id"])
        self.assertEqual((str(p.last_contacted), str(p.next_follow_up), p.next_action), ("2026-11-05", "2026-11-09", "Asked for a quote"))
        self.assertEqual(self.api().post(f"/api/tracker/prospects/{a['id']}/log/", {"type": "stage"}, format="json").status_code, 400)
        self.assertEqual(self.api().post(f"/api/tracker/prospects/{a['id']}/log/", {"type": "visit", "day": "2026-11-06"}, format="json").status_code, 400)  # the future
        log = self.api().get(f"/api/tracker/prospects/{a['id']}/log/").data
        self.assertEqual([x["type"] for x in log], ["call", "stage"])
        self.assertEqual(ClientLogEntry.objects.filter(record_id=a["id"], type="stage").first().note, "Added at Lead")
        # FR-K9: admins shape the process; a stage in use is switched off, not deleted.
        self.assertEqual(self.api().post("/api/tracker/stages/", {"name": "Site survey"}, format="json").status_code, 403)
        new = self.api(self.admin).post("/api/tracker/stages/", {"name": "Site survey", "expected_days": 5}, format="json").data
        self.assertEqual((new["key"], new["position"]), ("site-survey", 9))
        lead = PipelineStage.objects.get(key="lead")
        self.assertEqual(self.api(self.admin).delete(f"/api/tracker/stages/{lead.pk}/").status_code, 400)
        self.assertEqual(self.api(self.admin).delete(f"/api/tracker/stages/{new['id']}/").status_code, 204)
        won = PipelineStage.objects.get(key="won")
        self.assertEqual(self.api(self.admin).patch(f"/api/tracker/stages/{won.pk}/", {"active": False}, format="json").status_code, 400)   # one Won stage needed
        keys = list(PipelineStage.objects.values_list("key", flat=True))
        r = self.api(self.admin).post("/api/tracker/stages/order/", {"keys": keys[1:] + keys[:1]}, format="json")
        self.assertEqual(r.data[-1]["key"], "lead")
        cfg = self.api().get("/api/tracker/config/").data
        self.assertEqual(([k["key"] for k in cfg["kpi_types"]], cfg["kpi_types"][1]["stage"], cfg["currency"]), (["leads", "opps", "clients", "revenue"], "requirements", "BDT"))
        opps = next(k for k in cfg["kpi_types"] if k["key"] == "opps")
        self.assertEqual(self.api(self.admin).patch(f"/api/tracker/kpi-types/{opps['id']}/", {"stage": "lost"}, format="json").status_code, 400)
        self.assertEqual(self.api(self.admin).patch(f"/api/tracker/kpi-types/{opps['id']}/", {"stage": "demo"}, format="json").status_code, 200)
