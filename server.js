import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";

// ─── Data Stores ───
const reports = [], officers = [], auditLogs = [];
const stations = [
  { id: 1, name: "PND Headquarters" }, { id: 2, name: "Balbala Station" },
  { id: 3, name: "Ambouli Station" }, { id: 4, name: "Arta Station" },
  { id: 5, name: "Ali Sabieh Station" }, { id: 6, name: "Dikhil Station" },
  { id: 7, name: "Tadjourah Station" }, { id: 8, name: "Obock Station" },
  { id: 9, name: "Ali Adde Station" }, { id: 10, name: "Holhol Station" },
];
let rid = 1, oid = 1, aid = 1;
const genRid = () => { const d = new Date().toISOString().slice(0,10).replace(/-/g,""); return `RPT-${d}-${String(reports.length+1).padStart(4,"0")}`; };
const genAuth = () => Math.floor(100000 + Math.random() * 900000).toString();
const genBadge = () => "PND-" + Math.floor(10000 + Math.random() * 90000);

// ─── tRPC ───
const t = initTRPC.create({ transformer: superjson });
const p = t.procedure;
const appRouter = t.router({
  report: t.router({
    list: p.input(z.object({ search: z.string().optional(), status: z.string().optional(), severity: z.string().optional(), limit: z.number().default(50), offset: z.number().default(0) }).optional()).query(({ input }) => {
      let r = [...reports].sort((a, b) => b.createdAt - a.createdAt);
      if (input?.status) r = r.filter(x => x.status === input.status);
      if (input?.severity) r = r.filter(x => x.severity === input.severity);
      if (input?.search) { const q = input.search.toLowerCase(); r = r.filter(x => x.location.toLowerCase().includes(q) || x.reportId.toLowerCase().includes(q)); }
      return { reports: r.slice(input?.offset || 0, (input?.offset || 0) + (input?.limit || 50)), total: r.length };
    }),
    getById: p.input(z.object({ id: z.number() })).query(({ input }) => reports.find(x => x.id === input.id) || null),
    updateStatus: p.input(z.object({ id: z.number(), status: z.string() })).mutation(({ input }) => { const r = reports.find(x => x.id === input.id); if (r) { r.status = input.status; r.updatedAt = Date.now(); } return input; }),
    delete: p.input(z.object({ id: z.number() })).mutation(({ input }) => { const i = reports.findIndex(x => x.id === input.id); if (i >= 0) reports.splice(i, 1); return { success: true }; }),
    stats: p.query(() => { const bs = {}, bv = {}; reports.forEach(r => { bs[r.status] = (bs[r.status] || 0) + 1; bv[r.severity] = (bv[r.severity] || 0) + 1; }); const tdy = new Date().toISOString().split("T")[0]; return { total: reports.length, today: reports.filter(r => r.accidentDate === tdy).length, byStatus: Object.entries(bs).map(([s, c]) => ({ status: s, count: c })), bySeverity: Object.entries(bv).map(([s, c]) => ({ severity: s, count: c })) }; }),
  }),
  officer: t.router({
    list: p.input(z.object({ search: z.string().optional(), status: z.string().optional() }).optional()).query(({ input }) => { let r = [...officers].sort((a, b) => b.createdAt - a.createdAt); if (input?.status) r = r.filter(x => x.status === input.status); if (input?.search) { const q = input.search.toLowerCase(); r = r.filter(x => x.firstName.toLowerCase().includes(q) || x.lastName.toLowerCase().includes(q) || x.badgeNumber.toLowerCase().includes(q)); } return { officers: r, total: r.length }; }),
    create: p.input(z.object({ firstName: z.string(), lastName: z.string(), rank: z.string().default("constable"), stationId: z.number().default(1), phone: z.string().optional(), email: z.string().optional() })).mutation(({ input }) => { const o = { id: oid++, badgeNumber: genBadge(), authCode: genAuth(), firstName: input.firstName, lastName: input.lastName, rank: input.rank, stationId: input.stationId, phone: input.phone || null, email: input.email || null, status: "active", joinDate: null, createdAt: Date.now() }; officers.push(o); return o; }),
    update: p.input(z.object({ id: z.number(), firstName: z.string().optional(), lastName: z.string().optional(), rank: z.string().optional(), status: z.string().optional() })).mutation(({ input }) => { const o = officers.find(x => x.id === input.id); if (o) { const { id, ...u } = input; Object.assign(o, u); } return input; }),
    delete: p.input(z.object({ id: z.number() })).mutation(({ input }) => { const i = officers.findIndex(x => x.id === input.id); if (i >= 0) officers.splice(i, 1); return { success: true }; }),
    stations: p.query(() => stations),
    stats: p.query(() => ({ total: officers.length, active: officers.filter(o => o.status === "active").length, onLeave: officers.filter(o => o.status === "on_leave").length, suspended: officers.filter(o => o.status === "suspended").length })),
  }),
  analytics: t.router({
    executive: p.query(() => { const lm = {}; reports.forEach(r => { lm[r.location] = (lm[r.location] || 0) + 1; }); return { totalReports: reports.length, submitted: reports.filter(r => r.status === "submitted").length, approved: reports.filter(r => r.status === "approved").length, pendingReview: reports.filter(r => r.status === "under_review").length, activeOfficers: officers.filter(o => o.status === "active").length, hotspots: Object.entries(lm).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([l, c]) => ({ location: l, count: c })) }; }),
    timeSeries: p.query(() => { const dm = {}; reports.forEach(r => { dm[r.accidentDate] = (dm[r.accidentDate] || 0) + 1; }); return Object.entries(dm).map(([p, c]) => ({ period: p, count: c })).sort((a, b) => a.period.localeCompare(b.period)).slice(-30); }),
    byType: p.query(() => { const m = {}; reports.forEach(r => { if (r.accidentType) m[r.accidentType] = (m[r.accidentType] || 0) + 1; }); return Object.entries(m).map(([t, c]) => ({ accident_type: t, count: c })); }),
    byWeather: p.query(() => { const m = {}; reports.forEach(r => { if (r.weather) m[r.weather] = (m[r.weather] || 0) + 1; }); return Object.entries(m).map(([w, c]) => ({ weather: w, count: c })); }),
    byRoadCondition: p.query(() => { const m = {}; reports.forEach(r => { if (r.roadCondition) m[r.roadCondition] = (m[r.roadCondition] || 0) + 1; }); return Object.entries(m).map(([r, c]) => ({ roadCondition: r, count: c })); }),
  }),
  audit: t.router({
    list: p.input(z.object({ search: z.string().optional(), limit: z.number().default(50), offset: z.number().default(0) }).optional()).query(({ input }) => { let r = [...auditLogs].sort((a, b) => b.createdAt - a.createdAt); if (input?.search) { const q = input.search.toLowerCase(); r = r.filter(x => x.action?.toLowerCase().includes(q) || x.details?.toLowerCase().includes(q)); } return { logs: r.slice(input?.offset || 0, (input?.offset || 0) + (input?.limit || 50)), total: r.length }; }),
  }),
  station: t.router({ list: p.query(() => stations) }),
});

// ─── Hono App ───
const app = new Hono();
app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], allowHeaders: ["*"] }));
app.get("/api/officers", (c) => c.json({ officers: officers.filter(o => o.status === "active").map(o => ({ id: o.id, badgeNumber: o.badgeNumber, firstName: o.firstName, lastName: o.lastName, rank: o.rank, authCode: o.authCode, stationName: stations.find(s => s.id === o.stationId)?.name || "PND" })) }));
app.post("/api/auth/login", async (c) => { const body = await c.req.json().catch(() => ({})); const officer = officers.find(o => o.badgeNumber === body.badgeNumber && o.authCode === body.authCode && o.status === "active"); if (!officer) return c.json({ success: false, error: "Invalid" }, 401); auditLogs.push({ id: aid++, userId: officer.id, action: "officer_login", resource: "officer", resourceId: String(officer.id), details: `${officer.firstName} ${officer.lastName} logged in`, ipAddress: c.req.header("x-forwarded-for") || "unknown", createdAt: Date.now() }); return c.json({ success: true, officer: { id: officer.id, badgeNumber: officer.badgeNumber, firstName: officer.firstName, lastName: officer.lastName, rank: officer.rank, stationName: stations.find(s => s.id === officer.stationId)?.name || "PND" } }); });
app.post("/api/reports", async (c) => { const body = await c.req.json().catch(() => ({})); const r = { id: rid++, reportId: genRid(), location: body.location || "Unknown", latitude: body.latitude || null, longitude: body.longitude || null, accidentDate: body.accidentDate || new Date().toISOString().split("T")[0], accidentTime: body.accidentTime || new Date().toLocaleTimeString("en-US", { hour12: false }), severity: body.severity || "moderate", status: "submitted", weather: body.weather || null, roadCondition: body.roadCondition || null, accidentType: body.accidentType || null, description: body.description || null, officerId: body.officerId || null, stationId: body.stationId || null, createdAt: Date.now() }; reports.push(r); auditLogs.push({ id: aid++, userId: body.officerId || null, action: "create_report", resource: "report", resourceId: String(r.id), details: `Report ${r.reportId} from mobile`, ipAddress: c.req.header("x-forwarded-for") || "unknown", createdAt: Date.now() }); return c.json({ success: true, report: r }); });
app.use("/api/trpc/*", async (c) => fetchRequestHandler({ endpoint: "/api/trpc", req: c.req.raw, router: appRouter, createContext: async () => ({}) }));

// ─── Static files ───
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PND Command Center</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:'Inter',system-ui,sans-serif}
body{background:#0A1628;color:#F1F5F9}
.glass{background:rgba(15,30,60,0.7);backdrop-filter:blur(12px);border:1px solid rgba(60,130,246,0.15);border-radius:12px}
.nav{display:flex;align-items:center;gap:12px;padding:10px 16px;border-radius:8px;color:#94A3B8;font-size:14px;font-weight:500;cursor:pointer;text-decoration:none;transition:all .2s;border-left:3px solid transparent}
.nav:hover{background:rgba(60,130,246,0.1);color:#F1F5F9}
.nav.active{background:rgba(60,130,246,0.15);color:#3B82F6;border-left-color:#3B82F6}
.btn{background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);border-radius:8px;color:#60A5FA;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer}
.btn:hover{background:rgba(59,130,246,0.25)}
.btn-primary{background:#3B82F6;color:white;border:none}
.btn-primary:hover{background:#2563EB}
input,select{background:rgba(15,30,60,0.5);border:1px solid rgba(60,130,246,0.2);border-radius:8px;color:#F1F5F9;padding:8px 12px;outline:none}
input:focus{border-color:rgba(60,130,246,0.5)}
table{width:100%;border-collapse:collapse}th{text-align:left;padding:12px 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#64748B;border-bottom:1px solid rgba(60,130,246,0.15)}
td{padding:12px 16px;font-size:13px;color:#F1F5F9;border-bottom:1px solid rgba(60,130,246,0.08)}
.badge{display:inline-flex;align-items:center;padding:2px 10px;border-radius:9999px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em}
.s-fatal{background:rgba(239,68,68,0.2);color:#EF4444}
.s-serious{background:rgba(249,115,22,0.2);color:#FB923C}
.s-moderate{background:rgba(245,158,11,0.2);color:#F59E0B}
.s-minor{background:rgba(16,185,129,0.2);color:#10B981}
.st-submitted{background:rgba(59,130,246,0.2);color:#60A5FA}
.st-under_review{background:rgba(245,158,11,0.2);color:#F59E0B}
.st-approved{background:rgba(16,185,129,0.2);color:#10B981}
.st-rejected{background:rgba(239,68,68,0.2);color:#EF4444}
.live{width:8px;height:8px;border-radius:50%;background:#10B981;position:relative}
.live::after{content:'';position:absolute;inset:-3px;border-radius:50%;border:2px solid #10B981;animation:ping 1.5s ease-out infinite}
@keyframes ping{0%{transform:scale(1);opacity:1}100%{transform:scale(1.8);opacity:0}}
.modal{position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:16px;z-index:50}
.scroll::-webkit-scrollbar{width:6px}
.scroll::-webkit-scrollbar-track{background:transparent}
.scroll::-webkit-scrollbar-thumb{background:rgba(60,130,246,0.2);border-radius:3px}
</style>
</head>
<body>
<div id="app"></div>
<script type="module">
const { createElement: h, useState, useEffect } = React;
const e = React.createElement;

// ─── Icons (SVG components) ───
const Icons = {
  dashboard: () => e('svg',{width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2},e('rect',{x:3,y:3,width:7,height:7}),e('rect',{x:14,y:3,width:7,height:7}),e('rect',{x:14,y:14,width:7,height:7}),e('rect',{x:3,y:14,width:7,height:7})),
  reports: () => e('svg',{width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2},e('path',{d:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'}),e('polyline',{points:'14 2 14 8 20 8'})),
  daily: () => e('svg',{width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2},e('rect',{x:3,y:4,width:18,height:18,rx:2}),e('line',{x1:16,y1:2,x2:16,y2:6}),e('line',{x1:8,y1:2,x2:8,y2:6}),e('line',{x1:3,y1:10,x2:21,y2:10})),
  weekly: () => e('svg',{width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2},e('rect',{x:3,y:4,width:18,height:18,rx:2}),e('line',{x1:16,y1:2,x2:16,y2:6}),e('line',{x1:8,y1:2,x2:8,y2:6}),e('line',{x1:3,y1:10,x2:21,y2:10})),
  monthly: () => e('svg',{width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2},e('rect',{x:3,y:4,width:18,height:18,rx:2}),e('line',{x1:16,y1:2,x2:16,y2:6}),e('line',{x1:8,y1:2,x2:8,y2:6}),e('line',{x1:3,y1:10,x2:21,y2:10})),
  officers: () => e('svg',{width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2},e('path',{d:'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'})),
  analytics: () => e('svg',{width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2},e('line',{x1:18,y1:20,x2:18,y2:10}),e('line',{x1:12,y1:20,x2:12,y2:4}),e('line',{x1:6,y1:20,x2:6,y2:14})),
  audit: () => e('svg',{width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2},e('path',{d:'M9 11l3 3L22 4'}),e('path',{d:'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'})),
  settings: () => e('svg',{width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2},e('circle',{cx:12,cy:12,r:3}),e('path',{d:'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z'})),
  menu: () => e('svg',{width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2},e('line',{x1:3,y1:12,x2:21,y2:12}),e('line',{x1:3,y1:6,x2:21,y2:6}),e('line',{x1:3,y1:18,x2:21,y2:18})),
  search: () => e('svg',{width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2},e('circle',{cx:11,cy:11,r:8}),e('line',{x1:21,y1:21,x2:16.65,y2:16.65})),
  eye: () => e('svg',{width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2},e('path',{d:'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z'}),e('circle',{cx:12,cy:12,r:3})),
  trash: () => e('svg',{width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2},e('polyline',{points:'3 6 5 6 21 6'}),e('path',{d:'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'})),
  plus: () => e('svg',{width:20,height:20,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2},e('line',{x1:12,y1:5,x2:12,y2:19}),e('line',{x1:5,y1:12,x2:19,y2:12})),
  userPlus: () => e('svg',{width:20,height:20,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2},e('path',{d:'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2'}),e('circle',{cx:8.5,cy:7,r:4}),e('line',{x1:20,y1:8,x2:20,y2:14}),e('line',{x1:23,y1:11,x2:17,y2:11})),
  copy: () => e('svg',{width:14,height:14,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2},e('rect',{x:9,y:9,width:13,height:13,rx:2}),e('path',{d:'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'})),
  check: () => e('svg',{width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:3},e('polyline',{points:'20 6 9 17 4 12'})),
  edit: () => e('svg',{width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2},e('path',{d:'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7'})),
  close: () => e('svg',{width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2},e('line',{x1:18,y1:6,x2:6,y2:18}),e('line',{x1:6,y1:6,x2:18,y2:18})),
};

// ─── Data ───
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'reports', label: 'Accident Reports', icon: 'reports' },
  { id: 'daily', label: 'Daily Report', icon: 'daily' },
  { id: 'weekly', label: 'Weekly Report', icon: 'weekly' },
  { id: 'monthly', label: 'Monthly Report', icon: 'monthly' },
  { id: 'officers', label: 'Officers', icon: 'officers' },
  { id: 'analytics', label: 'Analytics', icon: 'analytics' },
  { id: 'audit', label: 'Audit Log', icon: 'audit' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];
const SEV_COLORS = { fatal: '#EF4444', serious: '#FB923C', moderate: '#F59E0B', minor: '#10B981' };
const STATUSES = ['submitted', 'under_review', 'approved', 'rejected', 'draft'];
const SEVERITIES = ['fatal', 'serious', 'moderate', 'minor'];
const RANKS = ['constable', 'corporal', 'sergeant', 'inspector', 'chief_inspector', 'superintendent', 'chief_superintendent', 'commissioner', 'brigadier', 'colonel', 'general'];
const STATIONS = [
  { id: 1, name: 'PND Headquarters' }, { id: 2, name: 'Balbala Station' },
  { id: 3, name: 'Ambouli Station' }, { id: 4, name: 'Arta Station' },
  { id: 5, name: 'Ali Sabieh Station' }, { id: 6, name: 'Dikhil Station' },
  { id: 7, name: 'Tadjourah Station' }, { id: 8, name: 'Obock Station' },
  { id: 9, name: 'Ali Adde Station' }, { id: 10, name: 'Holhol Station' },
];

// ─── State ───
let _reports = [], _officers = [], _auditLogs = [];
let currentPage = 'dashboard';

// ─── API ───
const API = {
  async get(path) { const r = await fetch('/api/trpc/' + path); return r.json().then(d => d.result.data); },
  async post(path, body) { const r = await fetch('/api/trpc/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ json: body }) }); return r.json().then(d => d.result.data); },
};

// ─── Components ───
function Sidebar({ page, onPageChange, collapsed, onToggle }) {
  return e('aside', { style: { width: collapsed ? 64 : 250, background: '#080F1E', borderRight: '1px solid rgba(60,130,246,0.12)', display: 'flex', flexDirection: 'column', height: '100vh', position: 'fixed', left: 0, top: 0, zIndex: 30, transition: 'width 0.3s' } },
    e('div', { style: { display: 'flex', alignItems: 'center', gap: 12, padding: '0 12px', height: 64, borderBottom: '1px solid rgba(60,130,246,0.12)', flexShrink: 0 } },
      e('img', { src: '/logo.jpg', style: { width: 40, height: 40, borderRadius: 8, objectFit: 'contain', flexShrink: 0 } }),
      !collapsed && e('div', { style: { overflow: 'hidden', minWidth: 0 } },
        e('p', { style: { fontSize: 11, fontWeight: 'bold', color: '#F1F5F9', letterSpacing: '0.05em', whiteSpace: 'nowrap' } }, 'PND'),
        e('p', { style: { fontSize: 9, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' } }, 'Brigade des Accidents')
      )
    ),
    e('nav', { style: { flex: 1, padding: '12px 8px', overflowY: 'auto' } },
      NAV_ITEMS.map(item => {
        const Icon = Icons[item.icon];
        const isActive = page === item.id;
        return e('a', {
          key: item.id,
          className: 'nav ' + (isActive ? 'active' : ''),
          style: { justifyContent: collapsed ? 'center' : undefined },
          onClick: (e) => { e.preventDefault(); onPageChange(item.id); },
          href: '#',
        }, e(Icon), !collapsed && item.label);
      })
    ),
    e('div', { style: { padding: '0 8px 12px' } },
      e('a', { className: 'nav', style: { justifyContent: collapsed ? 'center' : undefined }, onClick: (e) => { e.preventDefault(); onToggle(); }, href: '#' },
        e(Icons.menu), !collapsed && 'Collapse'
      )
    )
  );
}

function Header() {
  const [clock, setClock] = useState('');
  useEffect(() => { const t = () => setClock(new Date().toLocaleTimeString('en-US', { hour12: false })); t(); const i = setInterval(t, 1000); return () => clearInterval(i); }, []);
  return e('header', { style: { background: '#0D1B30', borderBottom: '2px solid rgba(60,130,246,0.2)', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', position: 'fixed', top: 0, right: 0, zIndex: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.3)' } },
    e('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
      e('img', { src: '/logo.jpg', style: { width: 32, height: 32, borderRadius: 4, objectFit: 'contain' } }),
      e('div', null,
        e('p', { style: { fontSize: 13, fontWeight: 'bold', color: '#F1F5F9', letterSpacing: '0.03em' } }, 'POLICE NATIONALE DE DJIBOUTI'),
        e('p', { style: { fontSize: 10, color: '#3B82F6', letterSpacing: '0.15em', textTransform: 'uppercase' } }, 'Brigade des Accidents \u2014 Command Center')
      )
    ),
    e('div', { style: { display: 'flex', alignItems: 'center', gap: 20 } },
      e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        e('div', { className: 'live' }),
        e('span', { style: { fontSize: 11, fontWeight: 'bold', color: '#10B981', letterSpacing: '0.05em' } }, 'LIVE')
      ),
      e('span', { style: { fontFamily: 'monospace', fontSize: 18, fontWeight: 'bold', color: '#60A5FA' } }, clock)
    )
  );
}

function StatCard({ label, value, sub, color, delay }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), delay); return () => clearTimeout(t); }, [delay]);
  return e('div', { className: 'glass', style: { padding: 20, opacity: mounted ? 1 : 0, transform: mounted ? 'translateY(0)' : 'translateY(16px)', transition: 'all 0.5s' } },
    e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
      e('div', null,
        e('p', { style: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748B' } }, label),
        e('p', { style: { fontSize: 30, fontWeight: 'bold', marginTop: 8, color } }, value),
        sub && e('p', { style: { fontSize: 11, marginTop: 4, color: '#64748B' } }, sub)
      ),
      e('div', { style: { padding: 12, borderRadius: 8, background: color + '15' } },
        e('span', { style: { fontSize: 20, color } }, '\u2022')
      )
    )
  );
}

function DashboardPage() {
  const [stats, setStats] = useState({ total: 0, today: 0, byStatus: [], bySeverity: [] });
  const [officerStats, setOfficerStats] = useState({ active: 0, total: 0 });
  const [recent, setRecent] = useState([]);
  const [clock, setClock] = useState('');
  const [date, setDate] = useState('');

  useEffect(() => {
    const tick = () => { const n = new Date(); setClock(n.toLocaleTimeString('en-US', { hour12: false })); setDate(n.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })); };
    tick(); const iv = setInterval(tick, 1000); return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    API.get('report.stats').then(setStats);
    API.get('officer.stats').then(setOfficerStats);
    API.get('report.list?input={"json":{"limit":5,"offset":0}}').then(d => setRecent(d?.reports || []));
  }, []);

  const sc = (stats.byStatus || []).reduce((a, s) => { a[s.status] = s.count; return a; }, {});

  return e('div', null,
    e('div', { className: 'glass', style: { padding: 24, marginBottom: 24, position: 'relative', overflow: 'hidden' } },
      e('div', { style: { position: 'absolute', top: 0, right: 0, width: 256, height: 256, borderRadius: '50%', opacity: 0.05, background: 'radial-gradient(circle, #3B82F6, transparent)', transform: 'translate(30%, -30%)' } }),
      e('div', { style: { position: 'relative', zIndex: 1 } },
        e('p', { style: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.15em', color: '#64748B' } }, 'Police Nationale de Djibouti'),
        e('h1', { style: { fontSize: 24, fontWeight: 'bold', marginTop: 4, color: '#F1F5F9' } }, 'Command Center Dashboard'),
        e('p', { style: { fontSize: 14, marginTop: 4, color: '#94A3B8' } }, date + ' \u2014 ' + clock)
      )
    ),
    e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 } },
      e(StatCard, { label: 'Total Reports', value: stats.total, sub: (sc.submitted || 0) + ' pending review', color: '#3B82F6', delay: 0 }),
      e(StatCard, { label: "Today's Incidents", value: stats.today, sub: 'Last 24 hours', color: '#EF4444', delay: 100 }),
      e(StatCard, { label: 'Active Officers', value: officerStats.active, sub: officerStats.total + ' total registered', color: '#10B981', delay: 200 }),
      e(StatCard, { label: 'Under Review', value: sc.under_review || 0, sub: 'Awaiting approval', color: '#F59E0B', delay: 300 })
    ),
    e('div', { style: { display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 } },
      e('div', { className: 'glass', style: { padding: 20 } },
        e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 } },
          e('h2', { style: { fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#F1F5F9' } }, 'Recent Accident Reports'),
          e('a', { href: '#', className: 'nav', style: { fontSize: 11, color: '#3B82F6' }, onClick: (e) => { e.preventDefault(); currentPage = 'reports'; render(); } }, 'View All')
        ),
        recent.length === 0
          ? e('div', { style: { textAlign: 'center', padding: '32px 0' } }, e('p', { style: { color: '#64748B', fontSize: 14 } }, 'No reports yet. Officers will appear here when they submit.'))
          : e('div', null, recent.map(r => e('div', { key: r.id, style: { display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0', borderBottom: '1px solid rgba(60,130,246,0.08)' } },
            e('div', { style: { width: 8, height: 8, borderRadius: '50%', background: SEV_COLORS[r.severity] || '#94A3B8', flexShrink: 0 } }),
            e('div', { style: { flex: 1, minWidth: 0 } },
              e('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                e('span', { style: { fontSize: 11, fontFamily: 'monospace', fontWeight: 600, color: '#60A5FA' } }, '#' + r.reportId),
                e('span', { className: 'badge st-' + r.status }, r.status.replace('_', ' '))
              ),
              e('p', { style: { fontSize: 12, color: '#94A3B8', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.location)
            ),
            e('div', { style: { textAlign: 'right', flexShrink: 0 } },
              e('p', { style: { fontSize: 12, color: '#94A3B8' } }, r.accidentDate),
              e('p', { style: { fontSize: 10, color: '#64748B' } }, r.accidentTime)
            )
          )))
      ),
      e('div', null,
        e('div', { className: 'glass', style: { padding: 20, marginBottom: 16 } },
          e('h2', { style: { fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#F1F5F9', marginBottom: 16 } }, 'Severity Breakdown'),
          SEVERITIES.map(sev => {
            const c = (stats.bySeverity || []).find(s => s.severity === sev)?.count || 0;
            const t = stats.total || 1;
            const pct = Math.round((c / t) * 100);
            return e('div', { key: sev, style: { marginBottom: 12 } },
              e('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 } },
                e('span', { style: { color: '#94A3B8', textTransform: 'capitalize' } }, sev),
                e('span', { style: { fontWeight: 600, color: SEV_COLORS[sev] } }, c + ' (' + pct + '%)')
              ),
              e('div', { style: { height: 6, borderRadius: 3, background: 'rgba(60,130,246,0.1)', overflow: 'hidden' } },
                e('div', { style: { height: '100%', borderRadius: 3, width: pct + '%', background: SEV_COLORS[sev], transition: 'width 0.7s' } })
              )
            );
          })
        ),
        e('div', { className: 'glass', style: { padding: 20 } },
          e('h2', { style: { fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#F1F5F9', marginBottom: 12 } }, 'Quick Actions'),
          e('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            e('a', { href: '#', className: 'btn btn-primary', style: { textAlign: 'center', textDecoration: 'none' }, onClick: (e) => { e.preventDefault(); currentPage = 'officers'; render(); } }, 'Manage Officers'),
            e('a', { href: '#', className: 'btn', style: { textAlign: 'center', textDecoration: 'none' }, onClick: (e) => { e.preventDefault(); currentPage = 'reports'; render(); } }, 'Review Reports'),
            e('a', { href: '#', className: 'btn', style: { textAlign: 'center', textDecoration: 'none' }, onClick: (e) => { e.preventDefault(); currentPage = 'analytics'; render(); } }, 'View Analytics')
          )
        )
      )
    )
  );
}

function ReportsPage() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState(null);

  const load = () => {
    const input = { limit: 10, offset: page * 10 };
    if (search) input.search = search;
    if (status) input.status = status;
    if (severity) input.severity = severity;
    API.get('report.list?input=' + encodeURIComponent(JSON.stringify({ json: input }))).then(d => {
      setItems(d?.reports || []); setTotal(d?.total || 0);
    });
  };

  useEffect(() => { load(); }, [page, search, status, severity]);

  const updateStatus = (id, st) => {
    API.post('report.updateStatus', { id, status: st }).then(() => load());
  };

  const deleteReport = (id) => {
    if (!confirm('Delete this report?')) return;
    API.post('report.delete', { id }).then(() => load());
  };

  const totalPages = Math.ceil(total / 10);
  const hasFilters = search || status || severity;

  return e('div', null,
    e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 } },
      e('div', null,
        e('h1', { style: { fontSize: 20, fontWeight: 'bold', color: '#F1F5F9' } }, 'Accident Reports'),
        e('p', { style: { fontSize: 12, color: '#64748B', marginTop: 4 } }, 'Manage and review all accident reports from officers')
      ),
      e('span', { style: { fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 9999, background: 'rgba(59,130,246,0.15)', color: '#60A5FA' } }, total + ' Total')
    ),
    e('div', { className: 'glass', style: { padding: 16, marginBottom: 16 } },
      e('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' } },
        e('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 200 } },
          e(Icons.search),
          e('input', { type: 'text', placeholder: 'Search by location...', value: search, onChange: e => { setSearch(e.target.value); setPage(0); }, style: { flex: 1 } })
        ),
        e('select', { value: status, onChange: e => { setStatus(e.target.value); setPage(0); }, style: { fontSize: 12 } },
          e('option', { value: '' }, 'All Status'),
          ...STATUSES.map(s => e('option', { key: s, value: s }, s.replace('_', ' ')))
        ),
        e('select', { value: severity, onChange: e => { setSeverity(e.target.value); setPage(0); }, style: { fontSize: 12 } },
          e('option', { value: '' }, 'All Severity'),
          ...SEVERITIES.map(s => e('option', { key: s, value: s }, s))
        ),
        hasFilters && e('button', { className: 'btn', style: { padding: '4px 8px', fontSize: 11 }, onClick: () => { setSearch(''); setStatus(''); setSeverity(''); setPage(0); } }, 'Clear')
      )
    ),
    e('div', { className: 'glass', style: { overflow: 'hidden' } },
      e('table', null,
        e('thead', null, e('tr', null,
          e('th', null, 'Report ID'), e('th', null, 'Location'), e('th', null, 'Date/Time'),
          e('th', null, 'Severity'), e('th', null, 'Status'), e('th', null, 'Weather'), e('th', null, 'Actions')
        )),
        e('tbody', null, items.length === 0
          ? e('tr', null, e('td', { colSpan: 7, style: { textAlign: 'center', padding: 48 } },
            e('p', { style: { color: '#64748B' } }, items.length === 0 && !hasFilters ? 'No reports yet' : 'No matching reports')
          ))
          : items.map(r => e('tr', { key: r.id },
            e('td', null, e('span', { style: { fontSize: 11, fontFamily: 'monospace', fontWeight: 600, color: '#60A5FA' } }, '#' + r.reportId)),
            e('td', null, e('span', { style: { fontSize: 12 } }, r.location)),
            e('td', null, e('span', { style: { fontSize: 12 } }, r.accidentDate + ' ' + r.accidentTime)),
            e('td', null, e('span', { className: 'badge s-' + r.severity }, r.severity)),
            e('td', null, e('select', { value: r.status, onChange: e => updateStatus(r.id, e.target.value), style: { fontSize: 10, padding: '2px 6px' } },
              STATUSES.filter(Boolean).map(s => e('option', { key: s, value: s }, s.replace('_', ' ')))
            )),
            e('td', null, e('span', { style: { fontSize: 12 } }, r.weather || '\u2014')),
            e('td', null, e('div', { style: { display: 'flex', gap: 4 } },
              e('button', { className: 'btn', style: { padding: 4 }, onClick: () => setDetail(r) }, e(Icons.eye)),
              e('button', { className: 'btn', style: { padding: 4, color: '#EF4444', borderColor: 'rgba(239,68,68,0.3)' }, onClick: () => deleteReport(r.id) }, e(Icons.trash))
            ))
          ))
        )
      ),
      totalPages > 1 && e('div', { style: { display: 'flex', justifyContent: 'space-between', padding: 16, borderTop: '1px solid rgba(60,130,246,0.15)' } },
        e('span', { style: { fontSize: 12, color: '#64748B' } }, 'Page ' + (page + 1) + ' of ' + totalPages),
        e('div', { style: { display: 'flex', gap: 8 } },
          e('button', { className: 'btn', style: { padding: '4px 8px', fontSize: 11 }, onClick: () => setPage(p => Math.max(0, p - 1)), disabled: page === 0 }, 'Prev'),
          e('button', { className: 'btn', style: { padding: '4px 8px', fontSize: 11 }, onClick: () => setPage(p => Math.min(totalPages - 1, p + 1)), disabled: page >= totalPages - 1 }, 'Next')
        )
      )
    ),
    detail && e('div', { className: 'modal', onClick: () => setDetail(null) },
      e('div', { className: 'glass', style: { padding: 24, maxWidth: 600, width: '100%', maxHeight: '80vh', overflow: 'auto' }, onClick: e => e.stopPropagation() },
        e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 } },
          e('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            e('span', { style: { fontSize: 14, fontFamily: 'monospace', fontWeight: 'bold', color: '#60A5FA' } }, '#' + detail.reportId),
            e('span', { className: 'badge st-' + detail.status }, detail.status),
            e('span', { className: 'badge s-' + detail.severity }, detail.severity)
          ),
          e('button', { className: 'btn', style: { padding: 4 }, onClick: () => setDetail(null) }, e(Icons.close))
        ),
        e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 16 } },
          [{ l: 'Date', v: detail.accidentDate }, { l: 'Time', v: detail.accidentTime }, { l: 'Weather', v: detail.weather || 'N/A' }, { l: 'Road', v: detail.roadCondition || 'N/A' }].map((f, i) =>
            e('div', { key: i, style: { padding: 12, borderRadius: 8, background: 'rgba(60,130,246,0.05)' } },
              e('p', { style: { fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748B' } }, f.l),
              e('p', { style: { fontSize: 14, fontWeight: 500, marginTop: 4, color: '#F1F5F9' } }, f.v)
            )
          )
        ),
        detail.description && e('div', null,
          e('p', { style: { fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748B', marginBottom: 4 } }, 'Description'),
          e('p', { style: { fontSize: 14, padding: 12, borderRadius: 8, background: 'rgba(60,130,246,0.05)', color: '#F1F5F9', lineHeight: 1.6 } }, detail.description)
        )
      )
    )
  );
}

function OfficersPage() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [copied, setCopied] = useState(null);
  const [form, setForm] = useState({ firstName: '', lastName: '', rank: 'constable', stationId: 1, phone: '', email: '' });

  const load = () => {
    const input = {};
    if (search) input.search = search;
    API.get('officer.list?input=' + encodeURIComponent(JSON.stringify({ json: input }))).then(d => setItems(d?.officers || []));
  };

  useEffect(() => { load(); }, [search]);

  const create = () => {
    if (!form.firstName || !form.lastName) { alert('First and last name required'); return; }
    API.post('officer.create', form).then(() => { setShowAdd(false); setForm({ firstName: '', lastName: '', rank: 'constable', stationId: 1, phone: '', email: '' }); load(); });
  };

  const deleteOfficer = (id) => {
    if (!confirm('Remove this officer?')) return;
    API.post('officer.delete', { id }).then(() => load());
  };

  const copyCode = (code) => {
    navigator.clipboard.writeText(code).then(() => { setCopied(code); setTimeout(() => setCopied(null), 2000); }).catch(() => {});
  };

  return e('div', null,
    e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 } },
      e('div', null,
        e('h1', { style: { fontSize: 20, fontWeight: 'bold', color: '#F1F5F9' } }, 'Officer Management'),
        e('p', { style: { fontSize: 12, color: '#64748B', marginTop: 4 } }, 'Create officers and manage their access credentials')
      ),
      e('button', { className: 'btn btn-primary', style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }, onClick: () => setShowAdd(true) }, e(Icons.userPlus), ' ADD OFFICER')
    ),
    items.length === 0 && !showAdd && e('div', { className: 'glass', style: { padding: 32, textAlign: 'center', marginBottom: 24, cursor: 'pointer' }, onClick: () => setShowAdd(true) },
      e('div', { style: { width: 64, height: 64, borderRadius: '50%', background: 'rgba(59,130,246,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' } }, e(Icons.userPlus)),
      e('p', { style: { fontSize: 18, fontWeight: 'bold', color: '#F1F5F9' } }, 'Add Your First Officer'),
      e('p', { style: { fontSize: 14, color: '#94A3B8', marginTop: 4 } }, 'Click here to create an officer with a 6-digit authentication code')
    ),
    showAdd && e('div', { className: 'modal', onClick: () => setShowAdd(false) },
      e('div', { className: 'glass', style: { padding: 24, maxWidth: 500, width: '100%' }, onClick: e => e.stopPropagation() },
        e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid rgba(60,130,246,0.15)' } },
          e('h2', { style: { fontSize: 14, fontWeight: 'bold', color: '#F1F5F9' } }, 'Add New Officer'),
          e('button', { className: 'btn', style: { padding: 4 }, onClick: () => setShowAdd(false) }, e(Icons.close))
        ),
        e('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          e('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
            e('div', null, e('label', { style: { fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: '#64748B', marginBottom: 4, display: 'block' } }, 'First Name *'), e('input', { value: form.firstName, onChange: e => setForm(f => ({ ...f, firstName: e.target.value })), placeholder: 'Enter first name' })),
            e('div', null, e('label', { style: { fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: '#64748B', marginBottom: 4, display: 'block' } }, 'Last Name *'), e('input', { value: form.lastName, onChange: e => setForm(f => ({ ...f, lastName: e.target.value })), placeholder: 'Enter last name' }))
          ),
          e('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
            e('div', null, e('label', { style: { fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: '#64748B', marginBottom: 4, display: 'block' } }, 'Rank'), e('select', { value: form.rank, onChange: e => setForm(f => ({ ...f, rank: e.target.value })) }, RANKS.map(r => e('option', { key: r, value: r }, r.replace(/_/g, ' '))))),
            e('div', null, e('label', { style: { fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: '#64748B', marginBottom: 4, display: 'block' } }, 'Station'), e('select', { value: form.stationId, onChange: e => setForm(f => ({ ...f, stationId: Number(e.target.value) })) }, STATIONS.map(s => e('option', { key: s.id, value: s.id }, s.name))))
          ),
          e('div', { style: { padding: 12, borderRadius: 8, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' } },
            e('p', { style: { fontSize: 12, color: '#F59E0B' } }, 'A 6-digit authentication code will be auto-generated when you create this officer.')
          ),
          e('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 } },
            e('button', { className: 'btn', onClick: () => setShowAdd(false) }, 'Cancel'),
            e('button', { className: 'btn btn-primary', onClick: create }, 'Create Officer')
          )
        )
      )
    ),
    e('div', { className: 'glass', style: { padding: 16, marginBottom: 16 } },
      e('div', { style: { display: 'flex', gap: 12, alignItems: 'center' } },
        e(Icons.search),
        e('input', { type: 'text', placeholder: 'Search by name or badge...', value: search, onChange: e => setSearch(e.target.value), style: { flex: 1 } })
      )
    ),
    e('div', { className: 'glass', style: { overflow: 'hidden' } },
      e('table', null,
        e('thead', null, e('tr', null, e('th', null, 'Badge'), e('th', null, 'Name'), e('th', null, 'Rank'), e('th', null, 'Auth Code'), e('th', null, 'Status'), e('th', null, 'Actions'))),
        e('tbody', null, items.length === 0
          ? e('tr', null, e('td', { colSpan: 6, style: { textAlign: 'center', padding: 48 } }, e('p', { style: { color: '#64748B' } }, 'No officers yet. Click "ADD OFFICER" to create one.')))
          : items.map(o => e('tr', { key: o.id },
            e('td', null, e('span', { style: { fontSize: 11, fontFamily: 'monospace', fontWeight: 600, color: '#60A5FA' } }, o.badgeNumber)),
            e('td', null, e('span', { style: { fontSize: 14 } }, o.firstName + ' ' + o.lastName)),
            e('td', null, e('span', { style: { fontSize: 11, padding: '2px 10px', borderRadius: 9999, background: 'rgba(59,130,246,0.15)', color: '#60A5FA' } }, o.rank?.replace(/_/g, ' '))),
            e('td', null, e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              e('code', { style: { fontSize: 12, fontFamily: 'monospace', padding: '2px 8px', borderRadius: 4, background: 'rgba(245,158,11,0.15)', color: '#F59E0B', fontWeight: 'bold' } }, o.authCode),
              e('button', { className: 'btn', style: { padding: 2 }, onClick: () => copyCode(o.authCode) }, copied === o.authCode ? e(Icons.check) : e(Icons.copy))
            )),
            e('td', null, e('span', { style: { fontSize: 11, padding: '2px 10px', borderRadius: 9999', background: o.status === 'active' ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)', color: o.status === 'active' ? '#10B981' : '#F59E0B' } }, o.status)),
            e('td', null, e('button', { className: 'btn', style: { padding: 4, color: '#EF4444', borderColor: 'rgba(239,68,68,0.3)' }, onClick: () => deleteOfficer(o.id) }, e(Icons.trash)))
          ))
        )
      )
    ),
    e('div', { className: 'glass', style: { padding: 16, marginTop: 16, display: 'flex', alignItems: 'flex-start', gap: 12 } },
      e('span', { style: { fontSize: 20 } }, '\uD83D\uDD10'),
      e('div', null,
        e('p', { style: { fontSize: 12, fontWeight: 600, color: '#F1F5F9' } }, 'Mobile App Authentication'),
        e('p', { style: { fontSize: 12, color: '#94A3B8', marginTop: 4, lineHeight: 1.6 } }, 'Each officer uses their ', e('strong', { style: { color: '#F59E0B' } }, 'Badge Number'), ' + ', e('strong', { style: { color: '#F59E0B' } }, '6-digit Auth Code'), ' to log into the mobile app. The auth code is auto-generated when you create an officer.')
      )
    )
  );
}

// ─── App Shell ───
function App() {
  const [page, setPage] = useState('dashboard');
  const [collapsed, setCollapsed] = useState(false);

  currentPage = page;
  window.render = () => setPage(currentPage);

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return e(DashboardPage);
      case 'reports': return e(ReportsPage);
      case 'officers': return e(OfficersPage);
      default: return e(DashboardPage);
    }
  };

  return e('div', { style: { display: 'flex' } },
    e(Sidebar, { page, onPageChange: setPage, collapsed, onToggle: () => setCollapsed(!collapsed) }),
    e('div', { style: { marginLeft: collapsed ? 64 : 250, flex: 1, minHeight: '100vh' } },
      e(Header),
      e('main', { style: { padding: '80px 24px 24px' } }, renderPage())
    )
  );
}

// ─── Mount ───
const root = ReactDOM.createRoot(document.getElementById('app'));
root.render(e(App));
