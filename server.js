import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "pnd-secret-2026"
);

const app = new Hono();
app.use("*", cors({ origin: "*", allowMethods: ["*"], allowHeaders: ["*"] }));

const auth = async (c, next) => {
  const t = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!t) return c.json({ error: "Unauthorized" }, 401);
  try {
    const { payload } = await jwtVerify(t, JWT_SECRET, { clockTolerance: 60 });
    c.set("user", payload);
    await next();
  } catch { return c.json({ error: "Invalid token" }, 401); }
};

const admin = async (c, next) => {
  if (c.get("user")?.rank !== "admin") return c.json({ error: "Admin only" }, 403);
  await next();
};

// AUTH
app.post("/api/auth/officer-login", async (c) => {
  const { badgeNumber, authCode } = await c.req.json();
  const r = await pool.query("SELECT * FROM officers WHERE badge_number=$1 AND status='active'", [badgeNumber]);
  if (!r.rows.length) return c.json({ error: "Invalid" }, 401);
  if (!await bcrypt.compare(authCode, r.rows[0].auth_code)) return c.json({ error: "Invalid" }, 401);
  const t = await new SignJWT({ officerId: r.rows[0].id, badge: r.rows[0].badge_number, rank: r.rows[0].rank, name: r.rows[0].first_name + " " + r.rows[0].last_name }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("7d").sign(JWT_SECRET);
  return c.json({ token: t, officer: r.rows[0] });
});

app.post("/api/auth/admin-login", async (c) => {
  const { password } = await c.req.json();
  if (password !== "admin2025") return c.json({ error: "Invalid" }, 401);
  const t = await new SignJWT({ rank: "admin" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("7d").sign(JWT_SECRET);
  return c.json({ token: t });
});

// DATA
app.get("/api/stations", async (c) => { const r = await pool.query("SELECT * FROM stations WHERE active=true"); return c.json(r.rows); });
app.get("/api/vehicle-types", async (c) => { const r = await pool.query("SELECT * FROM vehicle_types WHERE active=true"); return c.json(r.rows); });
app.get("/api/insurance-companies", async (c) => { const r = await pool.query("SELECT * FROM insurance_companies WHERE active=true"); return c.json(r.rows); });
app.get("/api/officers", auth, async (c) => { const r = await pool.query("SELECT o.*,s.name as station_name FROM officers o LEFT JOIN stations s ON o.station_id=s.id"); return c.json(r.rows); });
app.post("/api/officers", auth, admin, async (c) => { const b = await c.req.json(); const h = await bcrypt.hash(b.authCode, 10); const r = await pool.query("INSERT INTO officers(badge_number,auth_code,first_name,last_name,rank,station_id,phone,status)VALUES($1,$2,$3,$4,$5,$6,$7,'active')RETURNING *", [b.badgeNumber,h,b.firstName,b.lastName,b.rank,b.stationId,b.phone]); return c.json(r.rows[0]); });

app.get("/api/reports", auth, async (c) => { const r = await pool.query("SELECT * FROM reports ORDER BY created_at DESC"); return c.json(r.rows); });
app.get("/api/reports/:id/full", auth, async (c) => { const id = c.req.param("id"); const rp = await pool.query("SELECT * FROM reports WHERE id=$1", [id]); if(!rp.rows.length)return c.json({error:"Not found"},404); const [v,p,w] = await Promise.all([pool.query("SELECT * FROM vehicles WHERE report_id=$1",[id]),pool.query("SELECT * FROM persons WHERE report_id=$1",[id]),pool.query("SELECT * FROM witnesses WHERE report_id=$1",[id])]); return c.json({...rp.rows[0],vehicles:v.rows,persons:p.rows,witnesses:w.rows}); });
app.post("/api/reports", auth, async (c) => { const b = await c.req.json(); const uid = c.get("user").officerId||1; const rid = "RPT-" + new Date().toISOString().slice(0,10).replace(/-/g,"") + "-" + Math.floor(1000+Math.random()*9000); const r = await pool.query("INSERT INTO reports(report_id,officer_id,status,address,date,time,accident_type,severity,weather,road_condition,lighting,description,damage_description,officer_observations)VALUES($1,$2,'submitted',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)RETURNING *", [rid,uid,b.address||"",b.date,b.time,b.accidentType,b.severity||"moderate",b.weather,b.roadCondition,b.lighting,b.description,b.damageDescription,b.officerObservations]); return c.json(r.rows[0]); });
app.post("/api/reports/:id/approve", auth, admin, async (c) => { const r = await pool.query("UPDATE reports SET status='approved',approved_at=NOW(),approved_by='admin' WHERE id=$1 RETURNING *", [c.req.param("id")]); return c.json(r.rows[0]); });
app.delete("/api/reports/:id", auth, admin, async (c) => { const id = c.req.param("id"); await pool.query("DELETE FROM vehicles WHERE report_id=$1",[id]); await pool.query("DELETE FROM persons WHERE report_id=$1",[id]); await pool.query("DELETE FROM witnesses WHERE report_id=$1",[id]); await pool.query("DELETE FROM reports WHERE id=$1",[id]); return c.json({success:true}); });

app.get("/api/reports/period/:period", auth, async (c) => { const period=c.req.param("period"); const now=new Date(); let s,e; if(period==="daily")s=e=now.toISOString().slice(0,10); else if(period==="weekly"){const d=new Date(now);d.setDate(d.getDate()-7);s=d.toISOString().slice(0,10);e=now.toISOString().slice(0,10)} else if(period==="monthly"){s=now.toISOString().slice(0,8)+"01";e=now.toISOString().slice(0,10)} else if(period==="quarterly"){const q=Math.floor(now.getMonth()/3);s=now.getFullYear()+"-"+String(q*3+1).padStart(2,"0")+"-01";e=now.toISOString().slice(0,10)} else if(period==="yearly"){s=now.getFullYear()+"-01-01";e=now.toISOString().slice(0,10)} else return c.json({error:"Invalid"},400); const r=await pool.query("SELECT * FROM reports WHERE date>=$1 AND date<=$2 ORDER BY date DESC",[s,e]); return c.json({period,startDate:s,endDate:e,stats:{total:r.rows.length},reports:r.rows}); });

app.get("/api/dashboard/stats", auth, async (c) => { const t=await pool.query("SELECT COUNT(*) as c FROM reports"); const sev=await pool.query("SELECT severity,COUNT(*) as count FROM reports GROUP BY severity"); return c.json({totalReports:parseInt(t.rows[0].c),bySeverity:Object.fromEntries(sev.rows.map(x=>[x.severity,parseInt(x.count)]))}); });
app.get("/api/audit", auth, async (c) => { const r = await pool.query("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 200"); return c.json(r.rows); });
app.get("/api/health", (c) => c.json({status:"ok",time:new Date().toISOString()}));

app.post("/api/seed", async (c) => {
  try {
    const stations = ["PND Headquarters","Balbala","Ambouli","Arta","Ali Sabieh","Dikhil","Tadjourah","Obock","Ali Adde","Holhol","Dorra","Mouddo","Randa","Goubetto","Kouta Bouyya"];
    for(const s of stations) await pool.query("INSERT INTO stations(name,region,active)VALUES($1,'Djibouti',true) ON CONFLICT DO NOTHING",[s]);
    
    const vTypes = ["Light Utility Vehicle (SUV / 4x4)","Passenger Car (Sedan / Hatchback)","Minibus (Up to 15 seats)","Bus (16+ seats)","Heavy Truck (Cargo / Container)","Tanker Truck (Fuel / Liquid)","Pickup Truck","Van (Cargo / Delivery)","Dump Truck","Cement Mixer","Tow Truck / Recovery","Ambulance","Fire Truck","Police Vehicle","Motorcycle","Bicycle","Forklift","Tractor / Agricultural","Trailer (Attached)","Semi-Trailer Truck (Articulated)","Camper / RV","Horse Float / Animal Transport","Garbage Truck","Street Sweeper","Crane Truck / Mobile Crane"];
    for(const v of vTypes) await pool.query("INSERT INTO vehicle_types(name,category,active)VALUES($1,'General',true) ON CONFLICT DO NOTHING",[v]);
    
    const insLocal = ["GXA Assurances","TRUST Assurance S.A.","AMSA Assurances","SOCOTEC","CNSS","Djibouti Insurance Company (DIC)","BCIMR Insurance","CAC International Bank Insurance","Saba Islamic Insurance"];
    for(const i of insLocal) await pool.query("INSERT INTO insurance_companies(name,category,type,active)VALUES($1,'Local','General',true) ON CONFLICT DO NOTHING",[i]);
    
    const insCross = ["AIG (American International Group)","AXA Group","Allianz Global","Zurich Insurance Group","Munich Re","Swiss Re","Lloyd's of London","CNP Assurances","Generali Group","Marsh McLennan","Aon plc","Willis Towers Watson"];
    for(const i of insCross) await pool.query("INSERT INTO insurance_companies(name,category,type,active)VALUES($1,'Cross-Border','International',true) ON CONFLICT DO NOTHING",[i]);
    
    const h = await bcrypt.hash("admin2025", 10);
    await pool.query("INSERT INTO officers(badge_number,auth_code,first_name,last_name,rank,station_id,status)VALUES('ADMIN',$1,'System','Administrator','admin',1,'active') ON CONFLICT DO NOTHING",[h]);
    
    return c.json({success:true,message:"Seeded"});
  } catch(e) { return c.json({error:e.message},500); }
});

// Static files
app.use("/*", async (c, next) => {
  if (c.req.path.startsWith("/api/")) return next();
  try {
    const fs = await import("fs");
    const fp = "./public" + (c.req.path === "/" ? "/index.html" : c.req.path);
    if (fs.existsSync(fp)) {
      const ext = fp.split(".").pop();
      const mt = {html:"text/html",js:"application/javascript",css:"text/css",jpg:"image/jpeg",png:"image/png",svg:"image/svg+xml"};
      c.header("Content-Type", mt[ext] || "application/octet-stream");
      return c.body(fs.readFileSync(fp));
    }
  } catch(e) {}
  return next();
});

const port = process.env.PORT || 3000;
serve({ fetch: app.fetch, port });
console.log("PND API running on port " + port);
