import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {request as httpRequest} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {initDatabase,createGame,getCodes,makeServer} from '../server.mjs';
import {submitVote,getResults} from '../game-engine.mjs';

const admin='https://fb-admin.amirhossein-danesh.ir', voter='https://fiery-board.amirhossein-danesh.ir';
const spec={name:'بازی آزمایشی',participants:['علی','سارا'],questions:[{text:'کیفیت',weight:3},{text:'دقت',weight:1}],voters:['داور اول','داور دوم']};
async function setup(){
 const dir=mkdtempSync(join(tmpdir(),'fiery-lifecycle-')),path=join(dir,'test.sqlite');
 const db=initDatabase(path),server=makeServer(db);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const token='a'.repeat(64);
 db.prepare('INSERT INTO sessions VALUES(?,?)').run(createHash('sha256').update(token).digest('hex'),Date.now()+60000);
 const request=(path,body,options={})=>new Promise((resolve,reject)=>{
  const req=httpRequest('http://127.0.0.1:'+server.address().port+path,{method:body===undefined?'GET':'POST',headers:{Host:options.host||'fb-admin.amirhossein-danesh.ir',Origin:options.origin||admin,'Content-Type':'application/json',Cookie:options.cookie??'fb_session='+token}},res=>{
   let text='';res.setEncoding('utf8');res.on('data',s=>text+=s);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(text),cookie:res.headers['set-cookie']?.[0]?.split(';')[0]}));
  });
  req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
 });
 return {dir,path,db,request,close:async()=>{await new Promise(r=>server.close(r));db.close();rmSync(dir,{recursive:true,force:true});}};
}
test('access codes persist encrypted and are retrievable only through authenticated admin routes',async()=>{
 const t=await setup();try{
  const g=createGame(t.db,spec);
  assert.deepEqual(getCodes(t.db,g.gameId),g.codes);
  const encrypted=t.db.prepare('SELECT code_encrypted FROM voters LIMIT 1').get().code_encrypted;
  assert.ok(!encrypted.includes(g.codes[0].code));
  const second=initDatabase(t.path);assert.deepEqual(getCodes(second,g.gameId),g.codes);second.close();
  assert.equal((await t.request(`/api/games/${g.gameId}/codes`,undefined,{cookie:''})).status,401);
  assert.equal((await t.request(`/api/games/${g.gameId}/codes`,undefined,{host:'fiery-board.amirhossein-danesh.ir'})).status,404);
  const codes=await t.request(`/api/games/${g.gameId}/codes`);assert.equal(codes.status,200);assert.deepEqual(codes.data.codes,g.codes);
 }finally{await t.close();}
});
test('five simultaneous games require a matching game and account code and stay isolated',async()=>{
 const t=await setup();try{
  const games=Array.from({length:5},()=>createGame(t.db,{...spec,voters:Array.from({length:8},(_,i)=>'داور '+i)}));
  assert.equal(new Set(games.map(g=>g.gameCode)).size,5);
  const opts={origin:voter,host:'fiery-board.amirhossein-danesh.ir',cookie:''};
  const bad=await t.request('/api/voter/login',{code:games[0].codes[0].code},opts);assert.equal(bad.status,401);
  assert.equal((await t.request('/api/voter/login',{code:games[0].codes[0].code,gameCode:games[1].gameCode},opts)).status,401);
  for(const g of games){
   let cookie;
   for(const {code} of g.codes){const r=await t.request('/api/voter/login',{code,gameCode:g.gameCode.toLowerCase()},opts);assert.equal(r.status,200);cookie=r.cookie;}
   const room=await t.request('/api/voter/room',undefined,{...opts,cookie});assert.equal(room.data.status,'active');assert.equal(room.data.gameId,g.gameId);
  }
 }finally{await t.close();}
});
test('legacy schema migration preserves game progress, ballots and account hashes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'fiery-migration-')),path=join(dir,'old.sqlite');
 let db=initDatabase(path);
 try {
  const g=createGame(db,spec),v=db.prepare('SELECT id,token_hash FROM voters WHERE game_id=?').get(g.gameId);
  db.prepare("UPDATE games SET status='active' WHERE id=?").run(g.gameId);
  assert.equal(submitVote(db,g.gameId,v.id,0,7.25).status,200);
  db.exec('DROP INDEX idx_game_code; ALTER TABLE games DROP COLUMN game_code; ALTER TABLE games DROP COLUMN resume_status; ALTER TABLE voters DROP COLUMN code_encrypted');
  db.close();db=initDatabase(path);
  assert.match(db.prepare('SELECT game_code FROM games WHERE id=?').get(g.gameId).game_code,/^[A-F0-9]{8}$/);
  assert.equal(db.prepare('SELECT score FROM votes WHERE game_id=?').get(g.gameId).score,7.25);
  assert.equal(db.prepare('SELECT token_hash FROM voters WHERE id=?').get(v.id).token_hash,v.token_hash);
  assert.equal(db.prepare('SELECT status FROM games WHERE id=?').get(g.gameId).status,'active');
  assert.ok(getCodes(db,g.gameId).every(c=>c.code===null));
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('rapid room polls do not write a presence timestamp on every request',async()=>{
 const t=await setup();try{
  const g=createGame(t.db,{...spec,voters:['داور']}),opts={origin:voter,host:'fiery-board.amirhossein-danesh.ir',cookie:''};
  const login=await t.request('/api/voter/login',{gameCode:g.gameCode,code:g.codes[0].code},opts);
  opts.cookie=login.cookie;
  await t.request('/api/voter/room',undefined,opts);
  const before=t.db.prepare('SELECT total_changes() AS n').get().n;
  for(let i=0;i<20;i++)assert.equal((await t.request('/api/voter/room',undefined,opts)).data.status,'active');
  assert.equal(t.db.prepare('SELECT total_changes() AS n').get().n,before);
 }finally{await t.close();}
});
test('pause rejects votes, resume preserves stage and scores; deletion cascades only the chosen game',async()=>{
 const t=await setup();try{
  const g=createGame(t.db,spec),other=createGame(t.db,spec);
  t.db.prepare("UPDATE games SET status='active' WHERE id=?").run(g.gameId);
  const voters=t.db.prepare('SELECT id FROM voters WHERE game_id=? ORDER BY position').all(g.gameId);
  assert.equal(submitVote(t.db,g.gameId,voters[0].id,0,8.5).status,200);
  assert.equal((await t.request(`/api/games/${g.gameId}/pause`,{})).status,200);
  assert.equal(submitVote(t.db,g.gameId,voters[1].id,0,9).status,409);
  assert.equal((await t.request(`/api/games/${g.gameId}/pause`,{})).status,409);
  assert.equal((await t.request(`/api/games/${g.gameId}/resume`,{})).data.game.status,'active');
  assert.equal(t.db.prepare('SELECT current_stage FROM games WHERE id=?').get(g.gameId).current_stage,0);
  assert.equal(submitVote(t.db,g.gameId,voters[1].id,0,9).status,200);
  for(let step=1;step<4;step++)for(const v of voters)assert.equal(submitVote(t.db,g.gameId,v.id,step,6).status,200);
  const report=getResults(t.db,g.gameId,null,false);
  assert.deepEqual(report.ranking.find(p=>p.name==='علی').averages,[8.75,6]);
  assert.equal(report.ranking.find(p=>p.name==='علی').score,8.0625);
  assert.ok(report.questions.every(q=>!q.votes));
  assert.equal((await t.request(`/api/games/${g.gameId}/delete`,{confirm:'wrong'})).status,400);
  assert.equal((await t.request(`/api/games/${g.gameId}/delete`,{confirm:g.gameId},{origin:'https://evil.test'})).status,403);
  assert.equal((await t.request(`/api/games/${g.gameId}/delete`,{confirm:g.gameId})).status,200);
  for(const table of ['votes','voters','participants','questions'])assert.equal(t.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE game_id=?`).get(g.gameId).n,0);
  assert.ok(t.db.prepare('SELECT id FROM games WHERE id=?').get(other.gameId));
  assert.equal(t.db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{await t.close();}
});
test('legacy codes are not fabricated; explicit reset invalidates old credentials and sessions',async()=>{
 const t=await setup();try{
  const g=createGame(t.db,spec);
  t.db.prepare('UPDATE voters SET code_encrypted=NULL WHERE game_id=?').run(g.gameId);
  assert.ok(getCodes(t.db,g.gameId).every(c=>c.code===null));
  const opts={origin:voter,host:'fiery-board.amirhossein-danesh.ir',cookie:''};
  const login=await t.request('/api/voter/login',{code:g.codes[0].code,gameCode:g.gameCode},opts);
  assert.equal(login.status,200);
  assert.equal((await t.request(`/api/games/${g.gameId}/reset-codes`,{})).status,400);
  const reset=await t.request(`/api/games/${g.gameId}/reset-codes`,{confirm:g.gameId});assert.equal(reset.status,200);
  assert.notEqual(reset.data.codes[0].code,g.codes[0].code);
  assert.equal((await t.request('/api/voter/login',{code:g.codes[0].code,gameCode:g.gameCode},opts)).status,401);
  assert.equal((await t.request('/api/voter/session',undefined,{...opts,cookie:login.cookie})).data.authenticated,false);
 }finally{await t.close();}
});
