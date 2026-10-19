import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initDatabase,createGame,makeServer} from '../server.mjs';
import {parseScore,submitVote,getStage,getResults} from '../game-engine.mjs';

const ORIGIN='https://fiery-board.amirhossein-danesh.ir';
function fixture(show=false) {
 const path=mkdtempSync(join(tmpdir(),'fiery-voting-'));
 const db=initDatabase(join(path,'game.sqlite'));
 const created=createGame(db,{name:'بازی تستی',description:'',participants:['علی','سارا'],questions:[{text:'خلاقیت',weight:3},{text:'نظم',weight:1}],voters:['مریم','رضا'],showIndividualVotes:show});
 const voters=db.prepare('SELECT id,name FROM voters WHERE game_id=? ORDER BY position').all(created.gameId);
 const gameId=created.gameId;
 db.prepare("UPDATE games SET status='active',started_at=? WHERE id=?").run(new Date().toISOString(),gameId);
 const finish=()=>{db.close();rmSync(path,{recursive:true,force:true});};
 return {db,created,voters,gameId,finish};
}

test('score parsing accepts decimals and Persian digits, rejects non-numbers and range errors',()=>{
 for(const raw of [0,10,8.25,'۸٫۵','7,5','٠٫٢٥'])assert.notEqual(parseScore(raw),null);
 for(const raw of ['','text',-0.01,10.1,'NaN','Infinity','1e1','1;2',null,{}])assert.equal(parseScore(raw),null);
});

test('atomic stage barriers, duplicate vote rejection and immutable votes',()=>{
 const t=fixture(true);try{
  const [a,b]=t.voters;const id=t.gameId;
  let stage=getStage(t.db,id,a.id);
  assert.equal(stage.currentStage,0);
  assert.equal(stage.participant.name,'علی');assert.equal(stage.question.text,'خلاقیت');
  assert.equal(submitVote(t.db,id,a.id,0,8.5).status,200);
  assert.equal(submitVote(t.db,id,a.id,0,9).status,409);
  assert.equal(submitVote(t.db,id,b.id,1,9).status,409);
  assert.equal(getStage(t.db,id,b.id).currentStage,0);
  assert.equal(submitVote(t.db,id,b.id,0,9).status,200);
  assert.equal(getStage(t.db,id,a.id).currentStage,1);
  assert.equal(submitVote(t.db,id,a.id,1,'11').status,400);
  assert.equal(t.db.prepare('SELECT score FROM votes WHERE voter_id=?').get(a.id).score,8.5);
  for(let step=1;step<4;step++){
   assert.equal(submitVote(t.db,id,a.id,step,step===1?7:10).status,200);
   assert.equal(submitVote(t.db,id,b.id,step,step===1?8:10).status,200);
  }
  assert.equal(getStage(t.db,id,a.id).status,'completed');
  assert.equal(t.db.prepare('SELECT status FROM games WHERE id=?').get(id).status,'completed');
  const report=getResults(t.db,id,null,true);
  assert.equal(report.counts.votes,8);
  assert.equal(report.counts.questions,2);
  assert.equal(report.questions[0].votes.length,2);
  assert.equal(report.ranking.find(p=>p.name==='علی').score,8.875);
 }finally{t.finish();}
});

test('privacy switch prevents disclosing individual votes while retaining aggregate scores',()=>{
 const t=fixture(false);try{
  for(let i=0;i<4;i++){for(const v of t.voters)assert.equal(submitVote(t.db,t.gameId,v.id,i,7.25).status,200);}
  const report=getResults(t.db,t.gameId,null,false);
  assert.equal(report.showIndividualVotes,false);
  assert.equal(report.questions[0].votes,undefined);
  assert.equal(report.ranking[0].score,7.25);
  const admin=getResults(t.db,t.gameId,null,true);
  assert.equal(admin.questions[0].votes.length,2);
 }finally{t.finish();}
});

test('voter submits using authenticated code; results are private until game completed',async()=>{
 const t=fixture(true),server=makeServer(t.db);
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const base='http://127.0.0.1:'+server.address().port;
 const request=async(path,method='GET',body,cookie='')=>{
  const res=await fetch(base+path,{method,headers:{...(body?{'Content-Type':'application/json','Origin':ORIGIN}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
  return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]||''};
 };
 try {
  assert.equal((await request('/api/voter/submit','POST',{step:0,score:8})).status,401);
  assert.equal((await request('/api/voter/results')).status,401);
  const cookies=[];
  for(const {code} of t.created.codes){const login=await request('/api/voter/login','POST',{code});assert.equal(login.status,200);cookies.push(login.cookie);}
  assert.equal((await request('/api/voter/results','GET',null,cookies[0])).status,409);
  for(let step=0;step<4;step++){
   for(let j=0;j<cookies.length;j++){
    const result=await request('/api/voter/submit','POST',{step,score:step+5+j},cookies[j]);
    assert.equal(result.status,200);
   }
  }
  const r=await request('/api/voter/results','GET',null,cookies[0]);
  assert.equal(r.status,200);
  assert.equal(r.data.report.counts.votes,8);
  const again=await request('/api/voter/submit','POST',{step:3,score:10},cookies[0]);
  assert.equal(again.status,409);
  const direct=await fetch(base+'/',{headers:{Host:'fiery-board.amirhossein-danesh.ir'}});
  assert.equal(direct.status,200);assert.match(await direct.text(),/ورود/);
 }finally{await new Promise(ok=>server.close(ok));t.finish();}
});
