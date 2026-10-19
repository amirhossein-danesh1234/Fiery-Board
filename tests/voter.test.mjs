import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initDatabase,createGame,makeServer} from '../server.mjs';

const ORIGIN='https://fiery-board.amirhossein-danesh.ir';
async function setup(count=3) {
  const dir=mkdtempSync(join(tmpdir(),'fiery-voter-'));
  const db=initDatabase(join(dir,'app.sqlite'));
  const created=createGame(db,{name:'جلسه آتشین',description:'',participants:['علی','سارا'],questions:[{text:'خلاقیت',weight:2}],voters:Array.from({length:count},(_,i)=>`رأی‌دهنده ${i+1}`),showIndividualVotes:false});
  const server=makeServer(db);
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function request(path,method='GET',body,session='') {
    const res=await fetch(base+path,{method,headers:{...(body?{'Content-Type':'application/json',Origin:ORIGIN}:{}),...(session?{Cookie:session}:{})},body:body?JSON.stringify(body):undefined});
    return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]||''};
  }
  const close=async()=>{await new Promise(r=>server.close(r));db.close();rmSync(dir,{recursive:true,force:true});};
  return {db,created,base,request,close};
}

test('voter page is public while room details require a unique session',async()=>{
  const t=await setup();try{
    const html=await fetch(t.base+'/vote');assert.equal(html.status,200);assert.match(await html.text(),/رأی‌دهنده/);
    assert.equal((await t.request('/api/voter/room')).status,401);
    assert.equal((await t.request('/api/voter/session')).data.authenticated,false);
    const bad=await t.request('/api/voter/login','POST',{code:'wrong'});assert.equal(bad.status,401);
    const wrongOrigin=await fetch(t.base+'/api/voter/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:JSON.stringify({code:t.created.codes[0].code})});assert.equal(wrongOrigin.status,403);
  }finally{await t.close();}
});

test('single active device, refresh recovery, logout and relogin',async()=>{
  const t=await setup(2);try{
    const token=t.created.codes[0].code;
    const login=await t.request('/api/voter/login','POST',{code:token});assert.equal(login.status,200);assert.ok(login.cookie.startsWith('fb_voter='));
    assert.equal((await t.request('/api/voter/session','GET',null,login.cookie)).data.authenticated,true);
    assert.equal((await t.request('/api/voter/login','POST',{code:token})).status,409);
    assert.equal((await t.request('/api/voter/login','POST',{code:token},login.cookie)).status,200);
    const room=await t.request('/api/voter/room','GET',null,login.cookie);assert.equal(room.data.status,'draft');assert.equal(room.data.onlineCount,1);
    assert.equal(room.data.voters[0].name,'رأی‌دهنده 1');
    assert.equal((await t.request('/api/voter/logout','POST',{},login.cookie)).status,200);
    assert.equal((await t.request('/api/voter/room','GET',null,login.cookie)).status,401);
    assert.equal((await t.request('/api/voter/login','POST',{code:token})).status,200);
  }finally{await t.close();}
});

test('automatic synchronized start when all distinct voters are present; persists start',async()=>{
  const t=await setup(4);try{
    const sessions=[];
    for(const {code} of t.created.codes){const a=await t.request('/api/voter/login','POST',{code});assert.equal(a.status,200);sessions.push(a.cookie);}
    const rooms=[];
    for(const cookie of sessions)rooms.push((await t.request('/api/voter/room','GET',null,cookie)).data);
    // All logins are already present before the first room poll; start must be immediate.
    assert.equal(rooms[0].status,'active');
    assert.equal(rooms.at(-1).status,'active');
    assert.equal(rooms.at(-1).onlineCount,4);
    assert.equal(rooms.at(-1).voters.filter(v=>v.online).length,4);
    assert.ok(t.db.prepare('SELECT started_at FROM games WHERE id=?').get(t.created.gameId).started_at);
    const refreshed=await t.request('/api/voter/room','GET',null,sessions[0]);assert.equal(refreshed.data.status,'active');
  }finally{await t.close();}
});

test('stale presence is not counted and allows safe takeover without double voting identity',async()=>{
  const t=await setup(2);try{
    const a=await t.request('/api/voter/login','POST',{code:t.created.codes[0].code});
    const b=await t.request('/api/voter/login','POST',{code:t.created.codes[1].code});
    t.db.prepare('UPDATE voter_sessions SET last_seen=? WHERE voter_id=(SELECT id FROM voters WHERE token_hash=?)').run(Date.now()-60_000,t.db.prepare('SELECT token_hash FROM voters WHERE name=?').get('رأی‌دهنده 1').token_hash);
    const r=await t.request('/api/voter/room','GET',null,b.cookie);assert.equal(r.data.status,'draft');assert.equal(r.data.onlineCount,1);
    const another=await t.request('/api/voter/login','POST',{code:t.created.codes[0].code});assert.equal(another.status,200);
    assert.equal((await t.request('/api/voter/session','GET',null,a.cookie)).data.authenticated,false);
    const after=await t.request('/api/voter/room','GET',null,another.cookie);assert.equal(after.data.status,'active');
  }finally{await t.close();}
});
