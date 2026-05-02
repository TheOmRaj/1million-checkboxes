const express = require("express");
const router = express.Router();
const { requireAuth, optionalAuth } = require("../middleware/auth");
const {
  getAllCheckboxes,
  getCheckbox,
  toggleCheckbox,
  checkRateLimit,
  publishUpdate,
  getCheckedCount,
  TOTAL,
} = require("../redis/checkboxStore");

router.get("/state", async (req, res) => {
  try {
    const buf = await getAllCheckboxes();
    res.json({
      total: TOTAL,
      state: buf ? buf.toString("base64") : null,
      checkedCount: await getCheckedCount(),
    });
  } catch (err) {
    console.error("Error getting checkbox state:", err);
    res.status(500).json({ error: "Failed to get state" });
  }
});

router.get("/count", async (req, res) => {
  try {
    const count = await getCheckedCount();
    res.json({ checkedCount: count, total: TOTAL });
  } catch (err) {
    res.status(500).json({ error: "Failed to get count" });
  }
});

router.get("/:index", optionalAuth, async (req, res) => {
  const index = parseInt(req.params.index);
  if (isNaN(index) || index < 0 || index >= TOTAL) {
    return res.status(400).json({ error: "Invalid index" });
  }
  try {
    const value = await getCheckbox(index);
    res.json({ index, value });
  } catch (err) {
    res.status(500).json({ error: "Failed to get checkbox" });
  }
});

router.post("/:index/toggle", requireAuth, async (req, res) => {
  const index = parseInt(req.params.index);
  if (isNaN(index) || index < 0 || index >= TOTAL) {
    return res.status(400).json({ error: "Invalid index" });
  }

  const rl = await checkRateLimit(req.user.sub, "toggle", 10, 1);
  if (!rl.allowed) {
    return res.status(429).json({
      error: "Rate limit exceeded",
      remaining: rl.remaining,
      retryAfter: 1,
    });
  }

  try {
    const newValue = await toggleCheckbox(index);

    await publishUpdate(index, newValue, req.user.sub);
    res.json({ index, value: newValue });
  } catch (err) {
    console.error("Toggle error:", err);
    res.status(500).json({ error: "Failed to toggle checkbox" });
  }
});

module.exports = router;
