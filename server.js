
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { MongoClient, ObjectId } = require('mongodb');

const {
  MONGODB_URI,
  ADMIN_PASSWORD,
  TOKEN_SECRET,
  FRONTEND_URL
} = process.env;

const PORT = process.env.PORT || 3000;

// Check required environment variables
if (!MONGODB_URI || !ADMIN_PASSWORD || !TOKEN_SECRET) {
  console.error('Missing environment variables:');
  console.error({
    MONGODB_URI: !!MONGODB_URI,
    ADMIN_PASSWORD: !!ADMIN_PASSWORD,
    TOKEN_SECRET: !!TOKEN_SECRET
  });
  process.exit(1);
}

// Express setup
const app = express();

app.use(express.json({ limit: '20kb' }));

app.use(cors({
  origin: FRONTEND_URL
    ? FRONTEND_URL.split(',').map(url => url.trim())
    : true
}));

app.get('/', (req, res) => {
  res.status(200).send('Impression India API running');
});

// Token security
const sign = (payload) =>
  crypto.createHmac('sha256', TOKEN_SECRET)
    .update(payload)
    .digest('hex');

function makeToken() {
  const exp = Date.now() + 12 * 60 * 60 * 1000;
  return exp + '.' + sign(String(exp));
}

function validToken(token) {
  const [exp, sig] = String(token || '').split('.');

  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < Date.now()) return false;

  const good = sign(exp);

  if (sig.length !== good.length) return false;

  return crypto.timingSafeEqual(
    Buffer.from(sig),
    Buffer.from(good)
  );
}

function auth(req, res, next) {
  const token = (req.headers.authorization || '')
    .replace(/^Bearer\s+/i, '');

  if (!validToken(token)) {
    return res.status(401).json({
      error: 'Unauthorized'
    });
  }

  next();
}

// Rate limiting
const hits = new Map();

function limit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip + req.path;
    const now = Date.now();

    const requests = (hits.get(key) || [])
      .filter(time => now - time < windowMs);

    if (requests.length >= max) {
      return res.status(429).json({
        error: 'Too many requests'
      });
    }

    requests.push(now);
    hits.set(key, requests);

    next();
  };
}

// Async error handler for Express 4
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Database
let col;

const clean = (value, maxLength) =>
  String(value == null ? '' : value)
    .trim()
    .slice(0, maxLength);

// Submit enquiry
app.post(
  '/api/enquiries',
  limit(10, 60 * 60 * 1000),
  asyncHandler(async (req, res) => {
    const body = req.body || {};

    const name = clean(body.name, 100);
    const phone = clean(body.phone, 25);

    if (!name || phone.replace(/\D/g, '').length < 10) {
      return res.status(400).json({
        error: 'Name and valid phone required'
      });
    }

    await col.insertOne({
      ts: Date.now(),
      name,
      phone,
      tour: clean(body.tour, 150),
      pax: clean(body.pax, 5),
      month: clean(body.month, 50),
      note: clean(body.note, 1000)
    });

    res.json({ ok: true });
  })
);

// Admin login
app.post(
  '/api/admin/login',
  limit(8, 15 * 60 * 1000),
  (req, res) => {
    const given = Buffer.from(
      String((req.body || {}).password || '')
    );

    const real = Buffer.from(ADMIN_PASSWORD);

    const ok =
      given.length === real.length &&
      crypto.timingSafeEqual(given, real);

    if (!ok) {
      return res.status(401).json({
        error: 'Wrong password'
      });
    }

    res.json({
      token: makeToken()
    });
  }
);

// Get all enquiries
app.get(
  '/api/enquiries',
  auth,
  asyncHandler(async (req, res) => {
    const docs = await col
      .find()
      .sort({ ts: -1 })
      .limit(2000)
      .toArray();

    res.json(
      docs.map(({ _id, ...doc }) => ({
        ...doc,
        id: String(_id)
      }))
    );
  })
);

// Delete enquiry
app.delete(
  '/api/enquiries/:id',
  auth,
  asyncHandler(async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        error: 'Invalid ID'
      });
    }

    await col.deleteOne({
      _id: new ObjectId(req.params.id)
    });

    res.json({ ok: true });
  })
);

// Global error handler
app.use((err, req, res, next) => {
  console.error('API ERROR:', err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: 'Internal server error'
  });
});

// MongoDB connection and server startup
const client = new MongoClient(MONGODB_URI, {
  serverSelectionTimeoutMS: 15000,
  connectTimeoutMS: 15000
});

async function startServer() {
  try {
    console.log('Connecting to MongoDB...');

    await client.connect();

    console.log('MongoDB Connected Successfully!');

    // Uses the database specified in your MongoDB URI
    const db = client.db();

    col = db.collection('enquiries');

    console.log('Database:', db.databaseName);
    console.log('Collection: enquiries');

    app.listen(PORT, '0.0.0.0', () => {
      console.log('================================');
      console.log('Impression India API is running');
      console.log('Port:', PORT);
      console.log('================================');
    });

  } catch (error) {
    console.error('================================');
    console.error('MONGODB CONNECTION FAILED');
    console.error('Error name:', error.name);
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    console.error('Full error:', error);
    console.error('================================');

    await client.close().catch(() => {});
    process.exit(1);
  }
}

startServer();
