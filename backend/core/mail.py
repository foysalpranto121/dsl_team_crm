"""Send email through Brevo's HTTPS API (free: 300 a day).

Free Render servers block the SMTP ports Gmail needs, so on the free plan email goes out over HTTPS instead.
Set BREVO_API_KEY and a DEFAULT_FROM_EMAIL whose address is a verified sender in Brevo.
"""
import logging
from email.utils import parseaddr

import requests
from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend

log = logging.getLogger(__name__)
URL = "https://api.brevo.com/v3/smtp/email"


class BrevoEmailBackend(BaseEmailBackend):
    def send_messages(self, messages):
        sent = 0
        for m in messages:
            name, addr = parseaddr(m.from_email or settings.DEFAULT_FROM_EMAIL)
            body = {"sender": {"email": addr, **({"name": name} if name else {})}, "subject": m.subject,
                    "to": [{"email": parseaddr(t)[1]} for t in m.to], "textContent": m.body}
            if m.cc:
                body["cc"] = [{"email": parseaddr(t)[1]} for t in m.cc]
            for content, mimetype in getattr(m, "alternatives", []):
                if mimetype == "text/html":
                    body["htmlContent"] = content
            try:
                r = requests.post(URL, json=body, headers={"api-key": settings.BREVO_API_KEY, "accept": "application/json"}, timeout=15)
                r.raise_for_status()
                sent += 1
            except requests.RequestException as e:
                if not self.fail_silently:
                    detail = e.response.text if e.response is not None else ""
                    raise RuntimeError(f"Brevo didn't accept the email: {e} {detail}".strip()) from e
                log.exception("Brevo email failed")
        return sent
