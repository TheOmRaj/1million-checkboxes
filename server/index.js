require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const checkboxRoutes = require("./routes/checkboxes");
const { socketAuthMiddleware } = require("./middleware/auth");
const { setupSocketHandlers } = require("./socket/socketHandlers");
const { initCheckboxes } = require("./redis/checkboxStore");

const app = express();
const server = http.createServer(app);

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

app.use(cors({
  origin: CLIENT_URL,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

app.get("/health", (req, res) => res.json({ status: "ok", ts: Date.now() }));
app.use("/auth", authRoutes);
app.use("/api/checkboxes", checkboxRoutes);

app.use((req, res) => res.status(404).json({ error: "Not found" }));

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

const io = new Server(server, {
  cors: {
    origin: CLIENT_URL,
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

io.use(socketAuthMiddleware);

setupSocketHandlers(io);

const PORT = process.env.PORT || 3001;

async function start() {
  try {
    await initCheckboxes();
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Client URL: ${CLIENT_URL}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

start();
