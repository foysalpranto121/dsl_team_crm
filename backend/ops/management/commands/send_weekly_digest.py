from datetime import date

from django.core.management.base import BaseCommand, CommandError

from ops import services


class Command(BaseCommand):
    help = "Email the weekly management digest (last week by default). Safe to run often: each week goes out once."

    def add_arguments(self, parser):
        parser.add_argument("--week", help="Any day in the week to send, as YYYY-MM-DD (default: last week).")
        parser.add_argument("--force", action="store_true", help="Send even if that week's digest already went out.")

    def handle(self, *args, week=None, force=False, **options):
        try:
            if week:
                try:
                    day = date.fromisoformat(week)
                except ValueError:
                    raise CommandError("Give the week as YYYY-MM-DD, e.g. --week 2026-10-24.")
                sent = services.send_digest(day, force=force)
            else:
                sent, ws = services.run_scheduled()
                if sent is None and force:
                    sent = services.send_digest(ws, force=True)
                if sent is None:
                    self.stdout.write(f"The digest for the week of {ws} already went out. Use --force to send it again.")
                    return
        except services.AlreadySent as e:
            self.stdout.write(f"The digest for the week of {e.args[0]} already went out. Use --force to send it again.")
            return
        except services.NoRecipients as e:
            raise CommandError(str(e))
        self.stdout.write(self.style.SUCCESS(f"Sent the digest for the week of {sent.week_start} to {len(sent.recipients)} people."))
