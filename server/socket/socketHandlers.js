const {
  toggleCheckbox,
  checkRateLimit,
  publishUpdate,
  subscribeToUpdates,
} = require("../redis/checkboxStore");

const connectedSockets = new Map();

function setupSocketHandlers(io) {

  subscribeToUpdates((data) => {

    io.emit("checkbox:updated", {
      index: data.index,
      value: data.value,
      userId: data.userId,
    });
  });

  io.on("connection", (socket) => {
    const user = socket.user;
    const userId = user?.sub || null;
    const isAuth = !!user;

    connectedSockets.set(socket.id, { userId, socket });
    console.log(`Socket connected: ${socket.id} | user: ${userId || "anonymous"}`);

    io.emit("users:count", { count: connectedSockets.size });

    socket.on("checkbox:toggle", async (data, ack) => {
      if (!isAuth) {
        if (ack) ack({ error: "Authentication required to toggle checkboxes" });
        return;
      }

      const { index } = data || {};
      const total = parseInt(process.env.TOTAL_CHECKBOXES || "500");

      if (typeof index !== "number" || index < 0 || index >= total || !Number.isInteger(index)) {
        if (ack) ack({ error: "Invalid checkbox index" });
        return;
      }

      const rlUser = await checkRateLimit(userId, "socket_toggle", 15, 1);
      if (!rlUser.allowed) {
        if (ack) ack({ error: "Too fast! Slow down.", remaining: rlUser.remaining });
        return;
      }

      const rlSocket = await checkRateLimit(socket.id, "socket_id_toggle", 20, 1);
      if (!rlSocket.allowed) {
        if (ack) ack({ error: "Socket rate limit exceeded" });
        return;
      }

      try {
        const newValue = await toggleCheckbox(index);

        await publishUpdate(index, newValue, userId);
        if (ack) ack({ success: true, index, value: newValue });
      } catch (err) {
        console.error("Socket toggle error:", err);
        if (ack) ack({ error: "Server error" });
      }
    });

    socket.on("ping", (ack) => {
      if (typeof ack === "function") ack({ ts: Date.now() });
    });

    socket.on("disconnect", (reason) => {
      connectedSockets.delete(socket.id);
      io.emit("users:count", { count: connectedSockets.size });
      console.log(`Socket disconnected: ${socket.id} (${reason})`);
    });

    socket.on("error", (err) => {
      console.error("Socket error:", socket.id, err);
    });
  });
}

module.exports = { setupSocketHandlers };
