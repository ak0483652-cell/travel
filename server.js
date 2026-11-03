require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

const { MONGODB_URI, FRONTEND_URL } = process.env;
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const TOKEN_SECRET = process.env.TOKEN_SECRET;
if (!ADMIN_PASSWORD || !TOKEN_SECRET) {
  console.error('Missing env: ADMIN_PASSWORD, TOKEN_SECRET');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));
app.use(cors({ origin: FRONTEND_URL ? FRONTEND_URL.split(',') : true }));

/* ---- tiny signed token (12h) ---- */
const sign = (p) => crypto.createHmac('sha256', TOKEN_SECRET).update(p).digest('hex');
function makeToken() {
  const exp = Date.now() + 12 * 3600 * 1000;
  return exp + '.' + sign(String(exp));
}
function validToken(t) {
  const [exp, sig] = String(t || '').split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = sign(exp);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}
function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  return validToken(t) ? next() : res.status(401).json({ error: 'unauthorized' });
}

/* ---- simple rate limit (per IP) ---- */
const hits = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    const k = req.ip + req.path, now = Date.now();
    const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'too many requests' });
    arr.push(now); hits.set(k, arr); next();
  };
}

/* ---- storage: MongoDB if MONGODB_URI is set, else local JSON file (for local testing) ---- */
let store;
function mongoStore(col) {
  return {
    insert: (doc) => col.insertOne(doc),
    list: async () => (await col.find().sort({ ts: -1 }).limit(2000).toArray())
      .map((d) => ({ ...d, id: String(d._id), _id: undefined })),
    remove: async (id) => {
      if (!ObjectId.isValid(id)) return false;
      await col.deleteOne({ _id: new ObjectId(id) });
      return true;
    },
  };
}
function fileStore(file) {
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return []; } };
  const write = (d) => fs.writeFileSync(file, JSON.stringify(d, null, 2));
  return {
    insert: async (doc) => { const d = read(); d.push({ ...doc, id: crypto.randomUUID() }); write(d); },
    list: async () => read().sort((a, b) => b.ts - a.ts),
    remove: async (id) => { write(read().filter((x) => x.id !== id)); return true; },
  };
}

const clean = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: 'server error' }); });

app.get('/health', (_, res) => res.send('Impression India API running'));

app.post('/api/enquiries', limit(10, 60 * 60 * 1000), wrap(async (req, res) => {
  const b = req.body || {};
  const name = clean(b.name, 100), phone = clean(b.phone, 25);
  if (!name || phone.replace(/\D/g, '').length < 10)
    return res.status(400).json({ error: 'name and valid phone required' });
  await store.insert({
    ts: Date.now(), name, phone,
    tour: clean(b.tour, 150), pax: clean(b.pax, 5),
    month: clean(b.month, 50), note: clean(b.note, 1000),
  });
  res.json({ ok: true });
}));

app.post('/api/admin/login', limit(8, 15 * 60 * 1000), (req, res) => {
  const given = Buffer.from(String((req.body || {}).password || ''));
  const real = Buffer.from(ADMIN_PASSWORD);
  const ok = given.length === real.length && crypto.timingSafeEqual(given, real);
  ok ? res.json({ token: makeToken() }) : res.status(401).json({ error: 'wrong password' });
});

app.get('/api/enquiries', auth, wrap(async (_, res) => res.json(await store.list())));

app.delete('/api/enquiries/:id', auth, wrap(async (req, res) => {
  if (!(await store.remove(req.params.id))) return res.status(400).json({ error: 'bad id' });
  res.json({ ok: true });
}));

/* ---- serve the website itself (local run; on Vercel the frontend is hosted separately) ---- */
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'index.html')));

async function start() {
  if (MONGODB_URI) {
    const c = await MongoClient.connect(MONGODB_URI);
    store = mongoStore(c.db().collection('enquiries'));
    console.log('Storage: MongoDB');
  } else {
    store = fileStore(path.join(__dirname, 'enquiries.json'));
    console.log('Storage: local file enquiries.json (set MONGODB_URI for production)');
  }
  app.listen(PORT, () => console.log('Site + API on http://localhost:' + PORT));
}
start().catch((e) => { console.error(e); process.exit(1); });
