import { createServer } from 'node:http';
import { initVoterTables, handleVoterApi } from './voter-service.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 3108);
const DB_PATH = process.env.DB_PATH || '/data/fiery-board.sqlite';
const ORIGIN = (process.env.PUBLIC_ORIGIN || 'https://fb-admin.amirhossein-danesh.ir').replace(/\/$/, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_AGE = 60 * 60 * 12;
const MAX_BODY = 512 * 1024;

export function validateGame(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('اطلاعات بازی نامعتبر است.');
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  if (name.length < 2 || name.length > 120 || description.length > 2000) throw new Error('نام بازی باید ۲ تا ۱۲۰ نویسه و توضیحات حداکثر ۲۰۰۰ نویسه باشد.');
  const validateNames = (list, title) => {
    if (!Array.isArray(list) || list.length < 1 || list.length > 500) throw new Error(`تعداد ${title} باید بین ۱ تا ۵۰۰ باشد.`);
    const values = list.map(item => typeof item === 'string' ? item.trim() : '');
    if (values.some(value => value.length < 1 || value.length > 100)) throw new Error(`نام ${title} معتبر نیست.`);
    if (new Set(values.map(v => v.toLocaleLowerCase('fa'))).size !== values.length) throw new Error(`نام تکراری در ${title} وجود دارد.`);
    return values;
  };
  const participants = validateNames(raw.participants, 'افراد');
  const voters = validateNames(raw.voters, 'رأی‌دهندگان');
  if (!Array.isArray(raw.questions) || raw.questions.length < 1 || raw.questions.length > 500) throw new Error('تعداد سؤال‌ها باید بین ۱ تا ۵۰۰ باشد.');
  const questions = raw.questions.map((question, i) => {
    const text = typeof question?.text === 'string' ? question.text.trim() : '';
    const weight = question?.weight;
    if (!text || text.length > 500 || typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0 || weight > 1000000) throw new Error(`متن یا وزن سؤال ${i + 1} معتبر نیست.`);
    return { text, weight };
  });
  return { name, description, participants, voters, questions, showIndividualVotes: raw.showIndividualVotes === true };
}

export function initDatabase(path) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
      show_votes INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      position INTEGER NOT NULL, name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      position INTEGER NOT NULL, text TEXT NOT NULL, weight REAL NOT NULL CHECK (weight>0)
    );
    CREATE TABLE IF NOT EXISTS voters (
      id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      position INTEGER NOT NULL, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
      joined_at TEXT
    );
    CREATE TABLE IF NOT EXISTS votes (
      game_id TEXT NOT NULL REFERENCES games(id), voter_id TEXT NOT NULL REFERENCES voters(id),
      participant_id TEXT NOT NULL REFERENCES participants(id), question_id TEXT NOT NULL REFERENCES questions(id),
      score REAL NOT NULL CHECK(score>=0 AND score<=10), created_at TEXT NOT NULL,
      PRIMARY KEY(game_id,voter_id,participant_id,question_id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      session_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_participants_game ON participants(game_id, position);
    CREATE INDEX IF NOT EXISTS idx_questions_game ON questions(game_id, position);
    CREATE INDEX IF NOT EXISTS idx_voters_game ON voters(game_id, position);
    CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
  `);
  initVoterTables(db);
  return db;
}

const uid = () => randomBytes(16).toString('hex');
const hash = value => createHash('sha256').update(value).digest('hex');
const stableCompare = (a, b) => {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
};
export function createGame(db, raw) {
  const game = validateGame(raw);
  const id = uid();
  const issuedCodes = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO games(id,name,description,show_votes,status,created_at) VALUES(?,?,?,?,?,?)').run(id, game.name, game.description, Number(game.showIndividualVotes), 'draft', new Date().toISOString());
    const personStmt = db.prepare('INSERT INTO participants(id,game_id,position,name) VALUES(?,?,?,?)');
    game.participants.forEach((name, i) => personStmt.run(uid(), id, i, name));
    const questionStmt = db.prepare('INSERT INTO questions(id,game_id,position,text,weight) VALUES(?,?,?,?,?)');
    game.questions.forEach((q, i) => questionStmt.run(uid(), id, i, q.text, q.weight));
    const voterStmt = db.prepare('INSERT INTO voters(id,game_id,position,name,token_hash) VALUES(?,?,?,?,?)');
    game.voters.forEach((name, i) => {
      const code = 'FB-' + randomBytes(18).toString('base64url');
      voterStmt.run(uid(), id, i, name, hash(code));
      issuedCodes.push({ name, code });
    });
    db.exec('COMMIT');
    return { gameId: id, codes: issuedCodes };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
export function listGames(db) {
  return db.prepare(`SELECT g.id,g.name,g.status,g.created_at AS createdAt,g.started_at AS startedAt,
    (SELECT COUNT(*) FROM participants p WHERE p.game_id=g.id) AS participantCount,
    (SELECT COUNT(*) FROM questions q WHERE q.game_id=g.id) AS questionCount,
    (SELECT COUNT(*) FROM voters v WHERE v.game_id=g.id) AS voterCount
    FROM games g ORDER BY g.created_at DESC`).all();
}
export function getGame(db, id) {
  const game = db.prepare('SELECT id,name,description,show_votes AS showIndividualVotes,status,created_at AS createdAt FROM games WHERE id=?').get(id);
  if (!game) return null;
  return {
    ...game, showIndividualVotes: Boolean(game.showIndividualVotes),
    participants: db.prepare('SELECT id,name FROM participants WHERE game_id=? ORDER BY position').all(id),
    questions: db.prepare('SELECT id,text,weight FROM questions WHERE game_id=? ORDER BY position').all(id),
    voters: db.prepare('SELECT id,name,joined_at AS joinedAt FROM voters WHERE game_id=? ORDER BY position').all(id),
    voteCount: db.prepare('SELECT COUNT(*) AS n FROM votes WHERE game_id=?').get(id).n
  };
}
function json(res, status, value, extra = {}) {
  const payload = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(payload);
}
function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'");
}
function parseCookies(value = '') {
  return Object.fromEntries(value.split(';').map(x => x.trim().split('=').slice(0,2)).filter(x => x[0]));
}
function loggedIn(db, req) {
  const token = parseCookies(req.headers.cookie).fb_session;
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return false;
  return Boolean(db.prepare('SELECT 1 FROM sessions WHERE session_hash=? AND expires_at>?').get(hash(token), Date.now()));
}
function readJSON(req) {
  return new Promise((resolveBody, reject) => {
    let chunks = [], size = 0, ended = false;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('حجم درخواست بیش از حد مجاز است.'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (ended) return;
      ended = true;
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('بدنه درخواست باید JSON معتبر باشد.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
const failedLogins = new Map();
function allowLogin(ip) {
  const now = Date.now();
  const attempt = failedLogins.get(ip);
  if (!attempt || now - attempt.since > 15 * 60 * 1000) { failedLogins.set(ip, { since: now, count: 0 }); return true; }
  return attempt.count < 10;
}
function failedLogin(ip) { const attempt = failedLogins.get(ip); if (attempt) attempt.count++; }
function cookie(value, secure) { return `fb_session=${value}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${value ? SESSION_AGE : 0}${secure ? '; Secure' : ''}`; }
const files = { '/': ['public/index.html', 'text/html; charset=utf-8'], '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'], '/styles.css': ['public/styles.css', 'text/css; charset=utf-8'], '/vote': ['public/vote.html', 'text/html; charset=utf-8'], '/vote.js': ['public/vote.js', 'text/javascript; charset=utf-8'], '/vote.css': ['public/vote.css', 'text/css; charset=utf-8'] };

export function makeServer(db) {
  return createServer(async (req, res) => {
    securityHeaders(res);
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const method = req.method;
    if (pathname === '/healthz') return json(res, 200, { ok: true });
    if (pathname.startsWith('/api/')) {
      if (!['GET', 'POST'].includes(method)) return json(res, 405, { error: 'روش درخواست پشتیبانی نمی‌شود.' });
      if (method === 'POST' && req.headers.origin !== ORIGIN) return json(res, 403, { error: 'مبدأ درخواست معتبر نیست.' });
      try {
        if (await handleVoterApi(db,req,res,pathname,readJSON,ORIGIN)) return;
        if (pathname === '/api/session' && method === 'GET') return json(res, 200, { authenticated: loggedIn(db, req) });
        if (pathname === '/api/login' && method === 'POST') {
          const ip = req.socket.remoteAddress || 'unknown';
          if (!allowLogin(ip)) return json(res, 429, { error: 'تعداد تلاش‌ها زیاد است. بعداً دوباره تلاش کنید.' });
          const body = await readJSON(req);
          if (typeof body.password !== 'string' || !stableCompare(body.password, ADMIN_PASSWORD)) {
            failedLogin(ip); return json(res, 401, { error: 'رمز عبور اشتباه است.' });
          }
          failedLogins.delete(ip);
          const token = randomBytes(32).toString('hex');
          db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
          db.prepare('INSERT INTO sessions(session_hash,expires_at) VALUES (?,?)').run(hash(token), Date.now() + SESSION_AGE*1000);
          return json(res, 200, { authenticated: true }, { 'Set-Cookie': cookie(token, ORIGIN.startsWith('https://')) });
        }
        if (!loggedIn(db, req)) return json(res, 401, { error: 'ابتدا وارد پنل مدیریت شوید.' });
        if (pathname === '/api/logout' && method === 'POST') {
          const token = parseCookies(req.headers.cookie).fb_session;
          if (token) db.prepare('DELETE FROM sessions WHERE session_hash=?').run(hash(token));
          return json(res, 200, { ok: true }, { 'Set-Cookie': cookie('', ORIGIN.startsWith('https://')) });
        }
        if (pathname === '/api/games' && method === 'GET') return json(res, 200, { games: listGames(db) });
        if (pathname === '/api/games' && method === 'POST') return json(res, 201, createGame(db, await readJSON(req)));
        const match = pathname.match(/^\/api\/games\/([a-f0-9]{32})$/);
        if (match && method === 'GET') {
          const game = getGame(db, match[1]);
          return game ? json(res, 200, { game }) : json(res, 404, { error: 'بازی پیدا نشد.' });
        }
        return json(res, 404, { error: 'مسیر پیدا نشد.' });
      } catch (e) {
        if (e.status === 413) return json(res, 413, { error: e.message });
        if (e.message && /معتبر|باید|تکراری|تعداد|نام بازی|حجم/.test(e.message)) return json(res, 400, { error: e.message });
        console.error('API error', e); return json(res, 500, { error: 'خطای داخلی سرور.' });
      }
    }
    if (method !== 'GET' && method !== 'HEAD') { res.writeHead(405); return res.end(); }
    const asset = files[pathname];
    if (!asset) { res.writeHead(404); return res.end('Not found'); }
    try {
      const data = readFileSync(join(root, asset[0]));
      res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': pathname === '/' ? 'no-cache' : 'public, max-age=300' });
      return res.end(method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(500); res.end('Unable to load app'); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12 || ADMIN_PASSWORD.startsWith('REPLACE_')) { console.error('Set ADMIN_PASSWORD (minimum 12 characters) before starting.'); process.exit(1); }
  const db = initDatabase(DB_PATH);
  makeServer(db).listen(PORT, '0.0.0.0', () => console.log(`Fiery Board admin listening on port ${PORT}`));
}
