"""Send email through Brevo's HTTPS API (free: 300 a day).

Free Render servers block the SMTP ports Gmail needs, so on the free plan email goes out over HTTPS instead.
Set BREVO_API_KEY and a DEFAULT_FROM_EMAIL whose address is a verified sender in Brevo.
"""
import logging
from email.utils import parseaddr

import requests
from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend
from django.core.mail.backends.console import EmailBackend as DjangoConsoleBackend

log = logging.getLogger(__name__)
URL = "https://api.brevo.com/v3/smtp/email"


class _SafeStream:
    """Writes text the terminal can't encode with a replacement mark instead of raising."""

    def __init__(self, stream):
        self._stream = stream

    def write(self, text):
        enc = getattr(self._stream, "encoding", None) or "utf-8"
        return self._stream.write(text.encode(enc, errors="replace").decode(enc))

    def flush(self):
        self._stream.flush()


class ConsoleEmailBackend(DjangoConsoleBackend):
    """Development, when no email service is set up: emails print in the terminal. A character the terminal can't show
    (e.g. "→" on a Windows code page) is replaced, instead of failing the send."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.stream = _SafeStream(self.stream)


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
