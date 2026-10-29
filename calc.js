/* Team sheet calculations: hours, points, weeks, months, dashboard and performance scores.
   Plain functions with no screen code, shared by team.js in the browser and the tests in Node.
   Dates are "YYYY-MM-DD" strings and all date maths is done in UTC so daylight saving never shifts a day. */
(function(root){
"use strict";
const DAY = 864e5;
const METRICS = ["hours","points","leads","opps","clients","revenue"];
const KPI_KEYS = ["leads","opps","clients","revenue"];

/* ---------- dates ---------- */
const isDate = s => typeof s==="string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s+"T00:00:00Z"));
const parse = s => Date.UTC(+s.slice(0,4), +s.slice(5,7)-1, +s.slice(8,10));
const fmt = ms => new Date(ms).toISOString().slice(0,10);
const addDays = (s,n) => fmt(parse(s) + n*DAY);
const diffDays = (a,b) => Math.round((parse(b)-parse(a))/DAY);
const dow = s => new Date(parse(s)).getUTCDay();                       // 0 = Sunday … 6 = Saturday
const monthStart = s => s.slice(0,7) + "-01";
const monthEnd = s => fmt(Date.UTC(+s.slice(0,4), +s.slice(5,7), 0));
const daysInMonth = s => +monthEnd(s).slice(8,10);
const addMonths = (s,n) => fmt(Date.UTC(+s.slice(0,4), +s.slice(5,7)-1+n, 1)); // first day of that month
const maxD = (a,b) => a>b ? a : b;
const minD = (a,b) => a<b ? a : b;

function partsIn(tz, now){
  const f = new Intl.DateTimeFormat("en-US", {timeZone:tz, hourCycle:"h23", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit"});
  const p = {}; f.formatToParts(now || new Date()).forEach(x => p[x.type] = x.value); return p;
}
/* Today's date in the team's time zone (not the computer's), so everyone agrees on when a day locks. */
function todayIn(tz, now){
  try { const p = partsIn(tz || "UTC", now); return `${p.year}-${p.month}-${p.day}`; }
  catch { return fmt((now || new Date()).getTime()); }
}
function secondsToMidnight(tz, now){
  try { const p = partsIn(tz || "UTC", now); return Math.max(0, 86400 - ((+p.hour % 24)*3600 + (+p.minute)*60 + (+p.second))); }
  catch { return 0; }
}

/* ---------- settings ---------- */
const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
const r2 = n => Math.round(n*100)/100;
function normSettings(s){
  s = s && typeof s==="object" ? s : {};
  const dowOk = v => Number.isInteger(v) && v>=0 && v<=6;
  return {
    product: String(s.product || ""),
    currency: String(s.currency || "BDT"),
    weekStartDow: dowOk(s.weekStartDow) ? s.weekStartDow : 6,
    weekendDows: Array.isArray(s.weekendDows) ? [...new Set(s.weekendDows.filter(dowOk))] : [5],
    countWeekend: s.countWeekend !== false,
    tasks: (Array.isArray(s.tasks) ? s.tasks : []).filter(t => t && t.id && t.name)
      .map(t => ({id:String(t.id), type:String(t.type || ""), name:String(t.name), pts:num(t.pts), active:t.active !== false})),
    roles: (Array.isArray(s.roles) ? s.roles : []).filter(r => r && r.id)
      .map(r => ({id:String(r.id), name:String(r.name || "Role"), tasks:(Array.isArray(r.tasks) ? r.tasks : []).map(String),
        weights:Object.fromEntries(METRICS.map(k => [k, num(r.weights && r.weights[k])]))}))
  };
}
const taskMap = st => new Map(st.tasks.map(t => [t.id, t]));
const roleOf = (st, id) => st.roles.find(r => r.id === id) || null;

/* ---------- one day ---------- */
const filled = slots => (Array.isArray(slots) ? slots : []).filter(v => v !== null && v !== undefined && v !== "");
const dayHours = e => e ? filled(e.slots).length : 0;                    // each filled slot is one hour
const dayPoints = (e, tm) => e ? r2(filled(e.slots).reduce((s,id) => s + (tm.get(id) ? tm.get(id).pts : 0), 0)) : 0;
const counts = (day, st) => st.countWeekend || !st.weekendDows.includes(dow(day));

function totals(entries, from, to, st, tm){
  let hours = 0, points = 0;
  for(const e of entries){
    if(e.day >= from && e.day <= to && counts(e.day, st)){ hours += dayHours(e); points += dayPoints(e, tm); }
  }
  return {hours, points:r2(points)};
}

/* ---------- weeks and months ---------- */
const weekStartOf = (day, st) => addDays(day, -((dow(day) - st.weekStartDow + 7) % 7));
/* Week number as in the original sheet: weeks counted from the one that holds 1 January.
   A week that crosses New Year takes the new year's number (week 1). */
function weekNo(ws, st){
  const last = addDays(ws, 6), first = weekStartOf(last.slice(0,4) + "-01-01", st);
  return {no: Math.floor(diffDays(first, last)/7) + 1, year: +last.slice(0,4)};
}
/* A week's results count in the month that holds most of its days (its 4th day). */
const monthOfWeek = ws => addDays(ws, 3).slice(0,7);
function workingDays(from, to, st){
  let n = 0; for(let d = from; d <= to; d = addDays(d,1)) if(!st.weekendDows.includes(dow(d))) n++;
  return n;
}
/* Months between two dates as a fraction, e.g. 15 Oct – 30 Nov = 17/31 + 1 */
function monthsBetween(from, to){
  let m = 0; for(let ms = monthStart(from); ms <= to; ms = addMonths(ms,1)){
    m += (diffDays(maxD(from, ms), minD(to, monthEnd(ms))) + 1) / daysInMonth(ms);
  } return m;
}
function kpiFor(kpis, test){
  const o = {leads:0, opps:0, clients:0, revenue:0, weeks:0};
  for(const k of kpis){ if(test(k)){ KPI_KEYS.forEach(x => o[x] += num(k[x])); o.weeks++; } }
  o.revenue = r2(o.revenue); return o;
}

/* ---------- status against a target ---------- */
/* While a period is running, compare with where you should be by now (working days so far). */
function paceOf(actual, target, elapsedWD, totalWD){
  if(!(target > 0)) return {key:"none", pct:null};
  const pct = actual/target;
  if(actual >= target) return {key:"met", pct};
  if(elapsedWD <= 0 || totalWD <= 0) return {key:"early", pct};
  const r = actual / (target * elapsedWD / totalWD);
  return {key: r >= 1 ? "onpace" : r >= 0.8 ? "near" : "behind", pct, expected: r2(target*elapsedWD/totalWD)};
}
/* When a period is over: met (100%+), near (80%+) or below. */
function finalOf(actual, target){
  if(!(target > 0)) return {key:"none", pct:null};
  const pct = actual/target; return {key: pct >= 1 ? "met" : pct >= 0.8 ? "near" : "below", pct};
}

function startOf(sheet, entries, fallback){
  const t = sheet.targets || {};
  if(isDate(t.start)) return t.start;
  let first = null; for(const e of entries) if(dayHours(e) && (!first || e.day < first)) first = e.day;
  return first || fallback;
}

/* ---------- dashboard row for one person ---------- */
function dashboard(sheet, entries, kpis, st, today){
  const tm = taskMap(st), T = sheet.targets || {}, start = startOf(sheet, entries, today);
  const ws0 = weekStartOf(today, st), we0 = addDays(ws0, 6);
  const week = totals(entries, ws0, we0, st, tm), lastWeek = totals(entries, addDays(ws0,-7), addDays(ws0,-1), st, tm);
  const wTo = addDays(ws0, -1);                       // averages use completed weeks only
  const avgWeek = start <= wTo ? r2(totals(entries, start, wTo, st, tm).hours / ((diffDays(start, wTo)+1)/7)) : null;
  const ms0 = monthStart(today), me0 = monthEnd(today), lms = addMonths(ms0, -1);
  const month = totals(entries, ms0, me0, st, tm), lastMonth = totals(entries, lms, monthEnd(lms), st, tm);
  const mTo = addDays(ms0, -1);                       // and completed months only
  const avgMonth = start <= mTo ? r2(totals(entries, start, mTo, st, tm).points / monthsBetween(start, mTo)) : null;
  const ytd = totals(entries, today.slice(0,4) + "-01-01", today, st, tm);
  const mk = ms0.slice(0,7), kpiMonth = kpiFor(kpis, k => monthOfWeek(k.week_start) === mk);
  return {
    start, weekStart:ws0, weekEnd:we0,
    weekHours:week.hours, lastWeekHours:lastWeek.hours, avgWeekHours:avgWeek, weekTarget:num(T.hours),
    weekStatus:paceOf(week.hours, num(T.hours), workingDays(ws0, today, st), workingDays(ws0, we0, st)),
    lastWeekStatus:finalOf(lastWeek.hours, num(T.hours)),
    monthPoints:month.points, lastMonthPoints:lastMonth.points, avgMonthPoints:avgMonth, monthTarget:num(T.points),
    monthStatus:paceOf(month.points, num(T.points), workingDays(ms0, today, st), workingDays(ms0, me0, st)),
    lastMonthStatus:finalOf(lastMonth.points, num(T.points)),
    ytdHours:ytd.hours, ytdPoints:ytd.points, todayHours:dayHours(entries.find(e => e.day === today)),
    kpiMonth, kpiTargets:{leads:num(T.leads), opps:num(T.opps), clients:num(T.clients), revenue:num(T.revenue)}
  };
}

/* ---------- composite score per month ----------
   score = Σ weight × (actual ÷ target) over the six metrics, using the person's own targets and their job role's weights.
   Hours compare average hours per week with the weekly target. The month the person starts in is pro-rated.
   A metric with no target adds nothing. Quarter and year scores average the completed months. */
function performance(sheet, entries, kpis, st, year, today){
  const tm = taskMap(st), T = sheet.targets || {}, role = roleOf(st, sheet.role_id);
  const W = role ? role.weights : {hours:0, points:0, leads:0, opps:0, clients:0, revenue:0};
  const start = startOf(sheet, entries, `${year}-01-01`);
  const months = [];
  for(let m = 1; m <= 12; m++){
    const ms = `${year}-${String(m).padStart(2,"0")}-01`, me = monthEnd(ms), dim = daysInMonth(ms), mk = ms.slice(0,7);
    if(ms > today){ months.push({m, state:"future"}); continue; }
    const k = kpiFor(kpis, x => monthOfWeek(x.week_start) === mk);
    if(start > me){ const t = totals(entries, ms, me, st, tm); months.push({m, state:"before", hours:t.hours, points:t.points, ...k}); continue; }
    const from = maxD(ms, start), covered = diffDays(from, me) + 1, frac = covered/dim;
    const t = totals(entries, from, me, st, tm);
    // hours stay exact here; they are rounded only for display
    const actual = {hours:t.hours/(covered/7), points:t.points, leads:k.leads, opps:k.opps, clients:k.clients, revenue:k.revenue};
    const target = {hours:num(T.hours), points:num(T.points)*frac, leads:num(T.leads)*frac, opps:num(T.opps)*frac, clients:num(T.clients)*frac, revenue:num(T.revenue)*frac};
    const ratio = {}; let score = 0;
    METRICS.forEach(x => { ratio[x] = target[x] > 0 ? actual[x]/target[x] : 0; score += (W[x]/100) * ratio[x]; });
    months.push({m, state: today <= me ? "current" : "done", from, hours:t.hours, avgWeekly:r2(actual.hours), points:t.points,
      leads:k.leads, opps:k.opps, clients:k.clients, revenue:k.revenue, target, ratio, score});
  }
  const sum = (list, key) => r2(list.reduce((s,x) => s + (num(x[key])), 0));
  const roll = list => {
    const scored = list.filter(x => x.state === "done" || x.state === "current"), done = list.filter(x => x.state === "done");
    const coveredDays = scored.reduce((s,x) => s + diffDays(x.from, monthEnd(x.from)) + 1, 0);
    return {hours:sum(scored,"hours"), avgWeekly: coveredDays ? r2(sum(scored,"hours")/(coveredDays/7)) : null,
      points:sum(scored,"points"), leads:sum(scored,"leads"), opps:sum(scored,"opps"), clients:sum(scored,"clients"), revenue:sum(scored,"revenue"),
      score: done.length ? done.reduce((s,x) => s + x.score, 0)/done.length : null, months:done.length};
  };
  return {start, role, weights:W, months, quarters:[0,1,2,3].map(q => roll(months.slice(q*3, q*3+3))), year:roll(months)};
}

/* ---------- checks shown to admins ---------- */
function warnings(st, sheets){
  const out = [];
  st.roles.forEach(r => {
    const total = METRICS.reduce((s,k) => s + r.weights[k], 0);
    if(Math.abs(total - 100) > 0.01) out.push(`Job role "${r.name}": weightages add up to ${r2(total)}%, not 100%.`);
    if(!r.tasks.length) out.push(`Job role "${r.name}" has no tasks, so its dropdowns will be empty.`);
  });
  sheets.filter(s => s.kind === "work" && !s.archived).forEach(s => {
    const r = roleOf(st, s.role_id), T = s.targets || {};
    if(!r){ out.push(`Sheet "${s.name}" has no job role, so it has no tasks to choose from and no score.`); return; }
    const missing = METRICS.filter(k => r.weights[k] > 0 && !(num(T[k]) > 0));
    if(missing.length) out.push(`Sheet "${s.name}": ${r.name} gives weight to ${missing.join(", ")} but the sheet has no target for ${missing.length > 1 ? "them" : "it"}, so that part of the score is always 0.`);
  });
  return out;
}

/* ---------- starting template (taken from the DSL Team Operation Sheet) ---------- */
const TEMPLATE_TASKS = [
  ["t01","Lead Generation","Manual Prospecting - Collect 10 leads",1],["t02","Lead Generation","Tool Prospecting - Collect 30 leads",1],
  ["t03","Cold Client Calling","Make 8 Cold Calls",1],["t04","Cold Client Calling","Follow-up Calls - Make 8 Calls",1],
  ["t05","Cold Client Emailing","Send 8 Cold Emails",1],["t06","Cold Client Emailing","Follow-up Emails - Send 8 Emails",1],
  ["t07","Cold Client Emailing","Send 2 Cold Intelligent Emails",2],["t08","Cold Client Visit","Trade Show / Event Participation",3],
  ["t09","Cold Client Visit","Cold Office Visit (Client Meeting)",2],["t10","Cold Client Visit","Cold Office Visit (Warm Up)",1],
  ["t11","Client Meeting","Requirement Collection Meeting",4],["t12","Client Meeting","Demo & Presentation Session",10],
  ["t13","Proposal Preparation","Full Proposal Preparation",5],["t14","Proposal Preparation","Proposal (1/2) Preparation",2],
  ["t15","Proposal Preparation","Proposal (2/2) Preparation",2],["t16","Proposal Preparation","Proposal (1/3) Preparation",2],
  ["t17","Proposal Preparation","Proposal (2/3) Preparation",2],["t18","Proposal Preparation","Proposal (3/3) Preparation",2],
  ["t19","Proposal Preparation","Tender (1/10) Preparation",3],["t20","Proposal Preparation","Tender (2/10) Preparation",3],
  ["t21","Proposal Preparation","Tender (3/10) Preparation",3],["t22","Proposal Preparation","Tender (4/10) Preparation",3],
  ["t23","Proposal Preparation","Tender (5/10) Preparation",3],["t24","Proposal Preparation","Tender (6/10) Preparation",3],
  ["t25","Proposal Preparation","Tender (7/10) Preparation",3],["t26","Proposal Preparation","Tender (8/10) Preparation",3],
  ["t27","Proposal Preparation","Tender (9/10) Preparation",3],["t28","Proposal Preparation","Tender (10/10) Preparation",3],
  ["t29","Sales","Client Work Order Receiving",100],["t30","Planning & Reporting","Daily Planning / CRM Reporting",1],
  ["t31","Office Meeting","Team Meeting",1],["t32","Office Meeting","Internal Office Meeting",1],
  ["t33","Commercial","Client Invoice Preparation",2],["t34","Commercial","Tender Related Outdoor Activities",1],
  ["t35","Product Management","Market Research",5],["t36","Product Management","Product Demo Preparation",5],
  ["t37","Product Management","Requirement Analysis Documentation",1],["t38","Product Management","Product Content Development",2],
  ["t39","Product Management","GTM Material Development",2],["t40","Special Assignment","Special Task by Team Leader",1],
  ["t41","Special Assignment","Team Coordination & Reporting",1],["t42","Special Assignment","Monthly Report Preparation",1],
  ["t43","Special Assignment","Monthly Presentation",1]];
const range = (a,b) => Array.from({length:b-a+1}, (_,i) => "t" + String(a+i).padStart(2,"0"));
const SALES_CORE = [...range(1,34), "t36", "t40", "t41", "t42", "t43"];
function salesTemplate(){
  return normSettings({
    currency:"BDT", weekStartDow:6, weekendDows:[5], countWeekend:true,
    tasks: TEMPLATE_TASKS.map(([id,type,name,pts]) => ({id, type, name, pts, active:true})),
    roles: [
      {id:"r-national", name:"National Sales (Tender)", tasks:SALES_CORE, weights:{hours:20, points:5, leads:15, opps:10, clients:10, revenue:40}},
      {id:"r-intl-product", name:"International Sales (Product)", tasks:range(1,43), weights:{hours:20, points:5, leads:10, opps:15, clients:10, revenue:40}},
      {id:"r-intl-ai", name:"International Sales (AI)", tasks:SALES_CORE, weights:{hours:20, points:5, leads:20, opps:15, clients:10, revenue:30}},
      {id:"r-marketing", name:"Marketing", tasks:["t01","t02","t05","t06","t07","t08","t12","t30","t31","t32","t35","t36","t38","t39","t40","t41","t42","t43"],
        weights:{hours:20, points:10, leads:70, opps:0, clients:0, revenue:0}}]
  });
}
function blankTemplate(){
  return normSettings({tasks:[{id:"t01", type:"General", name:"Work task", pts:1, active:true}],
    roles:[{id:"r-team", name:"Team member", tasks:["t01"], weights:{hours:50, points:50, leads:0, opps:0, clients:0, revenue:0}}]});
}

const api = {METRICS, KPI_KEYS, isDate, addDays, diffDays, dow, monthStart, monthEnd, daysInMonth, addMonths, todayIn, secondsToMidnight,
  normSettings, taskMap, roleOf, filled, dayHours, dayPoints, counts, totals, weekStartOf, weekNo, monthOfWeek, workingDays, monthsBetween,
  kpiFor, paceOf, finalOf, dashboard, performance, warnings, salesTemplate, blankTemplate, r2};
if(typeof module === "object" && module.exports) module.exports = api; else root.TeamCalc = api;
})(typeof self !== "undefined" ? self : this);
