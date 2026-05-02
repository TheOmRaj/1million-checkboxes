const express = require("express");
const router = express.Router();

router.get("/login", (req, res) => {
  const OIDC_ISSUER = process.env.OIDC_ISSUER || "http://localhost:8000";
  const redirectUri = encodeURIComponent(
    process.env.OIDC_REDIRECT_URI || "http://localhost:3001/auth/callback"
  );
  res.redirect(`${OIDC_ISSUER}/o/authenticate?redirect_uri=${redirectUri}`);
});

router.get("/callback", async (req, res) => {
  const { token, error } = req.query;
  const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";
  if (error || !token) {
    return res.redirect(`${clientUrl}?auth_error=${error || "no_token"}`);
  }
  res.redirect(`${clientUrl}?token=${token}`);
});

router.get("/me", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return res.json({ user: null });
  }
  const { verifyToken } = require("../middleware/auth");
  const payload = await verifyToken(auth.slice(7));
  res.json({ user: payload || null });
});

router.post("/logout", (req, res) => {
  res.json({ success: true });
});

module.exports = router;
