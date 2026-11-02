require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { MongoClient, ObjectId } = require('mongodb');

const { MONGODB_URI, ADMIN_PASSWORD, TOKEN_SECRET, FRONTEND_URL } = process.env;
const PORT = process.env.PORT || 3000;
if (!MONGODB_URI || !ADMIN_PASSWORD || !TOKEN_SECRET) {
  console.error('Missing env: MONGODB_URI, ADMIN_PASSWORD, TOKEN_SECRET');
  process.exit(1);
}

const app = express();
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

let col;
const clean = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

app.get('/', (_, res) => res.send('Impression India API running'));

app.post('/api/enquiries', limit(10, 60 * 60 * 1000), async (req, res) => {
  const b = req.body || {};
  const name = clean(b.name, 100), phone = clean(b.phone, 25);
  if (!name || phone.replace(/\D/g, '').length < 10)
    return res.status(400).json({ error: 'name and valid phone required' });
  await col.insertOne({
    ts: Date.now(), name, phone,
    tour: clean(b.tour, 150), pax: clean(b.pax, 5),
    month: clean(b.month, 50), note: clean(b.note, 1000),
  });
  res.json({ ok: true });
});

app.post('/api/admin/login', limit(8, 15 * 60 * 1000), (req, res) => {
  const given = Buffer.from(String((req.body || {}).password || ''));
  const real = Buffer.from(ADMIN_PASSWORD);
  const ok = given.length === real.length && crypto.timingSafeEqual(given, real);
  ok ? res.json({ token: makeToken() }) : res.status(401).json({ error: 'wrong password' });
});

app.get('/api/enquiries', auth, async (_, res) => {
  const docs = await col.find().sort({ ts: -1 }).limit(2000).toArray();
  res.json(docs.map((d) => ({ ...d, id: String(d._id), _id: undefined })));
});

app.delete('/api/enquiries/:id', auth, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'bad id' });
  await col.deleteOne({ _id: new ObjectId(req.params.id) });
  res.json({ ok: true });
});

MongoClient.connect(MONGODB_URI).then((c) => {
  col = c.db().collection('enquiries');
  app.listen(PORT, () => console.log('API on ' + PORT));
}).catch((e) => { console.error(e); process.exit(1); });
