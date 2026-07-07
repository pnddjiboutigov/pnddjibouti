import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";

// ─── Data Stores ───
const reports = [];
const officers = [];
const auditLogs = [];
const stations = [
  { id: 1, name: "PND Headquarters" },
  { id: 2, name: "Balbala Station" },
  { id: 3, name: "Ambouli Station" },
  { id: 4, name: "Arta Station" },
  { id: 5, name: "Ali Sabieh Station" },
  { id: 6, name: "Dikhil Station" },
  { id: 7, name: "Tadjourah Station" },
  { id: 8, name: "Obock Station" },
  { id: 9, name: "Ali Adde Station" },
  { id: 10, name: "Holhol Station" },
];
let rid = 1, oid = 1, aid = 1;
const genRid = () => { const d = new Date().toISOString().slice(0,10).replace(/-/g,""); return `RPT-${d}-${String(reports.length+1).padStart(4,"0")}`; };
const genAuth = () => Math.floor(100000 + Math.random() * 900000).toString();
const genBadge = () => "PND-" + Math.floor(10000 + Math.random() * 90000);

// ─── Hono App ───
const app = new Hono();
app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], allowHeaders: ["*"] }));

// ─── REST API ───

// List active officers (for mobile)
app.get("/api/officers", (c) => {
  const active = officers.filter(o => o.status === "active");
  return c.json({ officers: active.map(o => ({ id: o.id, badgeNumber: o.badgeNumber, firstName: o.firstName, lastName: o.lastName, rank: o.rank, authCode: o.authCode, stationName: stations.find(s => s.id === o.stationId)?.name || "PND" })) });
});

// Officer login (for mobile)
app.post("/api/auth/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const officer = officers.find(o => o.badgeNumber === body.badgeNumber && o.authCode === body.authCode && o.status === "active");
  if (!officer) return c.json({ success: false, error: "Invalid credentials" }, 401);
  auditLogs.push({ id: aid++, userId: officer.id, action: "officer_login", resource: "officer", resourceId: String(officer.id), details: `${officer.firstName} ${officer.lastName} logged in`, createdAt: Date.now() });
  return c.json({ success: true, officer: { id: officer.id, badgeNumber: officer.badgeNumber, firstName: officer.firstName, lastName: officer.lastName, rank: officer.rank, stationName: stations.find(s => s.id === officer.stationId)?.name || "PND" } });
});

// Submit report (from mobile)
app.post("/api/reports", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const r = { id: rid++, reportId: genRid(), location: body.location || "Unknown", latitude: body.latitude || null, longitude: body.longitude || null, accidentDate: body.accidentDate || new Date().toISOString().split("T")[0], accidentTime: body.accidentTime || new Date().toLocaleTimeString("en-US", { hour12: false }), severity: body.severity || "moderate", status: "submitted", weather: body.weather || null, roadCondition: body.roadCondition || null, accidentType: body.accidentType || null, description: body.description || null, officerId: body.officerId || null, stationId: body.stationId || null, createdAt: Date.now() };
  reports.push(r);
  auditLogs.push({ id: aid++, userId: body.officerId || null, action: "create_report", resource: "report", resourceId: String(r.id), details: `Report ${r.reportId} from mobile`, createdAt: Date.now() });
  return c.json({ success: true, report: r });
});

// ─── tRPC-compatible API (for dashboard) ───

// Report endpoints
app.get("/api/trpc/report.list", async (c) => {
  const input = JSON.parse(c.req.query("input") || "{}");
  const json = input.json || {};
  let result = [...reports].sort((a, b) => b.createdAt - a.createdAt);
  if (json.status) result = result.filter(x => x.status === json.status);
  if (json.severity) result = result.filter(x => x.severity === json.severity);
  if (json.search) { const q = json.search.toLowerCase(); result = result.filter(x => x.location.toLowerCase().includes(q) || x.reportId.toLowerCase().includes(q)); }
  const offset = json.offset || 0;
  const limit = json.limit || 50;
  return c.json({ result: { data: { reports: result.slice(offset, offset + limit), total: result.length } } });
});

app.get("/api/trpc/report.stats", (c) => {
  const bs = {}, bv = {};
  reports.forEach(r => { bs[r.status] = (bs[r.status] || 0) + 1; bv[r.severity] = (bv[r.severity] || 0) + 1; });
  const tdy = new Date().toISOString().split("T")[0];
  return c.json({ result: { data: { total: reports.length, today: reports.filter(r => r.accidentDate === tdy).length, byStatus: Object.entries(bs).map(([s, c]) => ({ status: s, count: c })), bySeverity: Object.entries(bv).map(([s, c]) => ({ severity: s, count: c })) } } });
});

app.post("/api/trpc/report.updateStatus", async (c) => {
  const body = await c.req.json();
  const input = body.json || {};
  const r = reports.find(x => x.id === input.id);
  if (r) { r.status = input.status; r.updatedAt = Date.now(); }
  return c.json({ result: { data: { id: input.id, status: input.status } } });
});

app.post("/api/trpc/report.delete", async (c) => {
  const body = await c.req.json();
  const input = body.json || {};
  const i = reports.findIndex(x => x.id === input.id);
  if (i >= 0) reports.splice(i, 1);
  return c.json({ result: { data: { success: true } } });
});

// Officer endpoints
app.get("/api/trpc/officer.list", async (c) => {
  const input = JSON.parse(c.req.query("input") || "{}");
  const json = input.json || {};
  let result = [...officers].sort((a, b) => b.createdAt - a.createdAt);
  if (json.status) result = result.filter(x => x.status === json.status);
  if (json.search) { const q = json.search.toLowerCase(); result = result.filter(x => x.firstName.toLowerCase().includes(q) || x.lastName.toLowerCase().includes(q) || x.badgeNumber.toLowerCase().includes(q)); }
  return c.json({ result: { data: { officers: result, total: result.length } } });
});

app.post("/api/trpc/officer.create", async (c) => {
  const body = await c.req.json();
  const input = body.json || {};
  const o = { id: oid++, badgeNumber: input.badgeNumber || genBadge(), authCode: genAuth(), firstName: input.firstName, lastName: input.lastName, rank: input.rank || "constable", stationId: input.stationId || 1, phone: input.phone || null, email: input.email || null, status: "active", joinDate: null, createdAt: Date.now() };
  officers.push(o);
  return c.json({ result: { data: o } });
});

app.post("/api/trpc/officer.update", async (c) => {
  const body = await c.req.json();
  const input = body.json || {};
  const o = officers.find(x => x.id === input.id);
  if (o) { const { id, ...u } = input; Object.assign(o, u); }
  return c.json({ result: { data: input } });
});

app.post("/api/trpc/officer.delete", async (c) => {
  const body = await c.req.json();
  const input = body.json || {};
  const i = officers.findIndex(x => x.id === input.id);
  if (i >= 0) officers.splice(i, 1);
  return c.json({ result: { data: { success: true } } });
});

app.get("/api/trpc/officer.stations", (c) => c.json({ result: { data: stations } }));

app.get("/api/trpc/officer.stats", (c) => c.json({ result: { data: { total: officers.length, active: officers.filter(o => o.status === "active").length, onLeave: officers.filter(o => o.status === "on_leave").length, suspended: officers.filter(o => o.status === "suspended").length } } }));

// Analytics
app.get("/api/trpc/analytics.executive", (c) => {
  const lm = {};
  reports.forEach(r => { lm[r.location] = (lm[r.location] || 0) + 1; });
  return c.json({ result: { data: { totalReports: reports.length, submitted: reports.filter(r => r.status === "submitted").length, approved: reports.filter(r => r.status === "approved").length, pendingReview: reports.filter(r => r.status === "under_review").length, activeOfficers: officers.filter(o => o.status === "active").length, responseTime: 14, hotspots: Object.entries(lm).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([l, c]) => ({ location: l, count: c })) } } });
});

app.get("/api/trpc/analytics.timeSeries", (c) => {
  const dm = {};
  reports.forEach(r => { dm[r.accidentDate] = (dm[r.accidentDate] || 0) + 1; });
  return c.json({ result: { data: Object.entries(dm).map(([p, c]) => ({ period: p, count: c })).sort((a, b) => a.period.localeCompare(b.period)).slice(-30) } });
});

app.get("/api/trpc/analytics.byType", (c) => {
  const m = {};
  reports.forEach(r => { if (r.accidentType) m[r.accidentType] = (m[r.accidentType] || 0) + 1; });
  return c.json({ result: { data: Object.entries(m).map(([t, c]) => ({ accident_type: t, count: c })) } });
});

app.get("/api/trpc/analytics.byWeather", (c) => {
  const m = {};
  reports.forEach(r => { if (r.weather) m[r.weather] = (m[r.weather] || 0) + 1; });
  return c.json({ result: { data: Object.entries(m).map(([w, c]) => ({ weather: w, count: c })) } });
});

app.get("/api/trpc/analytics.byRoadCondition", (c) => {
  const m = {};
  reports.forEach(r => { if (r.roadCondition) m[r.roadCondition] = (m[r.roadCondition] || 0) + 1; });
  return c.json({ result: { data: Object.entries(m).map(([r, c]) => ({ roadCondition: r, count: c })) } });
});

// Audit
app.get("/api/trpc/audit.list", async (c) => {
  const input = JSON.parse(c.req.query("input") || "{}");
  const json = input.json || {};
  let result = [...auditLogs].sort((a, b) => b.createdAt - a.createdAt);
  if (json.search) { const q = json.search.toLowerCase(); result = result.filter(x => x.action?.toLowerCase().includes(q) || x.details?.toLowerCase().includes(q)); }
  const offset = json.offset || 0;
  const limit = json.limit || 50;
  return c.json({ result: { data: { logs: result.slice(offset, offset + limit), total: result.length } } });
});

// Station
app.get("/api/trpc/station.list", (c) => c.json({ result: { data: stations } }));

// ─── Static files (frontend) ───
app.use("*", serveStatic({ root: "./public" }));
app.get("*", serveStatic({ path: "./public/index.html" }));

const port = parseInt(process.env.PORT || "3000");
serve({ fetch: app.fetch, port }, () => console.log(`Server running on port ${port}`));
