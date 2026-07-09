import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { serial, pgTable, varchar, text, timestamp, integer, boolean, real } from "drizzle-orm/pg-core";

// ==================== DATABASE SCHEMA ====================
const stations = pgTable("stations", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  region: varchar("region", { length: 50 }),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

const vehicleTypes = pgTable("vehicle_types", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  category: varchar("category", { length: 50 }).notNull(),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

const insuranceCompanies = pgTable("insurance_companies", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  category: varchar("category", { length: 50 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  phone: varchar("phone", { length: 30 }),
  email: varchar("email", { length: 100 }),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

const officers = pgTable("officers", {
  id: serial("id").primaryKey(),
  badgeNumber: varchar("badge_number", { length: 20 }).notNull().unique(),
  authCode: varchar("auth_code", { length: 64 }).notNull(),
  firstName: varchar("first_name", { length: 50 }).notNull(),
  lastName: varchar("last_name", { length: 50 }).notNull(),
  rank: varchar("rank", { length: 30 }).notNull(),
  stationId: integer("station_id"),
  phone: varchar("phone", { length: 20 }),
  status: varchar("status", { length: 20 }).default("active"),
  createdAt: timestamp("created_at").defaultNow(),
});

const reports = pgTable("reports", {
  id: serial("id").primaryKey(),
  reportId: varchar("report_id", { length: 30 }).notNull().unique(),
  status: varchar("status", { length: 20 }).default("submitted"),
  officerId: integer("officer_id"),
  address: text("address"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  date: varchar("date", { length: 10 }),
  time: varchar("time", { length: 10 }),
  accidentType: varchar("accident_type", { length: 50 }),
  severity: varchar("severity", { length: 20 }),
  weather: varchar("weather", { length: 50 }),
  roadCondition: varchar("road_condition", { length: 50 }),
  lighting: varchar("lighting", { length: 50 }),
  description: text("description"),
  damageDescription: text("damage_description"),
  officerObservations: text("officer_observations"),
  evidenceNotes: text("evidence_notes"),
  submittedAt: timestamp("submitted_at").defaultNow(),
  approvedAt: timestamp("approved_at"),
  approvedBy: varchar("approved_by", { length: 50 }),
  syncStatus: varchar("sync_status", { length: 20 }).default("synced"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

const vehicles = pgTable("vehicles", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id"),
  plateNumber: varchar("plate_number", { length: 30 }),
  brand: varchar("brand", { length: 50 }),
  model: varchar("model", { length: 50 }),
  color: varchar("color", { length: 30 }),
  vehicleType: varchar("vehicle_type", { length: 50 }),
  insuranceCompany: varchar("insurance_company", { length: 100 }),
  insurancePolicy: varchar("insurance_policy", { length: 50 }),
  createdAt: timestamp("created_at").defaultNow(),
});

const persons = pgTable("persons", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id"),
  type: varchar("type", { length: 20 }),
  firstName: varchar("first_name", { length: 50 }),
  lastName: varchar("last_name", { length: 50 }),
  idNumber: varchar("id_number", { length: 50 }),
  phone: varchar("phone", { length: 20 }),
  licenseNumber: varchar("license_number", { length: 50 }),
  licenseCategory: varchar("license_category", { length: 30 }),
  injuries: varchar("injuries", { length: 20 }),
  createdAt: timestamp("created_at").defaultNow(),
});

const witnesses = pgTable("witnesses", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id"),
  firstName: varchar("first_name", { length: 50 }),
  lastName: varchar("last_name", { length: 50 }),
  phone: varchar("phone", { length: 20 }),
  statement: text("statement"),
  createdAt: timestamp("created_at").defaultNow(),
});

const photos = pgTable("photos", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id"),
  url: text("url"),
  caption: text("caption"),
  timestamp: varchar("timestamp", { length: 30 }),
  createdAt: timestamp("created_at").defaultNow(),
});

const videos = pgTable("videos", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id"),
  videoType: varchar("video_type", { length: 20 }),
  url: text("url"),
  caption: text("caption"),
  timestamp: varchar("timestamp", { length: 30 }),
  createdAt: timestamp("created_at").defaultNow(),
});

const measurements = pgTable("measurements", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id"),
  item: varchar("item", { length: 200 }),
  distance: varchar("distance", { length: 50 }),
  unit: varchar("unit", { length: 20 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  action: varchar("action", { length: 50 }),
  resource: varchar("resource", { length: 50 }),
  resourceId: varchar("resource_id", { length: 50 }),
  details: text("details"),
  userId: varchar("user_id", { length: 50 }),
  createdAt: timestamp("created_at").defaultNow(),
});

const schema = { stations, vehicleTypes, insuranceCompanies, officers, reports, vehicles, persons, witnesses, photos, videos, measurements, auditLog };

// ==================== DATABASE CONNECTION ====================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});
const db = drizzle(pool, { schema });

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "pnd-djibouti-secret-key-2026");

// ==================== APP ====================
const app = new Hono();
app.use("*", cors({ origin: "*", allowMethods: ["GET","POST","PUT","DELETE","OPTIONS"], allowHeaders: ["*"] }));

// Auth middleware
const authMiddleware = async (c, next) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return c.json({ error: "Unauthorized" }, 401);
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, { clockTolerance: 60 });
    c.set("user", payload);
    await next();
  } catch { return c.json({ error: "Invalid token" }, 401); }
};

const adminMiddleware = async (c, next) => {
  const user = c.get("user");
  if (!user || user.rank !== "admin") return c.json({ error: "Admin only" }, 403);
  await next();
};

// Audit helper
async function audit(action, resource, resourceId, details, userId) {
  try { await db.insert(auditLog).values({ action, resource, resourceId, details, userId: String(userId) }); } catch(e) {}
}

// ==================== AUTH ====================
app.post("/api/auth/officer-login", async (c) => {
  const { badgeNumber, authCode } = await c.req.json();
  if (!badgeNumber || !authCode) return c.json({ error: "Missing credentials" }, 400);
  const off = await db.select().from(officers).where(eq(officers.badgeNumber, badgeNumber)).limit(1);
  if (!off.length) return c.json({ error: "Invalid credentials" }, 401);
  const match = await bcrypt.compare(authCode, off[0].authCode);
  if (!match) return c.json({ error: "Invalid credentials" }, 401);
  const st = await db.select().from(stations).where(eq(stations.id, off[0].stationId)).limit(1);
  const token = await new SignJWT({ officerId: off[0].id, badge: off[0].badgeNumber, rank: off[0].rank, name: off[0].firstName + " " + off[0].lastName, station: st[0]?.name || "" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("7d").sign(JWT_SECRET);
  await audit("login", "officer", String(off[0].id), "Officer " + off[0].badgeNumber + " logged in", String(off[0].id));
  return c.json({ token, officer: { ...off[0], stationName: st[0]?.name || "" } });
});

app.post("/api/auth/admin-login", async (c) => {
  const { password } = await c.req.json();
  if (password !== "admin2025") return c.json({ error: "Invalid password" }, 401);
  const token = await new SignJWT({ badge: "ADMIN", rank: "admin", name: "Administrator" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("7d").sign(JWT_SECRET);
  return c.json({ token });
});

// ==================== STATIONS ====================
app.get("/api/stations", async (c) => { const d = await db.select().from(stations).where(eq(stations.active, true)); return c.json(d); });

// ==================== VEHICLE TYPES ====================
app.get("/api/vehicle-types", async (c) => { const d = await db.select().from(vehicleTypes).where(eq(vehicleTypes.active, true)); return c.json(d); });
app.post("/api/vehicle-types", authMiddleware, adminMiddleware, async (c) => { const b = await c.req.json(); const r = await db.insert(vehicleTypes).values(b).returning(); return c.json(r[0]); });
app.put("/api/vehicle-types/:id", authMiddleware, adminMiddleware, async (c) => { const id = parseInt(c.req.param("id")); const b = await c.req.json(); const r = await db.update(vehicleTypes).set(b).where(eq(vehicleTypes.id, id)).returning(); return c.json(r[0]); });
app.delete("/api/vehicle-types/:id", authMiddleware, adminMiddleware, async (c) => { const id = parseInt(c.req.param("id")); await db.update(vehicleTypes).set({ active: false }).where(eq(vehicleTypes.id, id)); return c.json({ success: true }); });

// ==================== INSURANCE COMPANIES ====================
app.get("/api/insurance-companies", async (c) => { const d = await db.select().from(insuranceCompanies).where(eq(insuranceCompanies.active, true)); return c.json(d); });
app.post("/api/insurance-companies", authMiddleware, adminMiddleware, async (c) => { const b = await c.req.json(); const r = await db.insert(insuranceCompanies).values(b).returning(); return c.json(r[0]); });
app.put("/api/insurance-companies/:id", authMiddleware, adminMiddleware, async (c) => { const id = parseInt(c.req.param("id")); const b = await c.req.json(); const r = await db.update(insuranceCompanies).set(b).where(eq(insuranceCompanies.id, id)).returning(); return c.json(r[0]); });
app.delete("/api/insurance-companies/:id", authMiddleware, adminMiddleware, async (c) => { const id = parseInt(c.req.param("id")); await db.update(insuranceCompanies).set({ active: false }).where(eq(insuranceCompanies.id, id)); return c.json({ success: true }); });

// ==================== OFFICERS ====================
app.get("/api/officers", authMiddleware, async (c) => { const d = await db.select().from(officers).orderBy(desc(officers.createdAt)); const st = await db.select().from(stations); const enriched = d.map(o => ({ ...o, stationName: st.find(s => s.id === o.stationId)?.name || "" })); return c.json(enriched); });
app.post("/api/officers", authMiddleware, adminMiddleware, async (c) => { const b = await c.req.json(); const hc = await bcrypt.hash(b.authCode, 10); const r = await db.insert(officers).values({ ...b, authCode: hc }).returning(); await audit("create_officer", "officer", String(r[0].id), "Officer " + b.badgeNumber + " created", "admin"); return c.json({ ...r[0], authCode: undefined }); });
app.put("/api/officers/:id", authMiddleware, adminMiddleware, async (c) => { const id = parseInt(c.req.param("id")); const b = await c.req.json(); const ud = { ...b }; if (b.authCode) ud.authCode = await bcrypt.hash(b.authCode, 10); const r = await db.update(officers).set(ud).where(eq(officers.id, id)).returning(); return c.json({ ...r[0], authCode: undefined }); });
app.delete("/api/officers/:id", authMiddleware, adminMiddleware, async (c) => { const id = parseInt(c.req.param("id")); await db.update(officers).set({ status: "inactive" }).where(eq(officers.id, id)); return c.json({ success: true }); });

// ==================== REPORTS ====================
app.get("/api/reports", authMiddleware, async (c) => { const d = await db.select().from(reports).orderBy(desc(reports.createdAt)); const o = await db.select().from(officers); const enriched = d.map(r => ({ ...r, officerName: o.find(x => x.id === r.officerId)?.firstName + " " + o.find(x => x.id === r.officerId)?.lastName || "" })); return c.json(enriched); });

app.get("/api/reports/:id/full", authMiddleware, async (c) => {
  const rid = parseInt(c.req.param("id"));
  const rp = await db.select().from(reports).where(eq(reports.id, rid)).limit(1);
  if (!rp.length) return c.json({ error: "Not found" }, 404);
  const [v, p, w, ph, vi, m] = await Promise.all([
    db.select().from(vehicles).where(eq(vehicles.reportId, rid)),
    db.select().from(persons).where(eq(persons.reportId, rid)),
    db.select().from(witnesses).where(eq(witnesses.reportId, rid)),
    db.select().from(photos).where(eq(photos.reportId, rid)),
    db.select().from(videos).where(eq(videos.reportId, rid)),
    db.select().from(measurements).where(eq(measurements.reportId, rid)),
  ]);
  const o = await db.select().from(officers).where(eq(officers.id, rp[0].officerId)).limit(1);
  const st = o.length ? await db.select().from(stations).where(eq(stations.id, o[0].stationId)).limit(1) : [];
  return c.json({ ...rp[0], vehicles: v, persons: p, witnesses: w, photos: ph, videos: vi, measurements: m, officer: o.length ? { ...o[0], stationName: st[0]?.name || "" } : null });
});

app.post("/api/reports", authMiddleware, async (c) => {
  const b = await c.req.json();
  const u = c.get("user");
  const rd = { reportId: b.reportId || ("RPT-" + new Date().toISOString().slice(0,10).replace(/-/g,"") + "-" + String(Math.floor(Math.random()*9000)+1000)), officerId: u.officerId || 1, status: b.status || "submitted", address: b.address || b.location?.address || "", latitude: b.latitude || b.location?.latitude || null, longitude: b.longitude || b.location?.longitude || null, date: b.date || new Date().toISOString().slice(0,10), time: b.time || new Date().toTimeString().slice(0,5), accidentType: b.accidentType || "", severity: b.severity || "moderate", weather: b.weather || "", roadCondition: b.roadCondition || "", lighting: b.lighting || "", description: b.description || "", damageDescription: b.damageDescription || "", officerObservations: b.officerObservations || "", evidenceNotes: b.evidenceNotes || "", syncStatus: "synced" };
  const r = await db.insert(reports).values(rd).returning();
  const nid = r[0].id;
  if (b.vehicles?.length) for (const x of b.vehicles) await db.insert(vehicles).values({ reportId: nid, ...x });
  if (b.parties?.length) for (const x of b.parties) await db.insert(persons).values({ reportId: nid, ...x });
  if (b.witnesses?.length) for (const x of b.witnesses) await db.insert(witnesses).values({ reportId: nid, ...x });
  if (b.photos?.length) for (const x of b.photos) await db.insert(photos).values({ reportId: nid, ...x });
  if (b.videos?.length) for (const x of b.videos) await db.insert(videos).values({ reportId: nid, ...x });
  if (b.measurements?.length) for (const x of b.measurements) await db.insert(measurements).values({ reportId: nid, ...x });
  await audit("submit_report", "report", String(nid), "Report " + rd.reportId + " submitted", String(u.officerId || 1));
  return c.json({ ...r[0], id: nid });
});

app.put("/api/reports/:id", authMiddleware, async (c) => { const id = parseInt(c.req.param("id")); const b = await c.req.json(); const ud = { ...b, updatedAt: new Date() }; delete ud.vehicles; delete ud.persons; delete ud.witnesses; delete ud.photos; delete ud.videos; delete ud.measurements; const r = await db.update(reports).set(ud).where(eq(reports.id, id)).returning(); return c.json(r[0]); });

app.post("/api/reports/:id/approve", authMiddleware, adminMiddleware, async (c) => { const id = parseInt(c.req.param("id")); const r = await db.update(reports).set({ status: "approved", approvedAt: new Date(), approvedBy: "admin" }).where(eq(reports.id, id)).returning(); await audit("approve_report", "report", String(id), "Report " + r[0].reportId + " approved", "admin"); return c.json(r[0]); });

app.delete("/api/reports/:id", authMiddleware, adminMiddleware, async (c) => { const id = parseInt(c.req.param("id")); await db.delete(vehicles).where(eq(vehicles.reportId, id)); await db.delete(persons).where(eq(persons.reportId, id)); await db.delete(witnesses).where(eq(witnesses.reportId, id)); await db.delete(photos).where(eq(photos.reportId, id)); await db.delete(videos).where(eq(videos.reportId, id)); await db.delete(measurements).where(eq(measurements.reportId, id)); await db.delete(reports).where(eq(reports.id, id)); return c.json({ success: true }); });

// ==================== PERIOD REPORTS ====================
app.get("/api/reports/period/:period", authMiddleware, async (c) => {
  const period = c.req.param("period");
  const now = new Date(); let startDate, endDate;
  if (period === "daily") { startDate = endDate = now.toISOString().slice(0,10); }
  else if (period === "weekly") { const d = new Date(now); d.setDate(d.getDate() - 7); startDate = d.toISOString().slice(0,10); endDate = now.toISOString().slice(0,10); }
  else if (period === "monthly") { startDate = now.toISOString().slice(0,8) + "01"; endDate = now.toISOString().slice(0,10); }
  else if (period === "quarterly") { const q = Math.floor(now.getMonth() / 3); startDate = now.getFullYear() + "-" + String(q*3+1).padStart(2,"0") + "-01"; endDate = now.toISOString().slice(0,10); }
  else if (period === "yearly") { startDate = now.getFullYear() + "-01-01"; endDate = now.toISOString().slice(0,10); }
  else return c.json({ error: "Invalid period" }, 400);
  const rp = await db.select().from(reports).where(and(gte(reports.date, startDate), lte(reports.date, endDate))).orderBy(desc(reports.date));
  const s = { total: rp.length, minor: rp.filter(r => r.severity === "minor").length, moderate: rp.filter(r => r.severity === "moderate").length, serious: rp.filter(r => r.severity === "serious").length, fatal: rp.filter(r => r.severity === "fatal").length, byType: {}, byWeather: {}, byRoad: {} };
  rp.forEach(r => { s.byType[r.accidentType || "Unknown"] = (s.byType[r.accidentType || "Unknown"] || 0) + 1; s.byWeather[r.weather || "Unknown"] = (s.byWeather[r.weather || "Unknown"] || 0) + 1; s.byRoad[r.roadCondition || "Unknown"] = (s.byRoad[r.roadCondition || "Unknown"] || 0) + 1; });
  return c.json({ period, startDate, endDate, stats: s, reports: rp });
});

app.get("/api/reports/custom-range", authMiddleware, async (c) => {
  const start = c.req.query("start"), end = c.req.query("end");
  if (!start || !end) return c.json({ error: "Start and end dates required" }, 400);
  const rp = await db.select().from(reports).where(and(gte(reports.date, start), lte(reports.date, end))).orderBy(desc(reports.date));
  const s = { total: rp.length, minor: rp.filter(r => r.severity === "minor").length, moderate: rp.filter(r => r.severity === "moderate").length, serious: rp.filter(r => r.severity === "serious").length, fatal: rp.filter(r => r.severity === "fatal").length, byType: {}, byWeather: {} };
  rp.forEach(r => { s.byType[r.accidentType || "Unknown"] = (s.byType[r.accidentType || "Unknown"] || 0) + 1; s.byWeather[r.weather || "Unknown"] = (s.byWeather[r.weather || "Unknown"] || 0) + 1; });
  return c.json({ startDate: start, endDate: end, stats: s, reports: rp });
});

// ==================== DASHBOARD STATS ====================
app.get("/api/dashboard
