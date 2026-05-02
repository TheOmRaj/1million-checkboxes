const { createClient } = require("redis");

let client;
let subscriber;
let publisher;

const CHECKBOX_KEY = "checkboxes:bits";
const TOTAL = parseInt(process.env.TOTAL_CHECKBOXES || "500");

async function getRedisClient() {
  if (!client) {
    client = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });
    client.on("error", (err) => console.error("Redis Client Error:", err));
    await client.connect();
    console.log("Redis connected");
  }
  return client;
}

async function getSubscriber() {
  if (!subscriber) {
    subscriber = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });
    subscriber.on("error", (err) => console.error("Redis Subscriber Error:", err));
    await subscriber.connect();
  }
  return subscriber;
}

async function getPublisher() {
  if (!publisher) {
    publisher = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });
    publisher.on("error", (err) => console.error("Redis Publisher Error:", err));
    await publisher.connect();
  }
  return publisher;
}

async function initCheckboxes() {
  const rc = await getRedisClient();
  const exists = await rc.exists(CHECKBOX_KEY);
  if (!exists) {

    const zeroBuf = Buffer.alloc(Math.ceil(TOTAL / 8), 0);
    await rc.set(CHECKBOX_KEY, zeroBuf);
    console.log(`Initialized ${TOTAL} checkboxes in Redis`);
  }
}

async function getCheckbox(index) {
  const rc = await getRedisClient();
  const result = await rc.getBit(CHECKBOX_KEY, index);
  return result === 1;
}

async function toggleCheckbox(index) {
  const rc = await getRedisClient();
  const current = await rc.getBit(CHECKBOX_KEY, index);
  const newVal = current === 1 ? 0 : 1;
  await rc.setBit(CHECKBOX_KEY, index, newVal);
  return newVal === 1;
}

async function setCheckbox(index, value) {
  const rc = await getRedisClient();
  await rc.setBit(CHECKBOX_KEY, index, value ? 1 : 0);
}

async function getAllCheckboxes() {
  const rc = await getRedisClient();
  const buf = await rc.getBuffer(CHECKBOX_KEY);
  return buf;
}

async function checkRateLimit(identifier, type, maxRequests, windowSeconds) {
  const rc = await getRedisClient();
  const key = `ratelimit:${type}:${identifier}`;

  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  const member = `${now}:${Math.random()}`;

  const pipeline = rc.multi();
  pipeline.zAdd(key, { score: now, value: member });
  pipeline.zRemRangeByScore(key, "-inf", windowStart);
  pipeline.zCard(key);
  pipeline.expire(key, windowSeconds + 1);

  const results = await pipeline.exec();
  const count = results[2];

  return {
    allowed: count <= maxRequests,
    count,
    remaining: Math.max(0, maxRequests - count),
  };
}

async function publishUpdate(index, value, userId) {
  const pub = await getPublisher();
  const message = JSON.stringify({ index, value, userId, ts: Date.now() });
  await pub.publish("checkbox:updates", message);
}

async function subscribeToUpdates(callback) {
  const sub = await getSubscriber();
  await sub.subscribe("checkbox:updates", (message) => {
    try {
      const data = JSON.parse(message);
      callback(data);
    } catch (e) {
      console.error("Failed to parse pub/sub message:", e);
    }
  });
}

async function getCheckedCount() {
  const rc = await getRedisClient();

  const count = await rc.bitCount(CHECKBOX_KEY);
  return count;
}

module.exports = {
  getRedisClient,
  initCheckboxes,
  getCheckbox,
  toggleCheckbox,
  setCheckbox,
  getAllCheckboxes,
  checkRateLimit,
  publishUpdate,
  subscribeToUpdates,
  getCheckedCount,
  TOTAL,
};
