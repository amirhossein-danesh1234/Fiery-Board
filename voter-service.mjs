import { randomBytes, createHash } from 'node:crypto';
import { getStage, submitVote, getResults } from './game-engine.mjs';

// A single active device per code. Presence expires quickly; the login cookie survives refreshes.
export const PRESENCE_MS = 45_000;
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const attempts = new Map();
const sha = value => createHash('sha256').update(value).digest('hex');
const voterCookie = (token, secure) => `fb_voter=${token}; HttpOnly; Path=/api/voter; SameSite=Strict; Max-Age=${token ? SESSION_MS / 1000 : 0}${secure ? '; Secure' : ''}`;
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split('=').slice(0, 2)).filter(x => x[0]));

export function initVoterTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS voter_sessions (
    voter_id TEXT PRIMARY KEY REFERENCES voters(id) ON DELETE CASCADE,
    session_hash TEXT NOT NULL UNIQUE, last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS idx_voter_presence ON voter_sessions(last_seen);`);
}

function respond(res, status, value, extra={}) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...extra });
  res.end(JSON.stringify(value));
}
function currentVoter(db, req) {
  const raw=cookies(req).fb_voter;
  if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
  return db.prepare(`SELECT v.id,v.name,v.game_id AS gameId,s.session_hash
    FROM voter_sessions s JOIN voters v ON v.id=s.voter_id
    WHERE s.session_hash=? AND s.expires_at>?`).get(sha(raw),Date.now()) || null;
}
function limited(ip, record=false) {
  const now=Date.now();
  if(attempts.size>5000) attempts.clear();
  const item=attempts.get(ip);
  if(!item || now-item.start>15*60*1000) {if(record)attempts.set(ip,{start:now,count:1});return false;}
  if(record)item.count++;
  return item.count>30;
}
function room(db,voter) {
  const now=Date.now();
  const minOnline=now-PRESENCE_MS;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE voter_sessions SET last_seen=?, expires_at=? WHERE voter_id=? AND session_hash=? AND last_seen<?')
      .run(now,now+SESSION_MS,voter.id,voter.session_hash,now-10000);
    const online=db.prepare(`SELECT COUNT(*) AS n FROM voter_sessions s JOIN voters v ON v.id=s.voter_id
       WHERE v.game_id=? AND s.last_seen>=? AND s.expires_at>?`).get(voter.gameId,minOnline,now).n;
    const total=db.prepare('SELECT COUNT(*) AS n FROM voters WHERE game_id=?').get(voter.gameId).n;
    if(online===total && total>0) {
      db.prepare("UPDATE games SET status='active',started_at=? WHERE id=? AND status='draft'")
        .run(new Date(now).toISOString(),voter.gameId);
    }
    const game=db.prepare('SELECT id,name,game_code AS gameCode,status,started_at AS startedAt FROM games WHERE id=?').get(voter.gameId);
    const participants=db.prepare('SELECT COUNT(*) AS n FROM participants WHERE game_id=?').get(voter.gameId).n;
    const questions=db.prepare('SELECT COUNT(*) AS n FROM questions WHERE game_id=?').get(voter.gameId).n;
    const voters=db.prepare(`SELECT v.name,CASE WHEN s.last_seen>=? AND s.expires_at>? THEN 1 ELSE 0 END AS online
      FROM voters v LEFT JOIN voter_sessions s ON s.voter_id=v.id WHERE v.game_id=? ORDER BY v.position`)
      .all(minOnline,now,voter.gameId).map(v=>({name:v.name,online:!!v.online}));
    db.exec('COMMIT');
    return {gameId:game.id,gameCode:game.gameCode,gameName:game.name,status:game.status,startedAt:game.startedAt,
      voterName:voter.name,voterCount:total,onlineCount:online,participantCount:participants,questionCount:questions,voters,
      stage:getStage(db,voter.gameId,voter.id)};
  } catch(e) {db.exec('ROLLBACK');throw e;}
}
export async function handleVoterApi(db,req,res,path,readJSON,origin) {
  if(!path.startsWith('/api/voter/')) return false;
  const method=req.method;
  if(method!=='GET' && method!=='POST') {respond(res,405,{error:'روش درخواست پشتیبانی نمی‌شود.'});return true;}
  if(method==='POST' && req.headers.origin!==origin) {respond(res,403,{error:'مبدأ درخواست معتبر نیست.'});return true;}
  const secure=origin.startsWith('https://');
  try {
    if(path==='/api/voter/login' && method==='POST') {
      const ip=req.socket.remoteAddress || 'unknown';
      if(limited(ip)) {respond(res,429,{error:'تعداد تلاش‌ها زیاد است. چند دقیقه بعد دوباره تلاش کنید.'});return true;}
      const body=await readJSON(req);
      const code=typeof body.code==='string' ? body.code.trim() : '';
      const gameCode=typeof body.gameCode==='string' ? body.gameCode.trim().toUpperCase() : '';
      if(!/^[A-F0-9]{8}$/.test(gameCode)) {limited(ip,true);respond(res,401,{error:'کد بازی و کد حساب معتبر را وارد کنید.'});return true;}
      if(!/^FB-[A-Za-z0-9_-]{24}$/.test(code)) {limited(ip,true);respond(res,401,{error:'کد ورود معتبر نیست.'});return true;}
      const voter=db.prepare('SELECT v.id,v.game_id FROM voters v JOIN games g ON g.id=v.game_id WHERE v.token_hash=? AND g.game_code=?').get(sha(code),gameCode);
      if(!voter) {limited(ip,true);respond(res,401,{error:'کد ورود معتبر نیست.'});return true;}
      const game=db.prepare('SELECT status FROM games WHERE id=?').get(voter.game_id);
      if(!game || !['draft','active','paused','completed'].includes(game.status)) {respond(res,409,{error:'این بازی برای ورود باز نیست.'});return true;}
      // Serialize login attempts so two different devices cannot both take the seat.
      db.exec('BEGIN IMMEDIATE');
      let token;
      try {
        const now=Date.now();
        const old=db.prepare('SELECT session_hash,last_seen,expires_at FROM voter_sessions WHERE voter_id=?').get(voter.id);
        const existing=cookies(req).fb_voter;
        const same=existing && old && old.session_hash===sha(existing) && old.expires_at>now;
        if(old && old.last_seen>=now-PRESENCE_MS && old.expires_at>now && !same) {
          db.exec('ROLLBACK');
          respond(res,409,{error:'این کد در دستگاه دیگری فعال است. برای ورود مجدد، پس از خروج یا گذشت حدود ۴۵ ثانیه از قطع اتصال دستگاه قبلی تلاش کنید.'});
          return true;
        }
        token=same ? existing : randomBytes(32).toString('hex');
        db.prepare(`INSERT INTO voter_sessions(voter_id,session_hash,last_seen,expires_at) VALUES(?,?,?,?)
          ON CONFLICT(voter_id) DO UPDATE SET session_hash=excluded.session_hash,last_seen=excluded.last_seen,expires_at=excluded.expires_at`)
          .run(voter.id,sha(token),now,now+SESSION_MS);
        db.prepare('UPDATE voters SET joined_at=COALESCE(joined_at,?) WHERE id=?').run(new Date(now).toISOString(),voter.id);
        db.exec('COMMIT');
      } catch(e) {db.exec('ROLLBACK');throw e;}
      respond(res,200,{authenticated:true},{'Set-Cookie':voterCookie(token,secure)});
      return true;
    }
    const voter=currentVoter(db,req);
    if(path==='/api/voter/session' && method==='GET') {
      respond(res,200,{authenticated:!!voter});return true;
    }
    if(!voter) {respond(res,401,{error:'برای ورود کد اختصاصی خود را وارد کنید.'});return true;}
    if(path==='/api/voter/room' && method==='GET') {respond(res,200,room(db,voter));return true;}
    if(path==='/api/voter/submit' && method==='POST') {
      const body=await readJSON(req);
      const result=submitVote(db,voter.gameId,voter.id,body.step,body.score);
      if(result.error) respond(res,result.status,{error:result.error});
      else respond(res,200,result);
      return true;
    }
    if(path==='/api/voter/results' && method==='GET') {
      const game=db.prepare('SELECT show_votes FROM games WHERE id=?').get(voter.gameId);
      const report=getResults(db,voter.gameId,new URL(req.url,'http://localhost').searchParams.get('participant'),Boolean(game?.show_votes));
      if(!report || report.notReady) respond(res,409,{error:'نتایج هنوز آماده نیستند.'});
      else respond(res,200,{report});
      return true;
    }
    if(path==='/api/voter/logout' && method==='POST') {
      db.prepare('DELETE FROM voter_sessions WHERE voter_id=? AND session_hash=?').run(voter.id,voter.session_hash);
      respond(res,200,{ok:true},{'Set-Cookie':voterCookie('',secure)});return true;
    }
    respond(res,404,{error:'مسیر پیدا نشد.'});return true;
  } catch(e) {
    if(e.status===413) respond(res,413,{error:e.message});
    else if(e.message && /JSON|بدنه/.test(e.message)) respond(res,400,{error:e.message});
    else {console.error('Voter API error',e);respond(res,500,{error:'خطای داخلی سرور.'});}
    return true;
  }
}
