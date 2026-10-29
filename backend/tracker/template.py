"""Defaults for the personal tracker, taken from the original single-page tracker (index.html)."""

STAGES = [("prospect", "Prospect"), ("contacted", "Contacted"), ("lead", "Lead"), ("opp", "Opportunity"), ("client", "Client"), ("lost", "Lost")]
RANK = {"prospect": 0, "contacted": 1, "lead": 2, "opp": 3, "client": 4, "lost": -1}

LISTS = {
    "countries": ["UAE", "United Kingdom", "Malaysia", "India", "USA", "Saudi Arabia", "Qatar", "Singapore", "Canada", "Australia", "Bangladesh", "Other"],
    "industries": ["Education / Study abroad", "Real estate", "Clinic / Healthcare", "Odoo user", "Agency / Odoo partner", "E-commerce / Retail",
                   "Travel / Hospitality", "Other"],
    "channels": ["Email", "LinkedIn", "Referral", "WhatsApp", "Directory", "Webinar", "Other"],
    "plans": ["Not known", "Test Drive", "Starter", "Growth", "Scale", "Custom"],
}

# points: each milestone when a prospect first reaches it, each activity per unit
MILESTONES = [("m_lead", "New lead (interested reply)", 3), ("m_opp", "Opportunity (demo / trial)", 5), ("m_client", "Client won", 15)]
ACTIVITIES = [("email", "Cold email sent", 0.1), ("li_req", "LinkedIn connection request", 0.1), ("followup", "Follow-up sent", 0.2),
              ("li_msg", "LinkedIn message", 0.2), ("call", "Discovery call", 2), ("demo", "Demo delivered", 4), ("trial", "Trial started", 3),
              ("post", "LinkedIn post", 2), ("webinar", "Webinar / Live hosted", 5), ("partner", "Partner / agency meeting", 3),
              ("referral", "Referral received", 3), ("other", "Other", 1)]
DEFAULT_RULES = {k: d for k, _, d in MILESTONES + ACTIVITIES}

CENTRAL_AI_WEEKS = [
    {"leads": 5, "opps": 1, "clients": 0, "points": 70, "focus": "Setup: LinkedIn profile, demo bots, 450+ prospect list, launch outreach"},
    {"leads": 9, "opps": 4, "clients": 1, "points": 75, "focus": "Volume + personalised demos, start 7-day trials, contact Odoo partners"},
    {"leads": 9, "opps": 5, "clients": 2, "points": 75, "focus": "Convert trials, follow-ups #2–3, webinar, ask for referrals"},
    {"leads": 7, "opps": 5, "clients": 2, "points": 80, "focus": "Close open opportunities, month-end offer, final report"},
]

# The Central AI 30-day launch plan (day number from the period start). Only used with the "centralai" plan template.
PLAN_DAY = {
    1: ["Ask your manager exactly how points are earned, then update Point rules", "Optimise LinkedIn profile: headline, banner, DIU case study in Featured", "Set your name and targets in Settings"],
    2: ["Build 3 demo bots on Test Drive: education, real estate, clinic", "Record a 2-minute demo video for each bot", "Write a 1-page PDF: problem → solution → DIU result"],
    3: ["Ask IT for a separate sending inbox and start warm-up", "Build prospect list: 150 education / study-abroad companies (UAE, UK, Malaysia)", "Write cold email, 3 follow-ups and the LinkedIn connection note"],
    4: ["Build prospect list: 150 real estate (UAE) and clinics (Malaysia, UK)", "Publish LinkedIn post #1: DIU case study"],
    5: ["Build prospect list: 150 Odoo users and Odoo partners", "Import prospect lists into the CRM (Settings → Import CSV)"],
    6: ["Weekend: 15 minutes of LinkedIn engagement (optional)"],
    7: ["Publish LinkedIn post #2: why leads go cold in 5 minutes", "Week 1 review: if reply rate is under 2%, change subject lines and niche"],
    8: ["Send follow-up #1 to all Week 1 non-responders"],
    9: ["Pitch a referral partnership to 10 Odoo partners / agencies"],
    10: ["Train a bot on each hot lead's own website before their demo", "Start a 7-day Test Drive for every new opportunity"],
    11: ["Publish LinkedIn post #3: short demo video clip"],
    12: ["Fix the Week 3 webinar date and invite all prospects"],
    13: ["Weekend: 15 minutes of LinkedIn engagement (optional)"],
    14: ["Week 2 review: target 14 leads, 5 opps, 1 client", "Push the warmest lead to sign up"],
    15: ["Trial check-in calls (day 5–6): show leads captured and time saved", "Prepare answers: price, data security, 'we already have a chatbot'"],
    16: ["Send follow-up #2 to non-responders"],
    17: ["Promote the webinar: LinkedIn post and reminder email"],
    18: ["Host 30-minute webinar: How DIU captured 2,000+ leads with AI"],
    19: ["Follow up every webinar attendee within 24 hours", "Ask each new client for 2 referrals"],
    20: ["Weekend: 15 minutes of LinkedIn engagement (optional)"],
    21: ["Week 3 review: target 23 leads, 10 opps, 3 clients", "Send follow-up #3 to remaining non-responders"],
    22: ["List every open opportunity with a closing plan"],
    23: ["Send the month-end offer (valid until the last day) to open opportunities"],
    24: ["Closing calls with every open opportunity"],
    25: ["Send break-up emails to cold prospects"],
    26: ["US Thanksgiving: focus outreach on UAE, Malaysia and UK"],
    27: ["Weekend: 15 minutes of LinkedIn engagement (optional)"],
    28: ["Final closing push: call every trial and hot lead"],
    29: ["Prepare the monthly report: results, December pipeline, lessons learned"],
    30: ["Submit the final report to your manager", "Move open opportunities into next month's plan"],
}
ROUTINE = ["Send 30 cold emails with a personalised first line", "Send 20 LinkedIn connection requests", "Send every follow-up due today",
           "Comment on 10 prospect posts on LinkedIn", "Log today's activity and update the pipeline"]
ROUTINE_CLOSE = ["Send 15 cold emails", "Send 10 LinkedIn connection requests", "Send every follow-up due today", "Log today's activity and update the pipeline"]
