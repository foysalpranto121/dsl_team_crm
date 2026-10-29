import re
import shutil
import tempfile
from io import BytesIO
from unittest import mock

from django.core import mail, signing
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from . import services
from .models import User

MEDIA = tempfile.mkdtemp()


def google(email, sub=None, name="Test Person"):
    """Pretend Google confirmed this person (the real check needs a live Google token)."""
    return mock.patch.object(services, "verify_google_token", return_value={"sub": sub or "g-" + email, "email": email, "name": name, "picture": ""})


@override_settings(ADMIN_EMAILS=["boss@example.com"], GOOGLE_CLIENT_ID="test-client", MEDIA_ROOT=MEDIA,
                   EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class SignInAndApprovalTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        cache.clear()  # resets the sign-in rate limit between tests
        self.api = APIClient()

    def sign_in(self, email, client=None, **kw):
        # emails are sent after the database commits; tests never commit, so run those callbacks here
        with google(email, **kw), self.captureOnCommitCallbacks(execute=True):
            return (client or self.api).post("/api/auth/google/", {"credential": "x"}, format="json")

    def make_admin(self):
        r = self.sign_in("boss@example.com")
        self.assertEqual(r.data["status"], "approved")
        return User.objects.get(email="boss@example.com")

    def test_admin_email_is_approved_as_admin_and_gets_tokens(self):
        r = self.sign_in("Boss@Example.com")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["user"]["role"], "admin")
        self.assertIn("access", r.data)
        cookie = r.cookies["dsl_refresh"]
        self.assertTrue(cookie["httponly"])
        self.assertEqual(cookie["path"], "/api/auth/")

    def test_new_person_waits_for_approval_and_admins_get_an_email(self):
        self.make_admin()
        mail.outbox.clear()
        r = self.sign_in("new@example.com")
        self.assertEqual(r.data["status"], "pending")
        self.assertNotIn("access", r.data)
        self.assertNotIn("dsl_refresh", r.cookies)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["boss@example.com"])
        self.assertIn("/api/auth/approval/", mail.outbox[0].body)
        # signing in again does not send a second email
        self.sign_in("new@example.com")
        self.assertEqual(len(mail.outbox), 1)

    def test_approve_link_needs_a_button_press_then_emails_the_person(self):
        self.make_admin()
        self.sign_in("new@example.com")
        link = re.search(r"Approve: \S+(/api/auth/approval/\S+/)", mail.outbox[-1].body).group(1)
        page = self.client.get(link)
        self.assertContains(page, "Approve access?")
        self.assertEqual(User.objects.get(email="new@example.com").status, "pending")  # opening the link changes nothing
        mail.outbox.clear()
        with self.captureOnCommitCallbacks(execute=True):
            done = self.client.post(link, {"role": "viewer"})
        self.assertContains(done, "approved as viewer")
        person = User.objects.get(email="new@example.com")
        self.assertEqual((person.status, person.role, person.approved_by.email), ("approved", "viewer", "boss@example.com"))
        self.assertEqual(mail.outbox[0].to, ["new@example.com"])
        again = self.client.post(link, {"role": "admin"})
        self.assertContains(again, "Already decided")
        self.assertEqual(User.objects.get(email="new@example.com").role, "viewer")

    def test_admin_approves_someone_as_admin_who_can_then_approve_others(self):
        self.make_admin()
        self.sign_in("colleague@example.com")
        link = re.search(r"Approve: \S+(/api/auth/approval/\S+/)", mail.outbox[-1].body).group(1)
        self.assertContains(self.client.get(link), '<option value="admin"')
        with self.captureOnCommitCallbacks(execute=True):
            self.client.post(link, {"role": "admin"})
        self.assertEqual(User.objects.get(email="colleague@example.com").role, "admin")
        mail.outbox.clear()
        self.sign_in("third@example.com")
        self.assertEqual(sorted(m.to[0] for m in mail.outbox), ["boss@example.com", "colleague@example.com"])  # both admins asked

    def test_reject_link(self):
        self.make_admin()
        self.sign_in("new@example.com")
        link = re.search(r"Reject:  \S+(/api/auth/approval/\S+/)", mail.outbox[-1].body).group(1)
        self.client.post(link)
        self.assertEqual(User.objects.get(email="new@example.com").status, "rejected")
        self.assertEqual(self.sign_in("new@example.com").data["status"], "rejected")

    def test_tampered_or_expired_links_do_nothing(self):
        admin = self.make_admin()
        self.sign_in("new@example.com")
        person = User.objects.get(email="new@example.com")
        self.assertContains(self.client.get("/api/auth/approval/nonsense/"), "valid any more")
        token = services.approval_token(person, "approve", admin)
        with override_settings(APPROVAL_LINK_MAX_AGE=-1):
            self.assertContains(self.client.post(f"/api/auth/approval/{token}/"), "expired")
        forged = signing.dumps({"u": person.pk, "a": "approve", "by": person.pk}, salt=services.APPROVAL_SALT)
        self.assertContains(self.client.post(f"/api/auth/approval/{forged}/"), "valid any more")  # signer must be an admin
        self.assertEqual(User.objects.get(pk=person.pk).status, "pending")

    def test_first_sign_in_after_approval_then_profile_completion(self):
        admin = self.make_admin()
        self.sign_in("new@example.com")
        services.approve(User.objects.get(email="new@example.com"), admin)
        r = self.sign_in("new@example.com")
        self.assertEqual(r.data["status"], "approved")
        self.assertFalse(r.data["user"]["profile"]["is_complete"])
        self.api.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["access"])
        p = self.api.patch("/api/me/profile/", {"position": "Sales Executive", "job_description": "Tender sales", "phone": "+880 1712 345678",
                                                "official_email": "new@dsl.example", "bio": "Hello"}, format="json")
        self.assertEqual(p.status_code, 200, p.data)
        self.assertTrue(p.data["is_complete"])
        self.assertIsNotNone(p.data["completed_at"])
        bad = self.api.patch("/api/me/profile/", {"phone": "call me"}, format="json")
        self.assertEqual(bad.status_code, 400)
        me = self.api.patch("/api/me/", {"name": "New Name", "role": "admin"}, format="json")
        self.assertEqual((me.data["name"], me.data["role"]), ("New Name", "member"))  # role can't be self-assigned

    def test_profile_photo_is_resized_and_checked(self):
        r = self.sign_in("boss@example.com")
        self.api.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["access"])
        buf = BytesIO()
        Image.new("RGB", (2000, 1000), "navy").save(buf, "PNG")
        up = self.api.patch("/api/me/profile/", {"photo": SimpleUploadedFile("me.png", buf.getvalue(), "image/png")}, format="multipart")
        self.assertEqual(up.status_code, 200, up.data)
        self.assertTrue(up.data["photo_url"].endswith(".jpg"))
        stored = Image.open(User.objects.get(email="boss@example.com").profile.photo.path)
        self.assertLessEqual(max(stored.size), 512)
        junk = self.api.patch("/api/me/profile/", {"photo": SimpleUploadedFile("x.png", b"not an image", "image/png")}, format="multipart")
        self.assertEqual(junk.status_code, 400)

    def test_refresh_rotates_and_old_cookie_stops_working(self):
        r = self.sign_in("boss@example.com")
        old = r.cookies["dsl_refresh"].value
        r2 = self.api.post("/api/auth/refresh/")
        self.assertEqual(r2.status_code, 200)
        self.assertIn("access", r2.data)
        self.assertNotEqual(r2.cookies["dsl_refresh"].value, old)
        stale = APIClient()
        stale.cookies["dsl_refresh"] = old
        self.assertEqual(stale.post("/api/auth/refresh/").status_code, 401)

    def test_logout_ends_the_session(self):
        self.sign_in("boss@example.com")
        self.assertEqual(self.api.post("/api/auth/logout/").status_code, 204)
        self.assertEqual(self.api.post("/api/auth/refresh/").status_code, 401)

    def test_disabled_person_loses_access_immediately(self):
        admin = self.make_admin()
        self.sign_in("new@example.com")
        person = services.approve(User.objects.get(email="new@example.com"), admin)
        c = APIClient()
        r = self.sign_in("new@example.com", client=c)
        c.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["access"])
        self.assertEqual(c.get("/api/me/").status_code, 200)
        person.status = User.Status.DISABLED
        person.save()
        self.assertEqual(c.get("/api/me/").status_code, 401)
        self.assertEqual(c.post("/api/auth/refresh/").status_code, 401)
        self.assertEqual(self.sign_in("new@example.com").data["status"], "disabled")

    def test_admin_api(self):
        r = self.sign_in("boss@example.com")
        admin_api = APIClient()
        admin_api.credentials(HTTP_AUTHORIZATION="Bearer " + r.data["access"])
        self.sign_in("new@example.com")
        person = User.objects.get(email="new@example.com")
        pending = admin_api.get("/api/admin/users/?status=pending")
        self.assertEqual([u["email"] for u in pending.data], ["new@example.com"])
        ok = admin_api.post(f"/api/admin/users/{person.pk}/approve/", {"role": "member"}, format="json")
        self.assertEqual(ok.data["status"], "approved")
        member = APIClient()
        member.credentials(HTTP_AUTHORIZATION="Bearer " + self.sign_in("new@example.com", client=member).data["access"])
        self.assertEqual(member.get("/api/admin/users/").status_code, 403)
        self.assertEqual(len(member.get("/api/team/directory/").data), 2)
        boss = User.objects.get(email="boss@example.com")
        lone = admin_api.patch(f"/api/admin/users/{boss.pk}/", {"role": "member"}, format="json")
        self.assertEqual(lone.status_code, 400)  # the only admin can't step down
        self.assertEqual(admin_api.post(f"/api/admin/users/{boss.pk}/reject/").status_code, 400)

    def test_email_linked_to_another_google_account_is_refused(self):
        self.sign_in("boss@example.com", sub="first")
        r = self.sign_in("boss@example.com", sub="second")
        self.assertEqual(r.status_code, 400)

    @override_settings(GOOGLE_ALLOWED_DOMAINS=["dsl.example"])
    def test_company_domain_restriction(self):
        with mock.patch("google.oauth2.id_token.verify_oauth2_token",
                        return_value={"sub": "1", "email": "x@gmail.com", "email_verified": True}):
            r = self.api.post("/api/auth/google/", {"credential": "x"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("company", r.data["detail"])

    def test_unverified_google_email_is_refused(self):
        with mock.patch("google.oauth2.id_token.verify_oauth2_token", return_value={"sub": "1", "email": "x@example.com", "email_verified": False}):
            r = self.api.post("/api/auth/google/", {"credential": "x"}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_bad_google_token(self):
        with mock.patch("google.oauth2.id_token.verify_oauth2_token", side_effect=ValueError("bad")):
            r = self.api.post("/api/auth/google/", {"credential": "x"}, format="json")
        self.assertEqual(r.status_code, 400)
