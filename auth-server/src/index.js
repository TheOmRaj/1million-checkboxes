require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const path = require("path");
const { Pool } = require("pg");
const JWT = require("jsonwebtoken");
const jose = require("node-jose");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT ?? 8000;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(express.json());
app.use(express.static(path.resolve("public")));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

function getPrivateKey() {
  return fs.readFileSync(path.resolve("cert/private-key.pem"));
}

function getPublicKey() {
  return fs.readFileSync(path.resolve("cert/public-key.pub"));
}

app.get("/", (req, res) => res.json({ message: "Hello from Auth Server" }));

app.get("/health", (req, res) =>
  res.json({ message: "Server is healthy", healthy: true })
);

app.get("/.well-known/openid-configuration", (req, res) => {
  const ISSUER = `https://${req.headers.host}`;
  return res.json({
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/o/authenticate`,
    userinfo_endpoint: `${ISSUER}/o/userinfo`,
    jwks_uri: `${ISSUER}/.well-known/jwks.json`,
  });
});

app.get("/.well-known/jwks.json", async (_, res) => {
  const publicKey = getPublicKey();
  const key = await jose.JWK.asKey(publicKey, "pem");
  return res.json({ keys: [key.toJSON()] });
});

app.get("/o/authenticate", (req, res) => {
  return res.sendFile(path.resolve("public", "authenticate.html"));
});

app.post("/o/authenticate/sign-in", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ message: "Email and password are required." });
    return;
  }

  const { rows } = await pool.query(
    "SELECT * FROM users WHERE email = $1 LIMIT 1",
    [email]
  );
  const user = rows[0];

  if (!user || !user.password || !user.salt) {
    res.status(401).json({ message: "Invalid email or password." });
    return;
  }

  const hash = crypto
    .createHash("sha256")
    .update(password + user.salt)
    .digest("hex");

  if (hash !== user.password) {
    res.status(401).json({ message: "Invalid email or password." });
    return;
  }

  const ISSUER = `https://${req.headers.host}`;
  const now = Math.floor(Date.now() / 1000);

  const claims = {
    iss: ISSUER,
    sub: user.id,
    email: user.email,
    email_verified: String(user.email_verified),
    exp: now + 3600,
    given_name: user.first_name ?? "",
    family_name: user.last_name ?? undefined,
    name: [user.first_name, user.last_name].filter(Boolean).join(" "),
    picture: user.profile_image_url ?? undefined,
  };

  const token = JWT.sign(claims, getPrivateKey(), { algorithm: "RS256" });
  res.json({ token });
});

app.post("/o/authenticate/sign-up", async (req, res) => {
  const { firstName, lastName, email, password } = req.body;

  if (!email || !password || !firstName) {
    res.status(400).json({ message: "First name, email, and password are required." });
    return;
  }

  const { rows: existing } = await pool.query(
    "SELECT id FROM users WHERE email = $1 LIMIT 1",
    [email]
  );

  if (existing.length > 0) {
    res.status(409).json({ message: "An account with this email already exists." });
    return;
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .createHash("sha256")
    .update(password + salt)
    .digest("hex");

  await pool.query(
    "INSERT INTO users (first_name, last_name, email, password, salt, email_verified) VALUES ($1, $2, $3, $4, $5, false)",
    [firstName, lastName || null, email, hash, salt]
  );

  res.status(201).json({ ok: true });
});

app.get("/o/userinfo", async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ message: "Missing or invalid Authorization header." });
    return;
  }

  const token = authHeader.slice(7);

  let claims;
  try {
    claims = JWT.verify(token, getPublicKey(), { algorithms: ["RS256"] });
  } catch {
    res.status(401).json({ message: "Invalid or expired token." });
    return;
  }

  const { rows } = await pool.query(
    "SELECT * FROM users WHERE id = $1 LIMIT 1",
    [claims.sub]
  );
  const user = rows[0];

  if (!user) {
    res.status(404).json({ message: "User not found." });
    return;
  }

  res.json({
    sub: user.id,
    email: user.email,
    email_verified: user.email_verified,
    given_name: user.first_name,
    family_name: user.last_name,
    name: [user.first_name, user.last_name].filter(Boolean).join(" "),
    picture: user.profile_image_url,
  });
});

app.listen(PORT, () => {
  console.log(`AuthServer is running on PORT ${PORT}`);
});
