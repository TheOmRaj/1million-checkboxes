const jwt = require("jsonwebtoken");
const fetch = require("node-fetch");
const jwkToPem = require("jwk-to-pem");

let cachedPublicKey = null;

async function getPublicKey() {
  if (cachedPublicKey) return cachedPublicKey;
  const OIDC_ISSUER = process.env.OIDC_ISSUER || "http://localhost:8000";
  const res = await fetch(`${OIDC_ISSUER}/.well-known/jwks.json`);
  const { keys } = await res.json();
  cachedPublicKey = jwkToPem(keys[0]);
  return cachedPublicKey;
}

async function verifyToken(token) {
  try {
    const publicKey = await getPublicKey();
    const payload = jwt.verify(token, publicKey, { algorithms: ["RS256"] });
    return payload;
  } catch {
    return null;
  }
}

async function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const payload = await verifyToken(auth.slice(7));
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  req.user = payload;
  next();
}

async function optionalAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    const payload = await verifyToken(auth.slice(7));
    req.user = payload || null;
  } else {
    req.user = null;
  }
  next();
}

async function socketAuthMiddleware(socket, next) {
  const token =
    socket.handshake.auth?.token ||
    socket.handshake.headers?.authorization?.replace("Bearer ", "");
  if (token) {
    const payload = await verifyToken(token);
    if (payload) {
      socket.user = payload;
      return next();
    }
  }
  socket.user = null;
  next();
}

module.exports = {
  verifyToken,
  requireAuth,
  optionalAuth,
  socketAuthMiddleware,
};
