"""python manage.py send_test_email you@gmail.com — check that approval emails can be sent."""
from django.conf import settings
from django.core.mail import send_mail
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Send one test email using the Gmail settings in backend/.env."

    def add_arguments(self, parser):
        parser.add_argument("to", help="Where to send the test email")

    def handle(self, *args, **opts):
        if "console" in settings.EMAIL_BACKEND:
            raise CommandError("Email isn't set up yet: add EMAIL_HOST_USER and EMAIL_HOST_PASSWORD (the 16-letter Gmail App Password) "
                               "to backend/.env, then run this again.")
        try:
            send_mail("DSL TOS: test email", "If you can read this, approval emails will reach admins and new team members.",
                      settings.DEFAULT_FROM_EMAIL, [opts["to"]], fail_silently=False)
        except Exception as e:
            raise CommandError(f"Gmail refused the email: {e}. Check the App Password (no spaces) and that 2-Step Verification is on.") from e
        self.stdout.write(self.style.SUCCESS(f"Sent. Check {opts['to']} (and the spam folder)."))
