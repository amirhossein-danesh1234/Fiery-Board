// Centralized, transactional game stages and score reporting.
export function initGameEngine(db) {
  const cols=db.prepare('PRAGMA table_info(games)').all();
  if(!cols.some(c=>c.name==='current_stage')) db.exec('ALTER TABLE games ADD COLUMN current_stage INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE INDEX IF NOT EXISTS idx_votes_stage ON votes(game_id,question_id,participant_id)');
}
const ordered=(db,table,gameId)=>db.prepare('SELECT * FROM '+table+' WHERE game_id=? ORDER BY position').all(gameId);
const formatScore=value=>Math.round((value+Number.EPSILON)*1000000)/1000000;
export function parseScore(raw) {
  if(typeof raw==='number') return Number.isFinite(raw)&&raw>=0&&raw<=10?raw:null;
  if(typeof raw!=='string') return null;
  const value=raw.trim().replace(/[۰-۹]/g,x=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(x)))
    .replace(/[٠-٩]/g,x=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(x))).replace(/[٫,]/g,'.');
  if(!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value))return null;
  const num=Number(value);
  return Number.isFinite(num)&&num>=0&&num<=10?num:null;
}
export function getStage(db,gameId,voterId) {
  const game=db.prepare('SELECT status,current_stage,name FROM games WHERE id=?').get(gameId);
  if(!game)return null;
  const people=ordered(db,'participants',gameId),qs=ordered(db,'questions',gameId);
  const total=people.length*qs.length;
  if(game.status==='completed')return {status:'completed',completed:true,totalStages:total,currentStage:total};
  if(game.status!=='active')return {status:game.status,completed:false,totalStages:total};
  const step=Math.min(game.current_stage,total);
  if(step>=total)return {status:'completed',completed:true,totalStages:total,currentStage:total};
  const person=people[step%people.length],question=qs[Math.floor(step/people.length)];
  const received=db.prepare('SELECT COUNT(*) AS n FROM votes WHERE game_id=? AND participant_id=? AND question_id=?').get(gameId,person.id,question.id).n;
  const own=db.prepare('SELECT score FROM votes WHERE game_id=? AND participant_id=? AND question_id=? AND voter_id=?')
    .get(gameId,person.id,question.id,voterId);
  const voters=db.prepare('SELECT COUNT(*) AS n FROM voters WHERE game_id=?').get(gameId).n;
  return {status:'active',completed:false,currentStage:step,totalStages:total,participant:{id:person.id,name:person.name,index:person.position+1,total:people.length},question:{id:question.id,text:question.text,weight:question.weight,index:question.position+1,total:qs.length},voterCount:voters,submittedCount:received,submitted:!!own};
}
export function submitVote(db,gameId,voterId,step,rawScore) {
  const score=parseScore(rawScore);
  if(score===null) return {status:400,error:'نمره باید عددی بین ۰ تا ۱۰ باشد؛ مقدار اعشاری نیز مجاز است.'};
  if(!Number.isSafeInteger(step)||step<0) return {status:400,error:'شماره مرحله نامعتبر است.'};
  db.exec('BEGIN IMMEDIATE');
  try {
    const current=getStage(db,gameId,voterId);
    if(!current||current.status!=='active') { db.exec('ROLLBACK');return {status:409,error:'بازی در وضعیت رأی‌گیری نیست.'}; }
    if(step!==current.currentStage){db.exec('ROLLBACK');return {status:409,error:'مرحله تغییر کرده است؛ صفحه را به‌روزرسانی کنید.'};}
    if(current.submitted){db.exec('ROLLBACK');return {status:409,error:'رأی این مرحله قبلاً ثبت شده و قابل ویرایش نیست.'};}
    db.prepare('INSERT INTO votes(game_id,voter_id,participant_id,question_id,score,created_at) VALUES(?,?,?,?,?,?)')
      .run(gameId,voterId,current.participant.id,current.question.id,score,new Date().toISOString());
    const count=db.prepare('SELECT COUNT(*) AS n FROM votes WHERE game_id=? AND question_id=? AND participant_id=?')
      .get(gameId,current.question.id,current.participant.id).n;
    if(count===current.voterCount) {
      const next=step+1;
      if(next>=current.totalStages) {
        db.prepare("UPDATE games SET current_stage=?,status='completed',completed_at=? WHERE id=? AND current_stage=? AND status='active'")
          .run(next,new Date().toISOString(),gameId,step);
      } else {
        db.prepare("UPDATE games SET current_stage=? WHERE id=? AND current_stage=? AND status='active'").run(next,gameId,step);
      }
    }
    db.exec('COMMIT');
    return {status:200,accepted:true,stage:getStage(db,gameId,voterId)};
  }catch(e){db.exec('ROLLBACK');throw e;}
}
export function getResults(db,gameId,participantId,showIndividualVotes) {
  const game=db.prepare('SELECT id,name,status,show_votes AS showVotes,created_at AS createdAt,completed_at AS completedAt FROM games WHERE id=?').get(gameId);
  if(!game)return null;
  if(game.status!=='completed')return {notReady:true};
  const participants=ordered(db,'participants',gameId);
  const questions=ordered(db,'questions',gameId);
  const voters=ordered(db,'voters',gameId);
  if(!participants.length||!questions.length||!voters.length) throw new Error('Game configuration incomplete.');
  const voteCount=db.prepare('SELECT COUNT(*) AS n FROM votes WHERE game_id=?').get(gameId).n;
  if(voteCount!==participants.length*questions.length*voters.length)throw new Error('Completed game vote count mismatch');
  const avgStmt=db.prepare('SELECT AVG(score) AS average FROM votes WHERE game_id=? AND participant_id=? AND question_id=?');
  const weightSum=questions.reduce((sum,q)=>sum+q.weight,0);
  const ranking=participants.map(p=>{
    const averages=questions.map(q=>Number(avgStmt.get(gameId,p.id,q.id).average));
    const finalScore=questions.reduce((sum,q,i)=>sum+averages[i]*q.weight,0)/weightSum;
    return {id:p.id,name:p.name,score:formatScore(finalScore),averages:averages.map(formatScore)};
  }).sort((a,b)=>b.score-a.score || a.name.localeCompare(b.name,'fa'));
  const selected=participants.find(p=>p.id===participantId)||participants[0];
  const showVotes=Boolean(showIndividualVotes);
  const rawStmt=db.prepare('SELECT voter_id,score FROM votes WHERE game_id=? AND participant_id=? AND question_id=?');
  const details=questions.map(q=>{
    const average=Number(avgStmt.get(gameId,selected.id,q.id).average);
    const row={id:q.id,number:q.position+1,text:q.text,weight:q.weight,average:formatScore(average),weighted:formatScore(average*q.weight)};
    if(showVotes) {
      const raw=rawStmt.all(gameId,selected.id,q.id);
      const map=new Map(raw.map(v=>[v.voter_id,v.score]));
      row.votes=voters.map(v=>({id:v.id,name:v.name,score:map.get(v.id)}));
    }
    return row;
  });
  return {game:{id:game.id,name:game.name,completedAt:game.completedAt},showIndividualVotes:showVotes,
    counts:{participants:participants.length,questions:questions.length,voters:voters.length,votes:voteCount},
    ranking,selectedParticipant:{id:selected.id,name:selected.name,score:ranking.find(p=>p.id===selected.id).score},
    questions:details,weightSum:formatScore(weightSum)};
}
