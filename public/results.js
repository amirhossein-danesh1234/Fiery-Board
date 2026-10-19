
const app=document.getElementById('results-app');
const params=new URLSearchParams(location.search);
const admin=location.hostname==='fb-admin.amirhossein-danesh.ir'||params.get('admin')==='1';
const adminGame=params.get('game');
const state={report:null,selected:null,tab:'details',busy:false,error:''};
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fa=x=>Number(x||0).toLocaleString('fa-IR',{maximumFractionDigits:2});
const fmt=x=>Number(x).toLocaleString('fa-IR',{minimumFractionDigits:2,maximumFractionDigits:2});
const date=x=>x?new Intl.DateTimeFormat('fa-IR-u-ca-persian',{dateStyle:'short',timeStyle:'short'}).format(new Date(x)):'';
const draw=(name)=>({trophy:'🏆',check:'✓',user:'♟',group:'♣',question:'?',votes:'★',download:'↓',back:'←',table:'▦',eye:'◉'})[name]||'•';
const endpoint=participant=>admin?'/api/games/'+encodeURIComponent(adminGame)+'/results'+(participant?'?participant='+encodeURIComponent(participant):''):'/api/voter/results'+(participant?'?participant='+encodeURIComponent(participant):'');
async function api(url){
  const r=await fetch(url,{credentials:'same-origin',cache:'no-store'});let data={};
  try{data=await r.json();}catch{}
  if(!r.ok)throw new Error(data.error||'بارگذاری اطلاعات ناموفق بود.');
  return data.report;
}
const nav=()=>admin?'/':'/vote';
function header(){
 return '<header class="topbar"><div class="brand"><span class="flame">🔥</span><div><b>تخته آتشین</b><small>نتایج نهایی و جزئیات امتیازدهی</small></div></div><div class="head-actions"><a class="pill" href="'+nav()+'">'+draw('back')+' '+(admin?'بازگشت به صفحه ادمین':'بازگشت به بازی')+'</a><button class="pill emphasized" data-action="download">'+draw('download')+' دانلود نتایج</button></div></header>';
}
function ranking(){
 const r=state.report;
 return '<aside class="card ranking"><h2>▥ رتبه‌بندی نهایی</h2><p>بر اساس میانگین وزنی نمرات</p><div class="rank-list">'+r.ranking.map((person,i)=>
 '<button class="rank-row rank-'+i+(r.selectedParticipant.id===person.id?' selected':'')+'" data-action="select" data-id="'+esc(person.id)+'"><span class="medal">'+(i<3?['🏆','🥈','🥉'][i]:fa(i+1))+'</span><span class="rank-person"><b>'+esc(person.name)+'</b><span class="rank-track"><span style="width:'+Math.max(0,Math.min(100,person.score*10))+'%"></span></span></span><strong>'+fmt(person.score)+'</strong></button>'
 ).join('')+'</div></aside>';
}
function details(){
 const r=state.report;
 const votesAllowed=r.showIndividualVotes;
 return '<div class="table-scroll"><table><thead><tr><th>شماره</th><th>سؤال</th><th>وزن</th>'+ (votesAllowed?r.questions[0]?.votes.map(v=>'<th>'+esc(v.name)+'</th>').join(''):'')+'<th>میانگین</th><th>نمره وزنی</th></tr></thead><tbody>'+r.questions.map(q=>'<tr><td>'+fa(q.number)+'</td><td class="question-cell">'+esc(q.text)+'</td><td>'+fa(q.weight)+'</td>'+(votesAllowed?q.votes.map(v=>'<td>'+fmt(v.score)+'</td>').join(''):'')+'<td class="avg">'+fmt(q.average)+'</td><td class="weighted">'+fmt(q.weighted)+'</td></tr>').join('')+'<tr class="total-row"><td colspan="'+(3+(votesAllowed?r.counts.voters:0))+'">میانگین وزنی نهایی (مجموع وزن‌ها: '+fa(r.weightSum)+')</td><td colspan="2"><strong>'+fmt(r.selectedParticipant.score)+' از ۱۰</strong></td></tr></tbody></table></div>';
}
function rawVotes(){
 const r=state.report;
 if(!r.showIndividualVotes)return '<div class="privacy-message">مشاهده آرای فردی در تنظیمات این بازی غیرفعال است.</div>';
 const voters=r.questions[0]?.votes||[];
 return '<div class="table-scroll"><table><thead><tr><th>رأی‌دهنده</th>'+r.questions.map(q=>'<th title="'+esc(q.text)+'">سؤال '+fa(q.number)+'</th>').join('')+'</tr></thead><tbody>'+voters.map((v,i)=>'<tr><td class="question-cell">'+esc(v.name)+'</td>'+r.questions.map(q=>'<td>'+fmt(q.votes[i].score)+'</td>').join('')+'</tr>').join('')+'<tr class="total-row"><td>میانگین هر سؤال</td>'+r.questions.map(q=>'<td>'+fmt(q.average)+'</td>').join('')+'</tr></tbody></table></div>';
}
function content(){
 const r=state.report;
 if(!r)return '<div class="loading">'+esc(state.error||'در حال دریافت نتایج...')+'</div>';
 return header()+'<main class="wrap"><section class="completion"><div class="complete-description"><span class="checkmark">✓</span><div><strong>بازی با موفقیت به پایان رسید</strong><small>تمامی رأی‌ها ثبت و نتایج نهایی محاسبه شده‌اند.</small></div></div><div><b>'+esc(r.game.name)+'</b><small>'+date(r.game.completedAt)+'</small></div><span class="finished">پایان‌یافته</span></section>'
 +'<section class="stat-grid">'+[['تعداد افراد',r.counts.participants,'user'],['تعداد سؤالات',r.counts.questions,'question'],['تعداد رأی‌دهندگان',r.counts.voters,'group'],['تعداد کل آرا',r.counts.votes,'votes']].map(x=>'<div class="stat"><span class="stat-icon">'+draw(x[2])+'</span><span>'+x[0]+'</span><strong>'+fa(x[1])+'</strong></div>').join('')+'</section>'
 +'<div class="main-grid">'+ranking()+'<section class="card report"><div class="tabs"><button data-action="tab" data-tab="details" class="'+(state.tab==='details'?'current':'')+'">▦ جزئیات نمرات</button>'+(r.showIndividualVotes?'<button data-action="tab" data-tab="votes" class="'+(state.tab==='votes'?'current':'')+'">◉ مشاهده آرا</button>':'')+'</div><div class="subject"><div><span class="subject-avatar">'+esc(r.selectedParticipant.name.slice(0,1))+'</span><div><h2>'+esc(r.selectedParticipant.name)+'</h2><p>'+(state.tab==='votes'?'آرای ثبت‌شده برای این فرد':'نمره نهایی: '+fmt(r.selectedParticipant.score)+' از ۱۰')+'</p></div></div><label>انتخاب فرد<select id="subject-select">'+r.ranking.map(p=>'<option value="'+esc(p.id)+'" '+(r.selectedParticipant.id===p.id?'selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></label></div>'+(state.tab==='details'?details():rawVotes())+'</section></div>'
 +'<div class="info">ⓘ نمره نهایی هر فرد از میانگین وزنی سؤالات محاسبه می‌شود؛ تمام امتیازها بین ۰ تا ۱۰ هستند و پس از ثبت قابل تغییر نیستند.'+(!r.showIndividualVotes?'<br>هویت و آرای فردی رأی‌دهندگان برای این بازی نمایش داده نمی‌شود.':'')+'</div>'+ (state.error?'<p class="error">'+esc(state.error)+'</p>':'')+'</main>';
}
function render(){app.innerHTML=content();}
async function load(participant){
 state.busy=true;try{state.report=await api(endpoint(participant));state.selected=state.report.selectedParticipant.id;state.error='';}catch(e){state.error=e.message;}finally{state.busy=false;render();}
}
function csvEscape(v){return '"'+String(v??'').replace(/"/g,'""')+'"';}
async function download(){
 if(state.busy||!state.report)return;
 state.busy=true;
 try{
  const r=state.report, rows=[['بازی',r.game.name],['فرد','نمره نهایی'],...r.ranking.map(p=>[p.name,p.score]),[],['فرد','سؤال','وزن','میانگین','نمره وزنی',...(r.showIndividualVotes?r.questions[0].votes.map(v=>v.name):[])]];
  for(const person of r.ranking){
   const data=await api(endpoint(person.id));
   for(const q of data.questions)rows.push([person.name,q.text,q.weight,q.average,q.weighted,...(r.showIndividualVotes?q.votes.map(v=>v.score):[])]);
  }
  const text='\uFEFF'+rows.map(row=>row.map(csvEscape).join(',')).join('\r\n');
  const blob=new Blob([text],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='fiery-board-results-'+r.game.id+'.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch(e){state.error=e.message;render();}finally{state.busy=false;}
}
app.addEventListener('click',async e=>{
 const btn=e.target.closest('[data-action]');if(!btn||state.busy)return;
 if(btn.dataset.action==='tab'){state.tab=btn.dataset.tab;render();}
 if(btn.dataset.action==='select')await load(btn.dataset.id);
 if(btn.dataset.action==='download')await download();
});
app.addEventListener('change',async e=>{if(e.target.id==='subject-select'&&!state.busy)await load(e.target.value);});
if(admin&&!/^[a-f0-9]{32}$/.test(adminGame||'')){state.error='شناسه بازی معتبر نیست.';render();}
else load(null);
