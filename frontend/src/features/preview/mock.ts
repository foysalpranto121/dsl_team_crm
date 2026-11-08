/* Sample data for the Preview area, and only that. Made-up people and numbers, so the screens can be judged before they're connected to DRF.
   Role profiles, weights, stages and categories are the SRS v0.5 §12.1 ones. Totals are worked out from the rows here rather than typed, so every screen agrees with every other. */

export const SAMPLE_TODAY = "2026-10-29";
export const SAMPLE_TODAY_LABEL = "Thursday 29 October 2026";
export const CURRENCY = "BDT";

export type MetricKey = "hours" | "points" | "leads" | "opps" | "clients" | "revenue";
export type PeriodKey = "week" | "month" | "last";
export type RoleKey = "tender" | "product" | "ai" | "marketing";
export type Numbers = Record<MetricKey, number>;

export const METRICS: { key: MetricKey; label: string; means: string }[] = [
  { key: "hours", label: "Output hours", means: "Hours that count: logged, and approved where approval is needed." },
  { key: "points", label: "Points", means: "What your hours and verified events earned." },
  { key: "leads", label: "Qualified leads", means: "Records that first reached Qualified Lead." },
  { key: "opps", label: "Opportunities", means: "Records that first reached Requirements Shared." },
  { key: "clients", label: "Clients", means: "Wins whose work order a supervisor verified." },
  { key: "revenue", label: "Revenue", means: "The value of verified wins." },
];
export const PERIODS: { key: PeriodKey; label: string; of: string }[] = [
  { key: "week", label: "This week", of: "24–29 Oct" }, { key: "month", label: "This month", of: "October" }, { key: "last", label: "Last month", of: "September" },
];

export const ROLES: Record<RoleKey, { name: string; weights: Numbers; plain: string; supervisor: string }> = {
  tender: { name: "National Sales (Tender)", weights: { hours: 20, points: 5, leads: 15, opps: 10, clients: 10, revenue: 40 }, plain: "You find government and corporate tenders, prepare the bids and follow them through to a work order.", supervisor: "Rezaul Karim" },
  product: { name: "International Sales (Product)", weights: { hours: 20, points: 5, leads: 10, opps: 15, clients: 10, revenue: 40 }, plain: "You sell our software products to clients abroad, from the first call to the signed work order.", supervisor: "Rezaul Karim" },
  ai: { name: "International Sales (AI)", weights: { hours: 20, points: 5, leads: 20, opps: 15, clients: 10, revenue: 30 }, plain: "You find companies abroad that need AI software, talk to them, and turn them into clients.", supervisor: "Rezaul Karim" },
  marketing: { name: "Marketing", weights: { hours: 20, points: 10, leads: 70, opps: 0, clients: 0, revenue: 0 }, plain: "You bring in qualified leads for the sales team, through campaigns, events and outreach.", supervisor: "Rezaul Karim" },
};

const SALES_MONTH: Numbers = { hours: 40, points: 350, leads: 20, opps: 8, clients: 2, revenue: 1500000 };
const SALES_WEEK: Numbers = { hours: 40, points: 81, leads: 5, opps: 2, clients: 1, revenue: 375000 };
const MKT_MONTH: Numbers = { hours: 40, points: 350, leads: 50, opps: 0, clients: 0, revenue: 0 };
const MKT_WEEK: Numbers = { hours: 40, points: 81, leads: 12, opps: 0, clients: 0, revenue: 0 };

export function targetsFor(role: RoleKey, period: PeriodKey): Numbers {
  if (role === "marketing") return period === "week" ? MKT_WEEK : MKT_MONTH;
  return period === "week" ? SALES_WEEK : SALES_MONTH;
}

export interface Person { id: string; name: string; initials: string; role: RoleKey; actual: Record<PeriodKey, Numbers>; adherence: { approved: number; completed: number; missed: number; deviations: number; unplanned: number }; overdue: number }

const n = (hours: number, points: number, leads: number, opps: number, clients: number, revenue: number): Numbers => ({ hours, points, leads, opps, clients, revenue });

export const PEOPLE: Person[] = [
  { id: "nadia", name: "Nadia Rahman", initials: "NR", role: "ai", overdue: 1, adherence: { approved: 240, completed: 230, missed: 4, deviations: 6, unplanned: 4 },
    actual: { week: n(38, 84, 5, 2, 1, 550000), month: n(39.5, 372, 21, 8, 2, 1650000), last: n(38, 350, 19, 7, 2, 1400000) } },
  { id: "sadia", name: "Sadia Karim", initials: "SK", role: "product", overdue: 0, adherence: { approved: 245, completed: 238, missed: 2, deviations: 3, unplanned: 2 },
    actual: { week: n(41, 79, 4, 3, 1, 700000), month: n(41, 340, 17, 9, 2, 1800000), last: n(39, 330, 15, 8, 2, 1600000) } },
  { id: "tanvir", name: "Tanvir Ahmed", initials: "TA", role: "marketing", overdue: 2, adherence: { approved: 230, completed: 200, missed: 5, deviations: 9, unplanned: 7 },
    actual: { week: n(36, 68, 11, 0, 0, 0), month: n(37, 300, 44, 0, 0, 0), last: n(36, 290, 41, 0, 0, 0) } },
  { id: "arif", name: "Arif Hossain", initials: "AH", role: "tender", overdue: 3, adherence: { approved: 225, completed: 190, missed: 9, deviations: 14, unplanned: 6 },
    actual: { week: n(33, 70, 3, 1, 0, 0), month: n(36, 310, 15, 7, 1, 1300000), last: n(35, 300, 14, 6, 1, 1100000) } },
  { id: "farhana", name: "Farhana Islam", initials: "FI", role: "tender", overdue: 11, adherence: { approved: 180, completed: 120, missed: 22, deviations: 18, unplanned: 3 },
    actual: { week: n(26, 49, 2, 1, 0, 0), month: n(28, 210, 8, 3, 1, 400000), last: n(20, 120, 3, 1, 0, 0) } },
];

export interface Thresholds { on: number; near: number }
export const DEFAULT_THRESHOLDS: Thresholds = { on: 1, near: 0.8 };

/** Composite score = Σ (weight × achievement), SRS §7. A 0% metric is shown but not scored. */
export function composite(role: RoleKey, actual: Numbers, target: Numbers, factor = 1) {
  const w = ROLES[role].weights;
  return METRICS.reduce((sum, m) => (w[m.key] && target[m.key] ? sum + (w[m.key] / 100) * (actual[m.key] / (target[m.key] * factor)) : sum), 0);
}
export const scoreOf = (p: Person, period: PeriodKey) => composite(p.role, p.actual[period], targetsFor(p.role, period));

export type StatusKey = "good" | "warning" | "danger";
export function statusOf(ratio: number, t: Thresholds = DEFAULT_THRESHOLDS): { status: StatusKey; label: string } {
  return ratio >= t.on ? { status: "good", label: "On target" } : ratio >= t.near ? { status: "warning", label: "Near" } : { status: "danger", label: "Below" };
}
export const adherenceOf = (p: Person) => p.adherence.completed / p.adherence.approved;
export const sumOf = (rows: Person[], period: PeriodKey, key: MetricKey) => rows.reduce((s, p) => s + p.actual[period][key], 0);
export const targetSumOf = (rows: Person[], period: PeriodKey, key: MetricKey) => rows.reduce((s, p) => s + targetsFor(p.role, period)[key], 0);
export const avgScore = (rows: Person[], period: PeriodKey) => (rows.length ? rows.reduce((s, p) => s + scoreOf(p, period), 0) / rows.length : 0);

/* ---------- this week on the Team Board ---------- */
export const WEEK_DAYS: { day: string; planned: number; actual: number }[] = [
  { day: "Sat 24", planned: 34, actual: 30 }, { day: "Sun 25", planned: 34, actual: 30 }, { day: "Mon 26", planned: 33, actual: 29 },
  { day: "Tue 27", planned: 33, actual: 29 }, { day: "Wed 28", planned: 32, actual: 28 }, { day: "Thu 29", planned: 32, actual: 28 },
];
export const PLAN_COVERAGE = { planned: WEEK_DAYS.reduce((s, d) => s + d.planned, 0), target: PEOPLE.length * 40 };

export interface Approval { id: string; kind: "Plan" | "Deviation" | "Unplanned"; who: string; what: string; waited: string; late?: boolean }
export const APPROVALS: Approval[] = [
  { id: "a1", kind: "Plan", who: "Arif Hossain", what: "Sun 1 Nov, 10 hours: 6 Tender Document Preparation, 4 Follow-up Calls", waited: "2 h" },
  { id: "a2", kind: "Deviation", who: "Farhana Islam", what: "H-4 was Make 8 Cold Calls, did Client Meeting. Reason: client asked to meet today", waited: "26 h" },
  { id: "a3", kind: "Deviation", who: "Tanvir Ahmed", what: "H-7 was Find 10 New Leads, did Office Meeting. Reason: campaign review", waited: "51 h", late: true },
  { id: "a4", kind: "Unplanned", who: "Nadia Rahman", what: "H-9, Follow-up Calls, 1 hour outside the plan", waited: "4 h" },
  { id: "a5", kind: "Plan", who: "Sadia Karim", what: "Sat 31 Oct, half day: 5 Prepare Proposal", waited: "1 h" },
];

/* ---------- pipeline ---------- */
export const FUNNEL_TOP = { lead: 230, demo: 19, proposal: 13, negotiation: 9 };
export const funnelOf = (rows: Person[], period: PeriodKey = "month") => [
  { stage: "Lead", value: Math.round(FUNNEL_TOP.lead * (rows.length / PEOPLE.length)) }, { stage: "Qualified Lead", value: sumOf(rows, period, "leads") }, { stage: "Requirements Shared", value: sumOf(rows, period, "opps") },
  { stage: "Solution/Demo", value: Math.round(FUNNEL_TOP.demo * (rows.length / PEOPLE.length)) }, { stage: "Proposal/Tender Submitted", value: Math.round(FUNNEL_TOP.proposal * (rows.length / PEOPLE.length)) },
  { stage: "Negotiation", value: Math.round(FUNNEL_TOP.negotiation * (rows.length / PEOPLE.length)) }, { stage: "Won", value: sumOf(rows, period, "clients") },
];
export const SEGMENT_FUNNEL = [
  { segment: "Tender", qualified: 30, requirements: 10, proposal: 6, won: 2 },
  { segment: "Corporate", qualified: 44, requirements: 9, proposal: 4, won: 2 },
  { segment: "SaaS", qualified: 31, requirements: 8, proposal: 3, won: 2 },
];
export const STALE_DEALS = [
  { company: "Karnaphuli Steel", who: "Arif Hossain", stage: "Proposal/Tender Submitted", days: 24, expected: 10, fix: "Call the procurement head and ask for a decision date." },
  { company: "Surma Tea Estates", who: "Farhana Islam", stage: "Negotiation", days: 18, expected: 7, fix: "Offer a phased rollout to unblock the budget." },
  { company: "Teesta Agro", who: "Tanvir Ahmed", stage: "Lead", days: 16, expected: 5, fix: "Hand over to sales or close it." },
];
export const DUE_DEALS = [
  { company: "Meghna Textiles", stage: "Negotiation", next: "Send the revised price", when: "Today" },
  { company: "Padma Foods", stage: "Solution/Demo", next: "Book the demo", when: "Today" },
  { company: "Rupsha Logistics", stage: "Requirements Shared", next: "Follow-up call", when: "Sat 31 Oct" },
];

/* ---------- categories and tasks (the month's 756 hours and 1,532 points, matching the people above) ---------- */
export const CATEGORIES: { name: string; hours: number; points: number; expected: number }[] = [
  { name: "Cold Client Calling", hours: 234, points: 312, expected: 33 }, { name: "Proposal Preparation", hours: 166, points: 498, expected: 24 }, { name: "Lead Generation", hours: 91, points: 137, expected: 12 },
  { name: "Cold Client Emailing", hours: 60, points: 60, expected: 8 }, { name: "Client Meeting", hours: 53, points: 212, expected: 7 }, { name: "Sales", hours: 45, points: 135, expected: 5 },
  { name: "Special Assignment", hours: 30, points: 30, expected: 3 }, { name: "Cold Client Visit", hours: 23, points: 69, expected: 3 }, { name: "Product Management", hours: 23, points: 23, expected: 2 },
  { name: "Commercial", hours: 15, points: 30, expected: 1 }, { name: "Planning & Reporting", hours: 12, points: 12, expected: 1 }, { name: "Office Meeting", hours: 4, points: 14, expected: 1 },
];
export const TASKS: { name: string; category: string; hours: number; points: number }[] = [
  { name: "Make 8 Cold Calls", category: "Cold Client Calling", hours: 198, points: 264 }, { name: "Follow-up Calls", category: "Cold Client Calling", hours: 36, points: 48 },
  { name: "Prepare Proposal", category: "Proposal Preparation", hours: 120, points: 360 }, { name: "Tender Document Preparation", category: "Proposal Preparation", hours: 46, points: 138 },
  { name: "Find 10 New Leads", category: "Lead Generation", hours: 91, points: 137 }, { name: "Send 10 Cold Emails", category: "Cold Client Emailing", hours: 60, points: 60 },
  { name: "Demo & Presentation Session", category: "Client Meeting", hours: 53, points: 212 }, { name: "Price Negotiation", category: "Sales", hours: 45, points: 135 },
];
export const ACTIVITIES = ["Make 8 Cold Calls", "Follow-up Calls", "Find 10 New Leads", "Send 10 Cold Emails", "Prepare Proposal", "Demo & Presentation Session", "Client Meeting", "Weekly Planning"];

/* ---------- today's slots ---------- */
export type SlotState = "done" | "planned" | "deviation" | "empty";
export interface Slot { id: string; activity: string | null; state: SlotState }
const slot = (i: number, activity: string | null, state: SlotState): Slot => ({ id: `H-${i}`, activity, state });
export const TODAY_SLOTS: Slot[] = [
  slot(1, "Make 8 Cold Calls", "done"), slot(2, "Make 8 Cold Calls", "done"), slot(3, "Follow-up Calls", "done"), slot(4, "Find 10 New Leads", "deviation"), slot(5, "Prepare Proposal", "planned"),
  slot(6, "Prepare Proposal", "planned"), slot(7, "Demo & Presentation Session", "planned"), slot(8, "Follow-up Calls", "planned"), slot(9, "Send 10 Cold Emails", "planned"), slot(10, null, "empty"),
];
export const PLAN_TEMPLATES: { key: string; name: string; why: string; slots: string[] }[] = [
  { key: "calling", name: "Calling day", why: "Your role's most common day", slots: ["Find 10 New Leads", "Make 8 Cold Calls", "Make 8 Cold Calls", "Make 8 Cold Calls", "Follow-up Calls", "Send 10 Cold Emails", "Make 8 Cold Calls", "Make 8 Cold Calls", "Follow-up Calls", "Weekly Planning"] },
  { key: "followup", name: "Follow-up day", why: "Good once you have live deals", slots: ["Follow-up Calls", "Follow-up Calls", "Client Meeting", "Client Meeting", "Send 10 Cold Emails", "Follow-up Calls", "Demo & Presentation Session", "Demo & Presentation Session", "Follow-up Calls", "Weekly Planning"] },
  { key: "proposal", name: "Proposal day", why: "When a proposal is due", slots: ["Prepare Proposal", "Prepare Proposal", "Prepare Proposal", "Prepare Proposal", "Client Meeting", "Prepare Proposal", "Prepare Proposal", "Follow-up Calls", "Follow-up Calls", "Weekly Planning"] },
];

/* ---------- onboarding ---------- */
export const ONBOARDING_STEPS = ["Your role", "This week", "First plan", "Practice", "Finish"];
export const NEW_JOINERS = [
  { name: "Rakib Hasan", role: "tender" as RoleKey, joined: "2026-10-27", step: 3, minutes: 6, active: "Today, 10:20" },
  { name: "Mim Akter", role: "marketing" as RoleKey, joined: "2026-10-28", step: 5, minutes: 9, active: "Today, 09:05" },
  { name: "Sabbir Hossain", role: "ai" as RoleKey, joined: "2026-10-28", step: 1, minutes: 2, active: "Yesterday, 16:40" },
  { name: "Tasnim Jahan", role: "product" as RoleKey, joined: "2026-10-29", step: 0, minutes: 0, active: "Not started" },
];
export const HELP_TEXTS: { id: string; field: string; text: string }[] = [
  { id: "activity", field: "Activity", text: "Choose what you did. The list shows only the activities your supervisor set for your role." },
  { id: "remarks", field: "Daily remarks", text: "A line on what you actually got done, such as who you called. It helps your supervisor help you." },
  { id: "stage", field: "Pipeline stage", text: "Where this client is now. Moving it updates your KPIs by itself, so there's nothing else to type." },
];
export const DAY30 = { name: "Nadia Rahman", from: "30 Sep", to: "29 Oct", hours: 39.5, adherence: 0.96, firstWin: "Meghna Textiles, 22 Oct", strongest: "Demo & Presentation Session: 4 points an hour", improved: "Plan adherence went from 81% in week 1 to 96% in week 4", focus: "Your calls turn into leads well. Try two more follow-up hours a week to move them on to demos." };

/* ---------- management ---------- */
export const MONTHS = ["May", "Jun", "Jul", "Aug", "Sep", "Oct"];
export const REVENUE_BY_MONTH = [{ month: "May", actual: 3800000, target: 6000000 }, { month: "Jun", actual: 4300000, target: 6000000 }, { month: "Jul", actual: 4100000, target: 6000000 }, { month: "Aug", actual: 4800000, target: 6000000 }, { month: "Sep", actual: 4100000, target: 6000000 }, { month: "Oct", actual: 5150000, target: 6000000 }];
const roleScore = (r: RoleKey, p: PeriodKey) => Math.round(avgScore(PEOPLE.filter((x) => x.role === r), p) * 100);
const trendRow = (month: string, tender: number, product: number, ai: number, marketing: number) => ({ month, [ROLES.tender.name]: tender, [ROLES.product.name]: product, [ROLES.ai.name]: ai, [ROLES.marketing.name]: marketing });
/** The last two months are worked out from the people above. */
export const SCORE_TREND: (Record<string, string | number> & { month: string })[] = [
  trendRow("May", 38, 84, 78, 72), trendRow("Jun", 41, 88, 82, 76), trendRow("Jul", 40, 86, 85, 79), trendRow("Aug", 43, 94, 91, 83),
  trendRow("Sep", roleScore("tender", "last"), roleScore("product", "last"), roleScore("ai", "last"), roleScore("marketing", "last")),
  trendRow("Oct", roleScore("tender", "month"), roleScore("product", "month"), roleScore("ai", "month"), roleScore("marketing", "month")),
];
export const DEVIATIONS_TOTAL = PEOPLE.reduce((s, p) => s + p.adherence.deviations, 0);
export const TOP_DEVIATIONS = [{ from: "Make 8 Cold Calls", to: "Client Meeting", count: 14 }, { from: "Find 10 New Leads", to: "Office Meeting", count: 9 }, { from: "Prepare Proposal", to: "Follow-up Calls", count: 7 }, { from: "Follow-up Calls", to: "Special Assignment", count: 4 }];
export const INSIGHTS = [
  { id: "i1", text: "Tender revenue is the biggest gap: BDT 13 L short of target. Two tenders are stuck past their expected days.", evidence: "Karnaphuli Steel, Surma Tea Estates", to: "Open stale deals" },
  { id: "i2", text: "Client Meeting replaces planned cold calls more than anything else. Planning two meeting hours a day could cut deviations by about a third.", evidence: `${TOP_DEVIATIONS[0].count} of ${DEVIATIONS_TOTAL} deviations this month`, to: "Open deviations" },
];

/* ---------- reports: weeks run Saturday to Thursday. October's 756 hours and 1,532 points are the four weeks below plus 1 Oct (32 h, 81 points). ---------- */
export const WEEKLY_PERFORMANCE = [
  { week: "19–24 Sep", hours: 170, points: 330 }, { week: "26 Sep–1 Oct", hours: 172, points: 341 }, { week: "3–8 Oct", hours: 180, points: 362 },
  { week: "10–15 Oct", hours: 188, points: 371 }, { week: "17–22 Oct", hours: 182, points: 368 }, { week: "24–29 Oct", hours: 174, points: 350 },
];
export const TURNAROUND = [
  { week: "26 Sep–1 Oct", decided: 62, median: 5.5, inSla: 0.92, escalated: 1 }, { week: "3–8 Oct", decided: 71, median: 6, inSla: 0.9, escalated: 2 }, { week: "10–15 Oct", decided: 68, median: 4.5, inSla: 0.96, escalated: 0 },
  { week: "17–22 Oct", decided: 74, median: 8, inSla: 0.81, escalated: 4 }, { week: "24–29 Oct", decided: 59, median: 7, inSla: 0.85, escalated: 3 },
];

/* ---------- notifications (FR-N1) ---------- */
export type NoticeKind = "plan_submitted" | "plan_decided" | "deviation_pending" | "missing_log" | "sla_breach" | "kpi_due";
export const NOTICE_KINDS: { key: NoticeKind; label: string; who: "member" | "supervisor" | "both" }[] = [
  { key: "plan_submitted", label: "Plan submitted", who: "supervisor" }, { key: "plan_decided", label: "Plan approved or sent back", who: "member" }, { key: "deviation_pending", label: "Deviation pending", who: "both" },
  { key: "missing_log", label: "Missing log at the lock", who: "member" }, { key: "sla_breach", label: "Approval past its SLA", who: "supervisor" }, { key: "kpi_due", label: "KPI confirmation due", who: "member" },
];
export interface Notice { id: string; kind: NoticeKind; title: string; body: string; at: string; hour: number; forWho: "member" | "supervisor" }
export const NOTICES: Notice[] = [
  { id: "n1", kind: "plan_decided", title: "Your plan for Sunday is approved", body: "Rezaul approved all 10 hours. They're on your Playbook.", at: "08:40", hour: 8, forWho: "member" },
  { id: "n2", kind: "deviation_pending", title: "H-4 is waiting for a decision", body: "Find 10 New Leads instead of Make 8 Cold Calls. It counts once Rezaul approves it.", at: "11:15", hour: 11, forWho: "member" },
  { id: "n3", kind: "missing_log", title: "Two hours aren't logged yet", body: "Today locks at midnight. H-5 and H-6 are still open.", at: "21:30", hour: 21, forWho: "member" },
  { id: "n4", kind: "kpi_due", title: "Confirm this week's KPIs", body: "One tap in your Weekly Review. They're already worked out from your pipeline.", at: "16:00", hour: 16, forWho: "member" },
  { id: "n5", kind: "plan_decided", title: "One planned hour was sent back", body: "Rezaul asked you to change H-8 on Saturday.", at: "22:45", hour: 22, forWho: "member" },
  { id: "n6", kind: "plan_submitted", title: "Arif submitted Sunday's plan", body: "10 hours are waiting on the Team Board.", at: "09:10", hour: 9, forWho: "supervisor" },
  { id: "n7", kind: "plan_submitted", title: "Sadia submitted Saturday's plan", body: "A half day, 5 hours.", at: "10:02", hour: 10, forWho: "supervisor" },
  { id: "n8", kind: "deviation_pending", title: "Farhana has a deviation waiting", body: "It has been 26 hours. It counts as zero until you decide.", at: "11:30", hour: 11, forWho: "supervisor" },
  { id: "n9", kind: "sla_breach", title: "Tanvir's deviation is past its window", body: "51 hours, over the 48-hour window. It has gone up to the next approver.", at: "13:00", hour: 13, forWho: "supervisor" },
];

/* ---------- configuration (FR-C2, C3, C5, C7, C8, C10) ---------- */
export const OVERRIDES = [
  { id: "o1", who: "Arif Hossain", what: "Weekly hours", from: "40", to: "32", effective: "2026-11-01", why: "Part-time during the tender season" },
  { id: "o2", who: "Sadia Karim", what: "Points: Prepare Proposal", from: "3", to: "4", effective: "2026-10-01", why: "Works on the largest proposals" },
  { id: "o3", who: "Tanvir Ahmed", what: "Target: Qualified leads", from: "50", to: "45", effective: "2026-09-01", why: "Campaign budget was cut" },
];
export const CSV_ROWS = [
  { row: 2, category: "Cold Client Calling", task: "Make 8 Cold Calls", mode: "Hours", points: "1", problem: "" }, { row: 3, category: "Cold Client Calling", task: "Follow-up Calls", mode: "Hours", points: "1", problem: "" },
  { row: 4, category: "Proposal Preparation", task: "Prepare Proposal", mode: "Hours", points: "3", problem: "" }, { row: 5, category: "Client Meeting", task: "Demo & Presentation Session", mode: "Hours", points: "4", problem: "" },
  { row: 6, category: "Sales", task: "Client Work Order Receiving", mode: "Event", points: "100", problem: "" }, { row: 7, category: "Cold Client Emailng", task: "Send 10 Cold Emails", mode: "Hours", points: "1", problem: "No such category. Did you mean Cold Client Emailing?" },
  { row: 8, category: "Lead Generation", task: "Find 10 New Leads", mode: "Hours", points: "ten", problem: "Points must be a number, 0 or more." }, { row: 9, category: "Office Meeting", task: "Weekly Team Meeting", mode: "Hours", points: "0", problem: "" },
];
export const PACKS = [
  { key: "b2b", name: "Software B2B Sales", what: "The pack built from your sheets", counts: "43 activities · 4 role profiles · 8 stages · 7 frameworks", installed: true },
  { key: "tender", name: "Tender Sales", what: "Bids, deadlines and tender follow-up", counts: "22 activities · 2 role profiles · 6 stages · 4 frameworks", installed: false },
  { key: "marketing", name: "Marketing Lead Generation", what: "Campaigns, events and lead handover", counts: "18 activities · 1 role profile · 4 stages · 2 frameworks", installed: false },
  { key: "blank", name: "Blank", what: "Start from nothing and add your own", counts: "No activities, roles or frameworks", installed: false },
];

/* ---------- leave handling (§6, §7): October 2026, weeks start on Saturday, Friday off ---------- */
export type DayType = "work" | "leave" | "training" | "holiday" | "off";
export const OCT_FIRST_DOW = 4;             // 1 Oct 2026 is a Thursday (Sun = 0)
export const OCT_DAYS = 31;
export const WEEKLY_OFF_DOW = 5;            // Friday
export const TEAM_HOLIDAYS: Record<number, string> = { 20: "Team holiday" };
export const LEAVE_START: Record<string, Record<number, DayType>> = {
  arif: { 12: "leave", 13: "leave", 14: "leave" }, farhana: { 5: "training", 6: "training" }, nadia: {}, sadia: { 25: "leave" }, tanvir: {},
};
