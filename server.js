import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

const db = new Database("./pnd.db");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS officers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  badge_number TEXT UNIQUE, auth_code TEXT,
  first_name TEXT, last_name TEXT,
  rank TEXT, status TEXT DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id TEXT UNIQUE, officer_id INTEGER,
  status TEXT DEFAULT 'submitted', address TEXT,
  date TEXT, time TEXT, accident_type TEXT,
  severity TEXT, weather TEXT, description TEXT
);
CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER, plate_number TEXT,
  brand TEXT, model TEXT, color TEXT, vehicle_type TEXT
);
CREATE TABLE IF NOT EXISTS persons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER, type TEXT, first_name TEXT,
  last_name TEXT, id_number TEXT, phone TEXT, injuries TEXT
);
CREATE TABLE IF NOT EXISTS witnesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER, first_name TEXT,
  last_name TEXT, phone TEXT, statement TEXT
);
`);

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "pnd-secret-2026");
const app = new Hono();
app.use("*", cors({ origin: "*", allowMethods: ["*"], allowHeaders: ["*"] }));

const auth = async (c, next) => {
  const t = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!t) return c.json({ error: "Unauthorized" }, 401);
  try { const { payload } = await jwtVerify(t, JWT_SECRET, { clockTolerance: 60 }); c.set("user", payload); await next(); } catch { return c.json({ error: "Invalid" }, 401); }
};

app.post("/api/auth/officer-login", async (c) => {
  const { badgeNumber, authCode } = await c.req.json();
  const row = db.prepare("SELECT * FROM officers WHERE badge_number=?").get(badgeNumber);
  if (!row || !await bcrypt.compare(authCode, row.auth_code)) return c.json({ error: "Invalid" }, 401);
  const t = await new SignJWT({ officerId: row.id, badge: row.badge_number, rank: row.rank, name: row.first_name + " " + row.last_name }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("7d").sign(JWT_SECRET);
  return c.json({ token: t, officer: row });
});

app.post("/api/auth/admin-login", async (c) => {
  const { password } = await c.req.json();
  if (password !== "admin2025") return c.json({ error: "Invalid" }, 401);
  const t = await new SignJWT({ rank: "admin" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("7d").sign(JWT_SECRET);
  return c.json({ token: t });
});

app.get("/api/reports", auth, (c) => c.json(db.prepare("SELECT * FROM reports ORDER BY id DESC").all()));
app.post("/api/reports", auth, async (c) => {
  const b = await c.req.json();
  const uid = c.get("user").officerId || 1;
  const rid = "RPT-" + new Date().toISOString().slice(0,10).replace(/-/g,"") + "-" + Math.floor(1000+Math.random()*9000);
  const r = db.prepare("INSERT INTO reports (report_id,officer_id,address,date,time,accident_type,severity,weather,description) VALUES (?,?,?,?,?,?,?,?,?) RETURNING *").get(rid,uid,b.address||"",b.date,b.time,b.accidentType||"",b.severity||"moderate",b.weather||"",b.description||"");
  return c.json(r);
});

app.get("/api/health", (c) => c.json({ status: "ok" }));
const port = process.env.PORT || 3000;
serve({ fetch: app.fetch, port });
console.log("PND API on port " + port);
         
