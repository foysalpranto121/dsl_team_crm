"""Starting task list and job roles, taken from the DSL Team Operation Sheet (CONFIG tab). Admins can change all of it."""

TASKS = [
    ("Lead Generation", "Manual Prospecting - Collect 10 leads", 1), ("Lead Generation", "Tool Prospecting - Collect 30 leads", 1),
    ("Cold Client Calling", "Make 8 Cold Calls", 1), ("Cold Client Calling", "Follow-up Calls - Make 8 Calls", 1),
    ("Cold Client Emailing", "Send 8 Cold Emails", 1), ("Cold Client Emailing", "Follow-up Emails - Send 8 Emails", 1),
    ("Cold Client Emailing", "Send 2 Cold Intelligent Emails", 2), ("Cold Client Visit", "Trade Show / Event Participation", 3),
    ("Cold Client Visit", "Cold Office Visit (Client Meeting)", 2), ("Cold Client Visit", "Cold Office Visit (Warm Up)", 1),
    ("Client Meeting", "Requirement Collection Meeting", 4), ("Client Meeting", "Demo & Presentation Session", 10),
    ("Proposal Preparation", "Full Proposal Preparation", 5), ("Proposal Preparation", "Proposal (1/2) Preparation", 2),
    ("Proposal Preparation", "Proposal (2/2) Preparation", 2), ("Proposal Preparation", "Proposal (1/3) Preparation", 2),
    ("Proposal Preparation", "Proposal (2/3) Preparation", 2), ("Proposal Preparation", "Proposal (3/3) Preparation", 2),
    *[("Proposal Preparation", f"Tender ({i}/10) Preparation", 3) for i in range(1, 11)],
    ("Sales", "Client Work Order Receiving", 100), ("Planning & Reporting", "Daily Planning / CRM Reporting", 1),
    ("Office Meeting", "Team Meeting", 1), ("Office Meeting", "Internal Office Meeting", 1),
    ("Commercial", "Client Invoice Preparation", 2), ("Commercial", "Tender Related Outdoor Activities", 1),
    ("Product Management", "Market Research", 5), ("Product Management", "Product Demo Preparation", 5),
    ("Product Management", "Requirement Analysis Documentation", 1), ("Product Management", "Product Content Development", 2),
    ("Product Management", "GTM Material Development", 2), ("Special Assignment", "Special Task by Team Leader", 1),
    ("Special Assignment", "Team Coordination & Reporting", 1), ("Special Assignment", "Monthly Report Preparation", 1),
    ("Special Assignment", "Monthly Presentation", 1),
]
_ALL = [t[1] for t in TASKS]
_PRODUCT_ONLY = {"Market Research", "Requirement Analysis Documentation", "Product Content Development", "GTM Material Development"}
_SALES_CORE = [n for n in _ALL if n not in _PRODUCT_ONLY]
_MARKETING = ["Manual Prospecting - Collect 10 leads", "Tool Prospecting - Collect 30 leads", "Send 8 Cold Emails",
              "Follow-up Emails - Send 8 Emails", "Send 2 Cold Intelligent Emails", "Trade Show / Event Participation",
              "Demo & Presentation Session", "Daily Planning / CRM Reporting", "Team Meeting", "Internal Office Meeting",
              "Market Research", "Product Demo Preparation", "Product Content Development", "GTM Material Development",
              "Special Task by Team Leader", "Team Coordination & Reporting", "Monthly Report Preparation", "Monthly Presentation"]

# name: (tasks, weights for hours, points, leads, opps, clients, revenue)
ROLES = {
    "National Sales (Tender)": (_SALES_CORE, (20, 5, 15, 10, 10, 40)),
    "International Sales (Product)": (_ALL, (20, 5, 10, 15, 10, 40)),
    "International Sales (AI)": (_SALES_CORE, (20, 5, 20, 15, 10, 30)),
    "Marketing": (_MARKETING, (20, 10, 70, 0, 0, 0)),
}


def load(Task, JobRole, TeamSettings):
    """Create the template if there are no tasks yet. Works with real or migration (historical) models."""
    if Task.objects.exists():
        return False
    TeamSettings.objects.get_or_create(pk=1, defaults={"weekend_days": [5]})
    tasks = {name: Task.objects.create(type=typ, name=name, points=pts, position=i) for i, (typ, name, pts) in enumerate(TASKS)}
    for name, (task_names, w) in ROLES.items():
        role = JobRole.objects.create(name=name, **dict(zip(["w_hours", "w_points", "w_leads", "w_opps", "w_clients", "w_revenue"], w)))
        role.tasks.set([tasks[n] for n in task_names])
    return True
