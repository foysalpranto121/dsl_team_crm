"""SRS v0.5 FR-K2/K5: weekly KPIs are now worked out from the pipeline. A team that already typed weekly numbers keeps them:
weeks before the current one stay as typed, and the pipeline takes over from this week on (Team setup can move the date)."""
from datetime import timedelta
from zoneinfo import ZoneInfo

from django.db import migrations
from django.utils import timezone


def forward(apps, schema_editor):
    Settings, Kpi = apps.get_model("team", "TeamSettings"), apps.get_model("team", "KpiEntry")
    st = Settings.objects.filter(pk=1).first()
    if not st or not Kpi.objects.exists():
        return
    today = timezone.now().astimezone(ZoneInfo(st.timezone or "Asia/Dhaka")).date()
    dow = (today.weekday() + 1) % 7   # the team calendar counts Sunday as 0 … Saturday as 6 (team.calc.dow)
    st.kpi_from = today - timedelta(days=(dow - st.week_start_dow) % 7)
    st.save(update_fields=["kpi_from"])


def backward(apps, schema_editor):
    apps.get_model("team", "TeamSettings").objects.filter(pk=1).update(kpi_from=None)


class Migration(migrations.Migration):
    dependencies = [("team", "0009_kpientry_adjust_kpientry_adjust_note_and_more")]
    operations = [migrations.RunPython(forward, backward)]
