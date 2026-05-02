# ☑ 500 Checkboxes

A real-time collaborative web app where up to millions of users can toggle a shared grid of 500 checkboxes — changes are reflected instantly across all connected clients.

## Live Demo
- Frontend: https://checkboxes-app-omraj.netlify.app
- Checkboxes API: https://generous-strength-production-13d9.up.railway.app
- Auth Server: https://1million-checkboxes-production.up.railway.app

---

## 🚀 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5 Canvas · CSS3 · Vanilla JavaScript |
| Backend | Node.js · Express |
| Real-time | Socket.IO (WebSockets) |
| State Storage | Redis (BITFIELD — 500 bits = 63B) |
| Pub/Sub | Redis Pub/Sub (multi-instance broadcast) |
| Auth | OIDC / OAuth 2.0 (Google) + JWT |

---

## ✨ Features Implemented

### Core
- 500 checkboxes rendered on an HTML5 Canvas (high-performance, no DOM elements per checkbox)
- Real-time toggle sync across all connected browser windows/users
- State persists in Redis — page refresh restores the latest state

### WebSocket
- Socket.IO connection with auth handshake
- `checkbox:toggle` event with server acknowledgement
- `checkbox:updated` broadcast to all clients on state change
- `users:count` event for live online user count
- Graceful reconnection with backoff

### Redis
- Checkbox state stored as a Redis bitfield string (`GETBIT` / `SETBIT`)  
  → 500 bits = **63 bytes** — extremely compact
- `BITCOUNT` for fast checked-count queries
- Redis **Pub/Sub** (`checkbox:updates` channel) to broadcast updates across multiple server instances
- Rate limiting via **sorted sets** (sliding window counter per user/socket)

### Rate Limiting (custom, no `express-rate-limit`)
- HTTP API: 10 toggles/second per authenticated user
- WebSocket: 15 toggles/second per user ID + 20/second per socket ID
- Client-side pre-check (15/second) to avoid unnecessary round-trips
- Visual warning indicator when rate limit is approached

### Authentication (OIDC / OAuth 2.0)
- Google as the OIDC provider (swap `OIDC_ISSUER` for any compliant provider)
- Authorization Code Flow with `openid email profile` scopes
- Server issues its own **JWT** after verifying the Google token
- JWT stored in `localStorage`, sent as `Authorization: Bearer <token>` header
- Socket.IO auth via `socket.handshake.auth.token`
- Anonymous users: read-only access (cannot toggle)

### Frontend
- **Canvas-based rendering** — only redraws dirty cells (changed checkboxes)
- Viewport / pagination — view any subset of the 500 grid
- Smooth scroll + page navigation
- Optimistic UI updates (instant toggle, revert on error)
- Flash animation when another user toggles a visible checkbox
- Hover tooltip showing checkbox number and state
- Responsive layout

---

## 🏗 Project Structure

```
checkboxes/
├── server/
│   ├── index.js                  # Express + Socket.IO entry point
│   ├── package.json
│   ├── .env.example
│   ├── middleware/
│   │   └── auth.js               # JWT, OIDC helpers, socket auth middleware
│   ├── routes/
│   │   ├── auth.js               # /auth/login, /auth/callback, /auth/me
│   │   └── checkboxes.js         # /api/checkboxes/* REST endpoints
│   ├── socket/
│   │   └── socketHandlers.js     # Socket.IO event handlers
│   └── redis/
│       └── checkboxStore.js      # All Redis operations (bits, rate limiting, pub/sub)
└── client/
    ├── index.html
    ├── style.css
    ├── app.js                    # Full frontend logic
    └── package.json
```

---

## ⚙️ Environment Variables

Copy `server/.env.example` to `server/.env` and fill in:

```env
# Server
PORT=3001
NODE_ENV=development

# Redis
REDIS_URL=redis://localhost:6379

# Google OAuth 2.0 (OIDC)
OIDC_CLIENT_ID=your_google_client_id
OIDC_CLIENT_SECRET=your_google_client_secret
OIDC_REDIRECT_URI=http://localhost:3001/auth/callback
OIDC_ISSUER=https://accounts.google.com

# JWT
JWT_SECRET=your_super_secret_jwt_key_change_this_in_production

# Frontend origin (for CORS)
CLIENT_URL=http://localhost:3000

# Optional
TOTAL_CHECKBOXES=1000000
```

---

## 🏃 How to Run Locally

### Prerequisites
- Node.js 18+
- Redis (running locally or via Docker)
- A Google Cloud project with OAuth 2.0 credentials

### 1. Start Redis

```bash
# Docker (easiest)
docker run -d -p 6379:6379 redis:alpine

# Or install locally
brew install redis && redis-server   # macOS
sudo apt install redis-server        # Ubuntu
```

### 2. Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project → APIs & Services → Credentials
3. Create **OAuth 2.0 Client ID** (Web application)
4. Add authorized redirect URI: `http://localhost:3001/auth/callback`
5. Copy Client ID and Secret to your `.env`

### 3. Start the Server

```bash
cd server
cp .env.example .env
# Edit .env with your values
npm install
npm run dev     # or npm start
```

### 4. Start the Frontend

```bash
cd client
npm install
npm run dev
# Open http://localhost:3000
```

---

## 🔌 Auth Flow

```
User clicks Login
      │
      ▼
GET /auth/login  ──► Redirects to Google OAuth consent
                              │
                              ▼ (user approves)
GET /auth/callback?code=...
      │
      ├── Exchange code for Google access token
      ├── Fetch user info from Google
      ├── Issue our own JWT (24h)
      └── Redirect to frontend with ?token=<jwt>
                              │
                              ▼
Frontend saves JWT to localStorage
Attaches it to all API requests + socket handshake
```

---

## 🌐 WebSocket Flow

```
Client connects → socket.handshake.auth.token verified
      │
User clicks checkbox
      │
socket.emit("checkbox:toggle", { index })
      │
Server validates:
  ├── Is user authenticated?
  ├── Is index valid?
  └── Rate limit check (user + socket)
      │
Redis SETBIT(index, newValue)
      │
Redis PUBLISH("checkbox:updates", { index, value, userId })
      │
All server instances receive via SUBSCRIBE
      │
io.emit("checkbox:updated", { index, value }) → every connected client
      │
Canvas redraws only the changed cell
```

---

## ⚡ Rate Limiting Design

Custom sliding-window rate limiter using Redis sorted sets:

```
Key:   ratelimit:{type}:{identifier}
Value: Sorted set — members are timestamps, score = timestamp

Algorithm:
1. Add current timestamp as new member
2. Remove all members older than the window
3. Count remaining members
4. If count > limit → reject
5. Set TTL on the key to auto-clean
```

No external packages like `express-rate-limit` are used.

---

## 📊 Scale Considerations

| Concern | Solution |
|---------|----------|
| 500 checkboxes in memory | Redis BITFIELD: 63B total |
| Multi-server broadcast | Redis Pub/Sub |
| Canvas performance | Dirty-cell redraws only |
| Initial load | Single base64 API call |
| Spam prevention | Sliding window rate limits (HTTP + WS) |
| Frontend rendering | Canvas (not DOM elements) |

---

## 📸 Screenshots / Demo

> See the demo video for live walkthrough of auth, checkbox toggling, and real-time sync.

---

## 📝 License

MIT
