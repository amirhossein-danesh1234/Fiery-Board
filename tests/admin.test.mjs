import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, createGame, getGame, listGames, validateGame, makeServer } from '../server.mjs';

const example = () => ({
  name:'جشن پایان ترم',description:'دور اول',participants:['علی','سارا'],
  questions:[{text:'مسئولیت‌پذیری',weight:2.5},{text:'خلاقیت',weight:1}],
  voters:['نیما','محمد','رضا'],showIndividualVotes:false
});

test('validation handles variable counts and rejects duplicate names and invalid weights', () => {
  assert.equal(validateGame(example()).voters.length,3);
  assert.equal(validateGame({...example(),participants:['الف']}).participants.length,1);
  assert.throws(()=>validateGame({...example(),voters:['علی','علی']}),/تکراری/);
  assert.throws(()=>validateGame({...example(),questions:[{text:'X',weight:0}]}),/وزن/);
  assert.throws(()=>validateGame({...example(),questions:[{text:'X',weight:Infinity}]}),/وزن/);
});

test('database persists games and stores token hashes rather than plaintext codes', () => {
  const dir=mkdtempSync(join(tmpdir(),'fiery-board-test-'));
  try {
    const path=join(dir,'test.sqlite');let db=initDatabase(path);
    const created=createGame(db,example());
    assert.equal(created.codes.length,3);
    assert.equal(new Set(created.codes.map(x=>x.code)).size,3);
    assert.equal(listGames(db)[0].questionCount,2);
    assert.equal(getGame(db,created.gameId).participants.length,2);
    const stored=db.prepare('SELECT token_hash FROM voters LIMIT 1').get().token_hash;
    assert.equal(stored.length,64);assert.ok(!created.codes.some(c=>c.code===stored));
    db.close();db=initDatabase(path);
    assert.equal(listGames(db).length,1);
    db.close();
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('HTTP API requires an authenticated session and correct request origin', async () => {
  const dir=mkdtempSync(join(tmpdir(),'fiery-board-http-'));
  const db=initDatabase(join(dir,'test.sqlite'));
  const server=makeServer(db);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}`;
  try {
    const health=await fetch(url+'/healthz');assert.equal(health.status,200);
    const unauthorized=await fetch(url+'/api/games');assert.equal(unauthorized.status,401);
    const mismatch=await fetch(url+'/api/games',{method:'POST',headers:{Origin:'https://malicious.test','Content-Type':'application/json'},body:JSON.stringify(example())});
    assert.equal(mismatch.status,403);
    const html=await fetch(url+'/');assert.equal(html.status,200);assert.match(await html.text(),/تخته آتشین/);
  } finally {await new Promise(r=>server.close(r));db.close();rmSync(dir,{recursive:true,force:true});}
});
