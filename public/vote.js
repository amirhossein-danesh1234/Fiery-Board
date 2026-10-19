const root=document.getElementById('voter-app');
const state={authenticated:false,busy:false,error:'',room:null,lastSync:null,fetching:false,scoreDraft:'',voteError:'',submitting:false};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fa=n=>Number(n||0).toLocaleString('fa-IR');
const icon=(name,size=21)=>{
  const paths={fire:'<path d="M12 22c4.5 0 7-3 7-7 0-3-2-5-3.5-7.5.2 3.8-2.1 4.5-3 4.7C13 8.2 9 6 9 2 7 5 5 8 5 12c0 5.5 2.8 10 7 10Z"/><path d="M12 22c2.3 0 3.5-1.7 3.5-4 0-1.8-1-3-2-4.3 0 2.3-2 2.4-3.1 4-.5.8-.6 2-.1 3 .4 1 1 1.3 1.7 1.3Z"/>',users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',lock:'<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',check:'<path d="m5 12 4 4L19 6"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',file:'<path d="M4 3h11l5 5v13H4zM14 3v6h6M8 14h8M8 18h6"/>',star:'<path d="m12 2 3 6 6.5 1-4.7 4.8 1.1 7-5.9-3.4-6 3.4 1.2-7L2.5 9 9 8z"/>',arrow:'<path d="M19 12H5m7-7-7 7 7 7"/>',exit:'<path d="M10 17l5-5-5-5M15 12H3M12 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-6"/>',info:'<circle cx="12" cy="12" r="10"/><path d="M12 11v6M12 7h.01"/>',refresh:'<path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/>',trophy:'<path d="M8 21h8m-4-4v4m-6-17h12v6a6 6 0 0 1-12 0V4Zm12 1h4v3a4 4 0 0 1-4 4M6 5H2v3a4 4 0 0 0 4 4"/>'};
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]||paths.info}</svg>`;
};
async function api(path,options={}) {
  const res=await fetch(path,{credentials:'same-origin',cache:'no-store',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
  let body={};try{body=await res.json();}catch{}
  if(!res.ok){const e=new Error(body.error||'ارتباط با سرور برقرار نشد.');e.status=res.status;throw e;}
  return body;
}
function frame(content){return `<div class="shell"><header class="header"><div class="brand"><div class="flame">${icon('fire',33)}</div><div><strong>تخته آتشین</strong><small>سیستم امتیازدهی گروهی</small></div></div><div class="header-right">${state.authenticated?`<span class="user-tag">${icon('users',17)} ${esc(state.room?.voterName||'رأی‌دهنده')}</span><button class="logout" id="logout" type="button">${icon('exit',17)} خروج</button>`:`<span class="user-tag">${icon('lock',17)} ورود رأی‌دهنده</span>`}</div></header>${content}<footer>تخته آتشین · رأی‌گیری گروهی هم‌زمان</footer></div>`;}
function loginView(){return frame(`<section class="panel login-panel"><div class="hero-icon">${icon('lock',28)}</div><h1>ورود رأی‌دهنده</h1><p class="subtitle">برای شرکت در بازی، کد دسترسی منحصربه‌فرد خود را وارد کنید.</p><form id="voter-login" class="login-form"><label for="access-code">کد دسترسی</label><input id="access-code" name="code" dir="ltr" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="FB-xxxxxxxxxxxxxxxxxxxxxxxx" required maxlength="40"/><button class="primary" ${state.busy?'disabled':''} type="submit">${state.busy?'در حال بررسی...':`ورود ${icon('arrow',20)}`}</button></form>${state.error?`<p class="error" role="alert">${esc(state.error)}</p>`:''}<div class="tip">${icon('info',19)} هر کد دسترسی مخصوص یک نفر است و فقط روی یک دستگاه در هر لحظه فعال می‌ماند.</div></section><section class="help"><span class="help-icon">${icon('lock',21)}</span><div><strong>کد خود را دریافت نکرده‌اید؟</strong><p>کد ورود را از برگزارکننده بازی بگیرید. نیازی به نام کاربری یا رمز عبور جداگانه نیست.</p></div></section>`);}
function waitView(){
  const room=state.room;
  if(!room)return frame(`<section class="panel loading-card"><div class="spinner"></div><h2>در حال دریافت وضعیت بازی...</h2>${state.error?`<p class="error" role="alert">${esc(state.error)}</p>`:''}</section>`);
  const begun=room.status==='active';
  const total=room.voterCount;
  const online=room.onlineCount;
  const percent=total ? Math.round(100*online/total):0;
  return frame(`<section class="panel room-panel"><div class="room-title"><div class="room-icon">${icon(begun?'trophy':'users',29)}</div><div><h1>${begun?'بازی آغاز شد!':'اتاق انتظار'}</h1><p>${begun?'همه رأی‌دهندگان در زمان شروع بازی حاضر بودند.':`خوش آمدید، ${esc(room.voterName)}. منتظر ورود همه رأی‌دهندگان بمانید.`}</p></div><div class="live">${icon('refresh',18)} بررسی خودکار هر ۵ ثانیه</div></div><div class="game-title">${esc(room.gameName)}</div><div class="stat-grid"><div class="stat blue">${icon('users',25)}<small>تعداد رأی‌دهندگان</small><strong>${fa(total)} نفر</strong></div><div class="stat green">${icon('check',26)}<small>حاضر در اتاق</small><strong>${fa(online)} نفر</strong></div><div class="stat sky">${icon('file',25)}<small>تعداد سؤالات</small><strong>${fa(room.questionCount)} سؤال</strong></div><div class="stat purple">${icon('star',26)}<small>در حال ارزیابی</small><strong>${fa(room.participantCount)} نفر</strong></div></div><div class="progress-heading"><strong>${fa(online)} نفر از ${fa(total)} رأی‌دهنده حاضرند</strong><span>${fa(percent)}٪</span></div><div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><div class="progress-fill" style="width:${percent}%"></div></div><h2 class="roster-heading">وضعیت رأی‌دهندگان</h2><div class="roster" role="list">${room.voters.map((v,i)=>`<div class="roster-row" role="listitem"><span class="roster-number">${fa(i+1)}</span><strong>${esc(v.name)}</strong><span class="presence ${v.online?'here':'away'}">${v.online?'● وارد شده':'● در انتظار ورود'}</span></div>`).join('')}</div><div class="banner ${begun?'success':'pending'}">${icon(begun?'check':'clock',23)}<span>${begun?'ورود همه کاربران تأیید شد. بخش امتیازدهی در صفحه بعدی محصول پیاده‌سازی خواهد شد.':'با حضور تمام رأی‌دهندگان، بازی به‌صورت خودکار آغاز خواهد شد.'}</span></div>${state.error?`<p class="error" role="alert">${esc(state.error)}</p>`:''}<p class="sync">${state.lastSync?'آخرین همگام‌سازی: '+new Date(state.lastSync).toLocaleTimeString('fa-IR'):'در حال دریافت اطلاعات'}</p></section>`);
}

function normalizeScore(raw){
  const value=String(raw??'').trim().replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)))
    .replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[٫,]/g,'.');
  if(!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value))return null;
  const n=Number(value);return Number.isFinite(n)&&n>=0&&n<=10?n:null;
}
function voteView(){
  const {stage,gameName}=state.room;
  if(!stage)return waitView();
  const p=stage.participant,q=stage.question;
  const peers=Array.from({length:Math.min(p.total,9)},(_,i)=>{
    const start=Math.max(0,Math.min(p.index-5,p.total-9));
    const pos=start+i+1;
    return '<span class="step-node '+(pos===p.index?'current':pos<p.index?'past':'')+'">'+fa(pos)+'</span>';
  }).join('');
  const done=stage.submitted;
  const percent=Math.round(100*(stage.currentStage+1)/stage.totalStages);
  return frame(`<section class="vote-progress"><div class="progress-pill">مرحله ${fa(stage.currentStage+1)} از ${fa(stage.totalStages)}<small>سؤال ${fa(q.index)} · نفر ${fa(p.index)}</small></div><div class="stepper">${peers}</div><div class="progress-pill">سؤال ${fa(q.index)} از ${fa(q.total)}<small>${esc(gameName)}</small></div></section><main class="panel score-panel"><span class="voting-tag">${done?'نمره ثبت شده':'در حال ارزیابی'}</span><div class="candidate-symbol">${icon('users',32)}</div><h1>${esc(p.name)}</h1><div class="question-box"><span>سؤال ${fa(q.index)}</span><strong>${esc(q.text)}</strong></div>${done?`<div class="submitted-state"><div class="success-mark">${icon('check',33)}</div><h2>نمره شما ثبت شد</h2><p>در انتظار ثبت نمره سایر رأی‌دهندگان</p><div class="vote-counter">${fa(stage.submittedCount)} از ${fa(stage.voterCount)} نفر ثبت کرده‌اند</div></div>`:`<form id="score-form"><label for="score">نمره شما (از ۰ تا ۱۰)</label><input id="score" name="score" type="text" inputmode="decimal" autocomplete="off" placeholder="مثلاً ۸٫۵" value="${esc(state.scoreDraft)}" aria-describedby="score-hint" required/><small id="score-hint">فقط عدد بین ۰ تا ۱۰ مجاز است؛ اعشار پذیرفته می‌شود.</small>${state.voteError?`<div class="error" role="alert">${esc(state.voteError)}</div>`:''}<button class="primary vote-submit" type="submit" ${state.submitting?'disabled':''}>${state.submitting?'در حال ثبت...':'ثبت قطعی نمره'}</button></form>`}<div class="score-note">${icon('info',21)}<span>پس از ثبت نمره امکان ویرایش آن وجود ندارد. تا تکمیل رأی همه کاربران، مرحله بعدی باز نمی‌شود.</span></div><div class="vote-footer">پیشرفت بازی: ${fa(percent)}٪ · بررسی وضعیت هر ۵ ثانیه</div></main>`);
}

function render(){
  if(!state.authenticated){root.innerHTML=loginView();return;}
  if(state.room?.status==='completed'||state.room?.stage?.completed){location.replace('/results');return;}
  root.innerHTML=state.room?.status==='active' && state.room.stage?.participant?voteView():waitView();
}
async function refresh(){
  if(!state.authenticated || state.fetching)return;
  state.fetching=true;
  try{const next=await api('/api/voter/room');
    const old=state.room?.stage;
    if(!old || next.stage?.currentStage!==old.currentStage) {state.scoreDraft='';state.voteError='';}
    const sameStep=old?.currentStage===next.stage?.currentStage;
    const sameCounts=old?.submittedCount===next.stage?.submittedCount && old?.submitted===next.stage?.submitted;
    const sameStatus=state.room?.status===next.status;
    state.room=next;state.error='';state.lastSync=Date.now();
    if(sameStep && sameCounts && sameStatus && next.status==='active' && !next.stage?.completed)return;
  }
  catch(e){if(e.status===401){state.authenticated=false;state.room=null;}state.error=e.message;}
  finally{state.fetching=false;render();}
}
root.addEventListener('submit',async e=>{
  if(e.target.id==='score-form'){
    e.preventDefault();
    if(state.submitting)return;
    const score=normalizeScore(e.target.elements.score.value);
    if(score===null){state.voteError='لطفاً یک عدد معتبر بین ۰ تا ۱۰ وارد کنید.';render();return;}
    state.submitting=true;state.voteError='';
    try{await api('/api/voter/submit',{method:'POST',body:JSON.stringify({step:state.room.stage.currentStage,score})});state.scoreDraft='';await refresh();}
    catch(err){state.voteError=err.message;await refresh();}
    finally{state.submitting=false;render();}
    return;
  }
  if(e.target.id!=='voter-login')return;
  e.preventDefault();
  const code=e.target.elements.code.value.trim();
  if(!code)return;
  state.busy=true;state.error='';
  try{await api('/api/voter/login',{method:'POST',body:JSON.stringify({code})});state.authenticated=true;state.room=null;await refresh();}
  catch(err){state.error=err.message;}
  finally{state.busy=false;render();}
});
root.addEventListener('input',e=>{if(e.target.id==='score')state.scoreDraft=e.target.value;});
root.addEventListener('click',async e=>{
  if(!e.target.closest('#logout'))return;
  try{await api('/api/voter/logout',{method:'POST',body:'{}'});}catch{}
  state.authenticated=false;state.room=null;state.error='';state.lastSync=null;render();
});
(async()=>{
  try{state.authenticated=(await api('/api/voter/session')).authenticated; if(state.authenticated)await refresh();else render();}
  catch(e){state.error=e.message;render();}
})();
setInterval(()=>{if(state.authenticated)refresh();},5000);
