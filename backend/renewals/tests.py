from datetime import date, datetime, timedelta
from datetime import timezone as tz
from decimal import Decimal
from io import BytesIO
from unittest import mock

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from openpyxl import load_workbook
from rest_framework.test import APIClient

from accounts.models import User
from core.models import AuditLog
from team import services as team_services
from team.exporter import build_workbook
from team.models import JobRole, KpiEntry, Sheet

from .models import Contract, Renewal

NOW = datetime(2026, 10, 29, 4, 0, tzinfo=tz.utc)   # Thu 29 Oct 2026, 10:00 in Dhaka
TODAY = date(2026, 10, 29)
WEEK = date(2026, 10, 24)                            # the Saturday that starts this week


def ends_in(n):
    return TODAY + timedelta(days=n)


class RenewalTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        mk = lambda e, role, name: User.objects.create_user(e, name=name, status="approved", role=role)  # noqa: E731
        cls.admin = mk("a@x.com", "admin", "Admin")
        cls.member = mk("m@x.com", "member", "Mina Rahman")
        cls.other = mk("o@x.com", "member", "Other Person")
        cls.viewer = mk("v@x.com", "viewer", "Management")
        role = JobRole.objects.get(name="International Sales (AI)")
        cls.sheet = Sheet.objects.create(name="Mina", owner=cls.member, role=role, target_revenue=1_000_000, start_date=date(2026, 10, 1))

    def setUp(self):
        p = mock.patch.object(team_services, "now", return_value=NOW)
        self.now = p.start()
        self.addCleanup(p.stop)
        cache.clear()

    def api(self, u):
        c = APIClient()
        c.force_authenticate(u)
        return c

    def contract(self, days, owner=None, client="Acme Ltd", product="ERP AMC", value=100000, **kw):
        return Contract.objects.create(client=client, product=product, start_date=ends_in(days) - timedelta(days=364), end_date=ends_in(days),
                                       value=Decimal(value), owner=owner if owner is not None else self.member, **kw)

    def opportunities(self, user, show="open"):
        return {r["contract"]["client"]: r for r in self.api(user).get(f"/api/renewals/opportunities/?show={show}").data}

    # ----- FR-RN1: contracts and who sees them -----
    def test_admins_and_management_see_every_contract_members_their_own(self):
        self.contract(200, client="Mine")
        self.contract(200, owner=self.other, client="Theirs")
        names = lambda u: sorted(c["client"] for c in self.api(u).get("/api/renewals/contracts/").data)  # noqa: E731
        self.assertEqual((names(self.admin), names(self.viewer), names(self.member)), (["Mine", "Theirs"], ["Mine", "Theirs"], ["Mine"]))
        body = {"client": " New  Client ", "product": "HRM licence", "kind": "licence", "start_date": "2026-01-01", "end_date": "2026-12-31", "value": "50000"}
        self.assertEqual(self.api(self.member).post("/api/renewals/contracts/", body, format="json").status_code, 403)
        self.assertEqual(self.api(self.viewer).post("/api/renewals/contracts/", body, format="json").status_code, 403)
        r = self.api(self.admin).post("/api/renewals/contracts/", {**body, "owner": self.member.pk}, format="json")
        self.assertEqual((r.status_code, r.data["client"], r.data["state"], r.data["days_left"]), (201, "New Client", "due", 63))
        self.assertEqual(r.data["renewal"]["stage"], "open")          # inside the 90-day window: its renewal opened at once
        two = self.api(self.admin).post("/api/renewals/contracts/", {**body, "client": "Second"}, format="json")
        self.assertEqual(two.status_code, 201)                        # many contracts may have no external ID
        self.api(self.admin).patch(f"/api/renewals/contracts/{two.data['id']}/", {"external_id": "SUB-1"}, format="json")
        dup = self.api(self.admin).post("/api/renewals/contracts/", {**body, "client": "Third", "external_id": "SUB-1"}, format="json")
        self.assertEqual((dup.status_code, str(dup.data["external_id"][0])), (400, "Another contract already has this ID."))
        bad = self.api(self.admin).post("/api/renewals/contracts/", {**body, "end_date": "2025-12-31"}, format="json")
        self.assertEqual(bad.status_code, 400)
        self.assertTrue(AuditLog.objects.filter(action="contract.create", target="New Client · HRM licence").exists())

    # ----- FR-RN2: renewals open at 90 days and remind at 60 and 30 -----
    def test_renewals_open_inside_the_first_window_for_the_account_owner(self):
        self.contract(120, client="Far")
        self.contract(80, client="Ninety")
        self.contract(45, client="Sixty")
        self.contract(10, client="Thirty")
        self.contract(-5, client="Ended")
        self.contract(20, owner=self.other, client="Not mine")
        seen = self.opportunities(self.admin)
        self.assertNotIn("Far", seen)
        self.assertEqual({k: v["window"] for k, v in seen.items()}, {"Ninety": 90, "Sixty": 60, "Thirty": 30, "Ended": 30, "Not mine": 30})
        mine = self.opportunities(self.member)
        self.assertEqual(sorted(mine), ["Ended", "Ninety", "Sixty", "Thirty"])
        self.assertEqual((mine["Ninety"]["next_action"], mine["Ninety"]["next_action_on"], mine["Ninety"]["due"], mine["Ninety"]["can_edit"]),
                         ("Contact Ninety about renewing ERP AMC", "2026-10-29", "today", True))
        due = self.api(self.member).get("/api/renewals/due/").data
        self.assertEqual((due["count"], due["unowned"]), (4, None))
        self.assertFalse(self.opportunities(self.viewer)["Ninety"]["can_edit"])

    def test_each_later_window_puts_the_renewal_back_on_the_to_do_list(self):
        c = self.contract(80)
        r = self.api(self.member)
        rid = self.opportunities(self.member)["Acme Ltd"]["id"]
        r.patch(f"/api/renewals/opportunities/{rid}/", {"stage": "talking", "next_action": "Send the quote", "next_action_on": "2026-12-20"}, format="json")
        self.assertEqual(r.get("/api/renewals/due/").data["count"], 0)
        self.now.return_value = NOW + timedelta(days=33)               # 47 days left: inside the 60-day window
        cache.clear()
        self.assertEqual(r.get("/api/renewals/due/").data["count"], 1)
        got = Renewal.objects.get(contract=c)
        self.assertEqual((got.window, got.next_action_on, got.stage, got.next_action), (60, TODAY + timedelta(days=33), "talking", "Send the quote"))

    def test_an_open_renewal_needs_a_next_step_and_only_the_owner_or_an_admin_works_it(self):
        self.contract(30)
        rid = self.opportunities(self.member)["Acme Ltd"]["id"]
        url = f"/api/renewals/opportunities/{rid}/"
        self.assertEqual(self.api(self.member).patch(url, {"next_action": " "}, format="json").status_code, 400)
        self.assertEqual(self.api(self.other).patch(url, {"stage": "quoted"}, format="json").status_code, 404)   # not theirs to see
        self.assertEqual(self.api(self.viewer).patch(url, {"stage": "quoted"}, format="json").status_code, 403)
        ok = self.api(self.member).patch(url, {"stage": "quoted", "upsell": "Add the HR module", "value": "120000"}, format="json")
        self.assertEqual((ok.status_code, ok.data["stage_label"], ok.data["upsell"]), (200, "Quote sent", "Add the HR module"))
        self.assertEqual(self.api(self.member).patch(url, {"stage": "won"}, format="json").status_code, 400)  # outcomes have their own actions

    def test_moving_the_end_date_out_of_the_window_drops_an_untouched_renewal(self):
        c = self.contract(40)
        self.api(self.admin).get("/api/renewals/opportunities/")
        self.assertTrue(Renewal.objects.filter(contract=c).exists())
        self.api(self.admin).patch(f"/api/renewals/contracts/{c.pk}/", {"end_date": "2027-06-30"}, format="json")
        self.assertFalse(Renewal.objects.filter(contract=c).exists())

    # ----- the outcome, and FR-RN4: renewal revenue in the Revenue KPI -----
    def test_renewing_starts_the_next_term_and_counts_in_the_owners_revenue(self):
        c = self.contract(20, value=100000)
        rid = self.opportunities(self.member)["Acme Ltd"]["id"]
        url = f"/api/renewals/opportunities/{rid}/renew/"
        body = {"start_date": str(c.end_date + timedelta(days=1)), "end_date": str(c.end_date + timedelta(days=365)), "value": "120000"}
        self.assertEqual(self.api(self.viewer).post(url, body, format="json").status_code, 403)
        early = self.api(self.member).post(url, {**body, "renewed_on": "2026-10-20"}, format="json")
        self.assertEqual((early.status_code, early.data["detail"]), (400, "You can record a renewal for today. Ask an admin to record one for an earlier date."))
        r = self.api(self.member).post(url, body, format="json")
        self.assertEqual((r.status_code, r.data["stage"], r.data["credit_to"]), (200, "won", "Mina Rahman"))
        c.refresh_from_db()
        nxt = Contract.objects.get(pk=r.data["next_term"])
        self.assertEqual((c.status, nxt.previous_id, nxt.value, nxt.owner_id, nxt.status), ("renewed", c.pk, Decimal("120000"), self.member.pk, "open"))
        self.assertEqual(self.api(self.member).post(url, body, format="json").status_code, 400)       # already closed

        def revenue():
            rows = self.api(self.admin).get("/api/team/dashboard/").data["rows"]
            return next(x for x in rows if x["id"] == self.sheet.pk)["kpi_month"]["revenue"]
        self.assertEqual(revenue(), 120000)
        KpiEntry.objects.create(sheet=self.sheet, week_start=WEEK, leads=2, revenue=30000)         # the revenue typed in that week
        self.assertEqual(revenue(), 150000)
        week = {x["sheet"]: x for x in self.api(self.member).get("/api/team/kpi-week/").data["rows"]}[self.sheet.pk]
        self.assertEqual((week["kpi"]["revenue"], week["renewals"]), ("30000.00", 120000))
        self.api(self.admin).patch("/api/renewals/settings/", {"revenue_weight": "50"}, format="json")
        self.assertEqual(revenue(), 90000)                                                           # renewals count at half
        self.assertTrue(AuditLog.objects.filter(action="renewal.settings", flagged=True).exists())
        ws = load_workbook(BytesIO(build_workbook(2026)))["KPI_Weekly_Input"]
        self.assertEqual((ws.cell(4, 8).value, ws.cell(4, 10).value), (30000, 60000))
        # Missing-results reminders still look only at what people entered.
        KpiEntry.objects.all().delete()
        gaps = {g["sheet"]: g["weeks"] for g in team_services.missing_results(date(2026, 11, 7))}
        self.assertIn("2026-10-24", gaps[self.sheet.pk])

    def test_not_renewing_and_reopening(self):
        c = self.contract(15)
        rid = self.opportunities(self.member)["Acme Ltd"]["id"]
        base = f"/api/renewals/opportunities/{rid}/"
        self.assertEqual(self.api(self.member).post(base + "lose/", {"reason": "x"}, format="json").status_code, 400)
        lost = self.api(self.member).post(base + "lose/", {"reason": "Moved to a competitor"}, format="json")
        self.assertEqual((lost.data["stage"], lost.data["lost_reason"]), ("lost", "Moved to a competitor"))
        self.assertEqual(Contract.objects.get(pk=c.pk).status, "lost")
        self.assertEqual(self.api(self.member).post(base + "reopen/").status_code, 403)
        again = self.api(self.admin).post(base + "reopen/")
        self.assertEqual((again.status_code, again.data["stage"], again.data["due"]), (200, "talking", "today"))
        renewed = self.api(self.admin).post(base + "renew/", {"start_date": "2026-11-14", "end_date": "2027-11-13", "value": "90000",
                                                              "renewed_on": "2026-10-27"}, format="json")
        self.assertEqual((renewed.status_code, renewed.data["closed_on"]), (200, "2026-10-27"))     # admins may record an earlier day
        self.assertEqual(Contract.objects.count(), 2)
        self.api(self.admin).post(base + "reopen/")
        self.assertEqual((Contract.objects.count(), Contract.objects.get(pk=c.pk).status), (1, "open"))   # the next term is gone again
        self.assertTrue(AuditLog.objects.filter(action="renewal.reopen", flagged=True).exists())

    # ----- FR-RN1: import from a CSV (the old records or an Odoo export) -----
    def test_contracts_import_from_a_csv_and_a_second_import_updates_them(self):
        csv = ("Customer,Product,Type,Start date,Expiry date,Amount,Salesperson,Reference\n"
               "Beta Bank,Core banking AMC,AMC,01/01/2026,31/12/2026,\"1,20,000\",m@x.com,SUB-7\n"
               "Gamma Group,HRM,Subscription,,2027-03-31,BDT 45000,Nobody Here,\n"
               ",Missing client,,,2026-12-31,10,,\n"
               "Delta,ERP,AMC,2026-01-01,31/02/2026,10,,\n").encode()
        upload = lambda dry: {"file": SimpleUploadedFile("contracts.csv", csv, "text/csv"), "dry_run": dry}  # noqa: E731
        self.assertEqual(self.api(self.member).post("/api/renewals/contracts/import/", upload("1"), format="multipart").status_code, 403)
        dry = self.api(self.admin).post("/api/renewals/contracts/import/", upload("1"), format="multipart").data
        self.assertEqual((dry["created"], dry["updated"], dry["skipped"], Contract.objects.count()), (2, 0, 2, 0))
        rows = {r["line"]: r for r in dry["rows"]}
        self.assertEqual((rows[2]["owner"], rows[2]["value"], rows[3]["owner"]), ("Mina Rahman", 120000.0, None))
        self.assertIn("No start date: taken as one year before the end.", rows[3]["notes"])
        self.assertEqual((rows[4]["errors"], rows[5]["errors"]), (["Client is empty."], ["End date: “31/02/2026” isn't a real date."]))
        done = self.api(self.admin).post("/api/renewals/contracts/import/", upload("0"), format="multipart").data
        self.assertEqual((done["created"], Contract.objects.count()), (2, 2))
        beta = Contract.objects.get(external_id="SUB-7")
        self.assertEqual((beta.client, beta.kind, beta.start_date, beta.end_date, beta.owner_id), ("Beta Bank", "amc", date(2026, 1, 1), date(2026, 12, 31), self.member.pk))
        self.assertEqual(Contract.objects.get(client="Gamma Group").kind, "licence")
        self.assertTrue(Renewal.objects.filter(contract=beta).exists())                   # 63 days left: opened straight away
        again = self.api(self.admin).post("/api/renewals/contracts/import/", upload("0"), format="multipart").data
        self.assertEqual((again["created"], again["updated"], Contract.objects.count()), (0, 2, 2))
        bad = self.api(self.admin).post("/api/renewals/contracts/import/",
                                        {"file": SimpleUploadedFile("x.csv", b"Name,Amount\nA,1\n", "text/csv")}, format="multipart")
        self.assertEqual((bad.status_code, bad.data["detail"]),
                         (400, "The file needs a column for: Client, Product, End date. The first row must hold the column names."))

    # ----- FR-RN3: the renewal dashboard -----
    def test_summary_shows_what_is_due_at_risk_and_the_renewal_rate(self):
        self.contract(80, client="Acme Ltd", product="ERP AMC", value=200000)
        self.contract(10, client="Beta Bank", product="ERP AMC", value=50000)
        self.contract(-3, client="Gamma", product="ERP AMC", value=30000)
        self.contract(300, client="Delta", product="HR module", value=10000)
        self.contract(250, client="Echo", product="HR module", value=10000, owner=self.other)
        old = self.contract(-40, client="Fox", product="ERP AMC", value=40000)
        Contract.objects.filter(pk=old.pk).update(status="lost")
        s = self.api(self.admin).get("/api/renewals/summary/").data
        self.assertEqual((s["upcoming"]["count"], s["upcoming"]["value"]), (2, 250000))
        self.assertEqual((s["at_risk"]["value"], s["at_risk"]["expired"]["count"]), (80000, 1))           # Gamma ended + Beta in 10 days
        self.assertEqual((s["rate"]["came_up"], s["rate"]["lost"], s["rate"]["pending"], s["rate"]["rate"]), (2, 1, 1, 0.0))
        self.assertEqual([b["month"] for b in s["by_month"]][:2], ["2026-10", "2026-11"])
        self.assertEqual(s["by_month"][0]["lost"], 0)                                                      # Fox ended in September
        ideas = {u["client"]: [i["product"] for i in u["ideas"]] for u in s["upsell"]}
        self.assertEqual(ideas["Acme Ltd"], ["HR module"])                                               # two clients have it, Acme doesn't
        self.assertEqual(s["warnings"], {"unowned": 0, "no_sheet": ["Other Person"]})
        mine = self.api(self.member).get("/api/renewals/summary/").data
        self.assertEqual((mine["scope"], mine["contracts"]["total"], mine["warnings"]), ("mine", 5, {}))

    # ----- the huddle and the weekly digest -----
    def test_huddle_and_digest_include_renewals(self):
        self.contract(10, client="Beta Bank")
        self.contract(-2, client="Gamma", owner=self.other)
        self.contract(70, client="Far enough")
        a = self.api(self.admin).get("/api/ops/huddle/").data["attention"]["renewals"]
        self.assertEqual((a["days"], a["total"], a["expired"], [i["client"] for i in a["items"]]), (30, 2, 1, ["Gamma", "Beta Bank"]))
        m = self.api(self.member).get("/api/ops/huddle/").data["attention"]["renewals"]
        self.assertEqual([i["client"] for i in m["items"]], ["Beta Bank"])
        d = self.api(self.admin).get("/api/ops/digest/?week=2026-10-17").data
        self.assertEqual((d["data"]["renewals"]["coming"]["count"], d["data"]["renewals"]["ended"]["count"]), (2, 0))
        self.assertIn("Renewals", d["html"])
        self.assertIn("Beta Bank", d["html"])
