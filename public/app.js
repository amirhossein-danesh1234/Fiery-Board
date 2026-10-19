const app = document.querySelector('#app');
const emptyGame = () => ({name:'', description:'', participants:['',''], questions:[{text:'',weight:'1'},{text:'',weight:'1'}], voters:['',''], showIndividualVotes:false});
const state = {auth:false, games:[], form:emptyGame(), search:'', filter:'all', busy:false, modal:null, error:'', message:''};
const icon = (name, size=20) => {
  const paths = {
    fire:'<path d="M12 22c4.5 0 7-3 7-7 0-3-2-5-3.5-7.5.2 3.8-2.1 4.5-3 4.7C13 8.2 9 6 9 2 7 5 5 8 5 12c0 5.5 2.8 10 7 10Z"/><path d="M12 22c2.3 0 3.5-1.7 3.5-4 0-1.8-1-3-2-4.3 0 2.3-2 2.4-3.1 4-.5.8-.6 2-.1 3 .4 1 1 1.3 1.7 1.3Z"/>',
    plus:'<path d="M12 5v14M5 12h14"/>', users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    user:'<circle cx="12" cy="8" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/>', clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
    list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    trash:'<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>',
    check:'<path d="m5 12 4 4L19 6"/>', chevron:'<path d="m15 18-6-6 6-6"/>',
    shield:'<path d="m12 22 8-4V6l-8-4-8 4v12l8 4Z"/><path d="m9 12 2 2 4-4"/>',
    copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    logout:'<path d="M10 17l5-5-5-5M15 12H3M12 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-6"/>',
    download:'<path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/>',
    info:'<circle cx="12" cy="12" r="10"/><path d="M12 11v6M12 7h.01"/>',
    lock:'<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    close:'<path d="M18 6 6 18M6 6l12 12"/>',
    game:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M8 12h4m-2-2v4M16 11h.01M18 13h.01"/>',
    edit:'<path d="m15 5 4 4M3 21l4-.5L20 7a2 2 0 0 0-3-3L4 17l-1 4Z"/>'
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.info}</svg>`;
};
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = n => Number(n||0).toLocaleString('fa-IR');
const date = iso => iso ? new Intl.DateTimeFormat('fa-IR-u-ca-persian',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(iso)) : '';
const statusTitle = {draft:'پیش‌نویس',active:'در حال اجرا',completed:'تکمیل‌شده',cancelled:'لغوشده'};
function notice(kind, text) { state[kind] = text; render(); }
async function api(path, options={}) {
  const res = await fetch(path,{credentials:'same-origin',...options, headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
  let body; try { body = await res.json(); } catch { body = {}; }
  if (!res.ok) { if (res.status===401 && path!=='/api/login') { state.auth=false; render(); } throw new Error(body.error || 'ارتباط با سرور ناموفق بود.'); }
  return body;
}
function brand() { return `<div class="brand"><div class="brand-icon">${icon('fire',29)}</div><div><strong>تخته آتشین</strong><span>سیستم امتیازدهی گروهی</span></div></div>`; }
function header() { return `<header class="topbar">${brand()}<div class="top-actions"><span class="top-tag">${icon('shield',17)} پنل مدیریت</span><button class="button ghost" data-action="logout">${icon('logout',18)} خروج</button></div></header>`; }
function login() {
  app.innerHTML=`<div class="login-layout"><div class="login-panel">${brand()}<div class="login-symbol">${icon('lock',32)}</div><h1>ورود به پنل مدیریت</h1><p>برای مدیریت بازی‌ها رمز عبور ادمین را وارد کنید.</p><form id="login-form"><label for="password">رمز عبور</label><input id="password" name="password" type="password" autocomplete="current-password" placeholder="رمز عبور مدیریت" required minlength="12" /><button class="button primary full" ${state.busy?'disabled':''} type="submit">${state.busy?'در حال بررسی...':'ورود به مدیریت'}</button></form>${state.error?`<div class="alert error" role="alert">${esc(state.error)}</div>`:''}</div></div>`;
}
function gameCard(game) {
  return `<button class="history-game" type="button" data-action="details" data-id="${esc(game.id)}"><div class="history-line"><strong>${esc(game.name)}</strong><span class="status ${esc(game.status)}">${statusTitle[game.status] || esc(game.status)}</span></div><small>${date(game.createdAt)}</small><div class="history-metrics"><span>${icon('user',15)} ${num(game.participantCount)} نفر</span><span>${icon('list',15)} ${num(game.questionCount)} سؤال</span><span>${icon('users',15)} ${num(game.voterCount)} رأی‌دهنده</span></div><span class="history-open">مشاهده جزئیات ${icon('chevron',16)}</span></button>`;
}
function peopleFields() { return state.form.participants.map((name,i)=>`<div class="editable-row"><span class="drag-dot">⋮⋮</span><span class="row-num">${num(i+1)}</span><input maxlength="100" aria-label="نام فرد ${i+1}" data-list="participants" data-index="${i}" value="${esc(name)}" placeholder="نام فرد" /><button class="icon-button danger" title="حذف فرد" aria-label="حذف فرد ${i+1}" data-action="remove" data-list="participants" data-index="${i}">${icon('trash',17)}</button></div>`).join(''); }
function questionFields() { return state.form.questions.map((q,i)=>`<div class="editable-row question-row"><span class="row-num">${num(i+1)}</span><input maxlength="500" aria-label="متن سؤال ${i+1}" data-list="questions" data-field="text" data-index="${i}" value="${esc(q.text)}" placeholder="متن سؤال" /><input class="weight-input" type="text" inputmode="decimal" aria-label="وزن سؤال ${i+1}" data-list="questions" data-field="weight" data-index="${i}" value="${esc(q.weight)}" /><button class="icon-button danger" title="حذف سؤال" aria-label="حذف سؤال ${i+1}" data-action="remove" data-list="questions" data-index="${i}">${icon('trash',17)}</button></div>`).join(''); }
function voterFields() { return state.form.voters.map((name,i)=>`<div class="voter-row"><span class="row-num">${num(i+1)}</span><input maxlength="100" aria-label="نام رأی‌دهنده ${i+1}" data-list="voters" data-index="${i}" value="${esc(name)}" placeholder="نام رأی‌دهنده" /><span class="token-placeholder">کد پس از ایجاد بازی تولید می‌شود</span><button class="icon-button danger" title="حذف رأی‌دهنده" aria-label="حذف رأی‌دهنده ${i+1}" data-action="remove" data-list="voters" data-index="${i}">${icon('trash',17)}</button></div>`).join(''); }
function history() {
  const games=state.games.filter(g=>(state.filter==='all'||state.filter===g.status) && g.name.toLocaleLowerCase('fa').includes(state.search.toLocaleLowerCase('fa')));
  return `<aside class="card history"><div class="history-heading"><div><h2>${icon('clock',23)} بازی‌های قبلی</h2><p>بازی‌های ذخیره‌شده و وضعیت آن‌ها</p></div><button class="button primary" data-action="new">${icon('plus',18)} بازی جدید</button></div><div class="history-controls"><label class="searchbox">${icon('search',18)}<input aria-label="جستجو در بازی‌ها" data-field="search" value="${esc(state.search)}" placeholder="جستجو در بازی‌ها..." /></label><select aria-label="فیلتر وضعیت بازی" data-field="filter"><option value="all" ${state.filter==='all'?'selected':''}>همه وضعیت‌ها</option>${Object.entries(statusTitle).map(([key,title])=>`<option value="${key}" ${state.filter===key?'selected':''}>${title}</option>`).join('')}</select></div><div id="history-results" class="history-results">${games.length?games.map(gameCard).join(''):`<div class="empty-state">${icon('game',35)}<strong>${state.games.length?'بازی مطابق جستجو پیدا نشد':'هنوز بازی‌ای ساخته نشده است'}</strong><p>${state.games.length?'فیلتر یا عبارت جستجو را تغییر دهید.':'اولین بازی خود را از فرم روبه‌رو بسازید.'}</p></div>`}</div></aside>`;
}
function sectionHeading(n,title,description,action,actionLabel) { return `<div class="section-heading"><div class="section-info"><span class="step">${num(n)}</span><div><h3>${title}</h3><p>${description}</p></div></div>${action?`<button class="button outline small" data-action="add" data-list="${action}">${icon('plus',17)} ${actionLabel}</button>`:''}</div>`; }
function form() {
  return `<main class="form-column"><div class="page-heading"><div class="heading-icon">${icon('edit',25)}</div><div><h1>ایجاد بازی جدید</h1><p>افراد، سؤالات، وزن‌ها و رأی‌دهندگان را مشخص کنید.</p></div></div><form id="game-form">
    <section class="card section">${sectionHeading(1,'اطلاعات کلی بازی','برای این بازی یک نام انتخاب کنید و توضیحاتی اضافه کنید.')}<div class="basic-grid"><label>نام بازی <b class="required">*</b><input name="name" maxlength="120" value="${esc(state.form.name)}" placeholder="مثلاً: ارزیابی نهایی اعضای تیم" required /></label><label>توضیحات (اختیاری)<textarea name="description" maxlength="2000" rows="2" placeholder="توضیحات مربوط به این بازی...">${esc(state.form.description)}</textarea></label></div></section>
    <div class="split-fields"><section class="card section compact">${sectionHeading(2,'افرادی که امتیاز می‌گیرند','اسامی افرادی که باید ارزیابی شوند.','participants','افزودن فرد')}<div class="field-list">${peopleFields()}</div></section><section class="card section compact">${sectionHeading(3,'سؤالات و وزن‌ها','متن سؤالات و وزن مثبت هر سؤال را مشخص کنید.','questions','افزودن سؤال')}<div class="question-columns"><span>شماره</span><span>متن سؤال</span><span>وزن</span></div><div class="field-list">${questionFields()}</div></section></div>
    <section class="card section voter-section">${sectionHeading(4,'رأی‌دهندگان','نام رأی‌دهندگان را وارد کنید؛ پس از ذخیره، کد ورود اختصاصی هر نفر فقط یک بار نمایش داده می‌شود.','voters','افزودن رأی‌دهنده')}<div class="voter-columns"><span>شماره</span><span>نام رأی‌دهنده</span><span>کد ورود</span></div><div class="field-list">${voterFields()}</div></section>
    <section class="card settings"><label class="toggle-line"><input type="checkbox" name="showIndividualVotes" ${state.form.showIndividualVotes?'checked':''}/><div><strong>نمایش جزئیات رأی هر کاربر در نتایج</strong><p>در صورت غیرفعال بودن، گزارش عمومی فقط میانگین‌ها و نمره نهایی را نشان می‌دهد.</p></div></label><div class="bottom-buttons"><button class="button outline" type="button" data-action="clear">${icon('trash',17)} پاک کردن همه</button><button class="button primary" type="submit" ${state.busy?'disabled':''}>${icon('plus',19)} ${state.busy?'در حال ذخیره...':'ایجاد بازی و تولید کدها'}</button></div></section>
  </form></main>`;
}
function modal() {
  if(!state.modal)return '';
  if(state.modal.type==='codes') {
    const {codes,gameId}=state.modal;
    return `<div class="overlay" role="presentation"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="dialog-heading"><h2 id="dialog-title">${icon('shield',23)} بازی با موفقیت ایجاد شد</h2><button class="icon-button" aria-label="بستن" data-action="close">${icon('close',21)}</button></div><p class="dialog-help">کدهای ورود فقط همین حالا نمایش داده می‌شوند و در دیتابیس به صورت هش ذخیره شده‌اند. قبل از بستن، آن‌ها را دانلود و به هر رأی‌دهنده به‌صورت خصوصی تحویل دهید.</p><div class="code-list">${codes.map((entry,i)=>`<div class="code-item"><span>${num(i+1)}. ${esc(entry.name)}</span><code dir="ltr">${esc(entry.code)}</code><button class="button outline small" data-action="copy" data-code="${esc(entry.code)}">${icon('copy',16)} کپی</button></div>`).join('')}</div><p class="dialog-help">آدرس ورود رأی‌دهندگان: <a href="/vote" target="_blank" rel="noopener">${esc(location.origin)}/vote</a> — این آدرس را همراه کد اختصاصی برای هر نفر ارسال کنید.</p><div class="dialog-footer"><button class="button outline" data-action="download">${icon('download',18)} دانلود CSV کدها</button><button class="button primary" data-action="close">متوجه شدم</button></div><small>شناسه بازی: <span dir="ltr">${esc(gameId)}</span></small></section></div>`;
  }
  const g=state.modal.game;
  return `<div class="overlay" role="presentation"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="dialog-heading"><h2 id="dialog-title">${esc(g.name)}</h2><button class="icon-button" aria-label="بستن" data-action="close">${icon('close',21)}</button></div><span class="status ${esc(g.status)}">${statusTitle[g.status]||esc(g.status)}</span>${g.description?`<p>${esc(g.description)}</p>`:''}<div class="detail-grid"><div><strong>افراد (${num(g.participants.length)})</strong>${g.participants.map(p=>`<span>${esc(p.name)}</span>`).join('')}</div><div><strong>سؤالات (${num(g.questions.length)})</strong>${g.questions.map(q=>`<span>${esc(q.text)} — وزن ${esc(q.weight)}</span>`).join('')}</div><div><strong>رأی‌دهندگان (${num(g.voters.length)})</strong>${g.voters.map(v=>`<span>${esc(v.name)}</span>`).join('')}</div></div><p class="note">کدهای ورود فقط به‌صورت هش ذخیره می‌شوند و متن اصلی آن‌ها در تاریخچه قابل بازیابی نیست. تعداد رأی‌های ثبت‌شده: ${num(g.voteCount)}.</p><div class="dialog-footer"><button class="button primary" data-action="close">بستن</button></div></section></div>`;
}
function render() {
  if(!state.auth){login();return;}
  app.innerHTML=`${header()}<div class="dashboard"><div class="content-layout">${form()}${history()}</div></div>${state.error?`<div class="toast error" role="alert">${esc(state.error)} <button data-action="dismiss">×</button></div>`:''}${state.message?`<div class="toast success" role="status">${esc(state.message)} <button data-action="dismiss">×</button></div>`:''}${modal()}`;
}
function renderHistory() {
  const current=document.getElementById('history-results');
  if(!current)return;
  const games=state.games.filter(g=>(state.filter==='all'||state.filter===g.status)&&g.name.toLocaleLowerCase('fa').includes(state.search.toLocaleLowerCase('fa')));
  current.innerHTML=games.length?games.map(gameCard).join(''):'<div class="empty-state">هیچ بازی‌ای مطابق فیلتر پیدا نشد.</div>';
}
function parseWeight(raw) {
  let s=String(raw).trim().replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[٫,]/g,'.');
  if(!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(s))return NaN;
  return Number(s);
}
function payload() {
  return {...state.form, name:state.form.name.trim(), description:state.form.description.trim(),participants:state.form.participants.map(v=>v.trim()),voters:state.form.voters.map(v=>v.trim()),questions:state.form.questions.map(q=>({text:q.text.trim(),weight:parseWeight(q.weight)}))};
}
function validateBeforeSubmit(data) {
  if(data.name.length<2)return 'نام بازی باید حداقل ۲ حرف باشد.';
  for(const [label, items] of [['افراد',data.participants],['رأی‌دهندگان',data.voters]]) {
    if(!items.length||items.some(x=>!x))return `تمام نام‌های ${label} را وارد کنید.`;
    if(new Set(items.map(x=>x.toLocaleLowerCase('fa'))).size!==items.length)return `نام تکراری در ${label} وجود دارد.`;
  }
  if(!data.questions.length||data.questions.some(q=>!q.text||!Number.isFinite(q.weight)||q.weight<=0))return 'متن سؤال‌ها و وزن مثبت معتبر را وارد کنید.';
  return '';
}
async function submitGame() {
  const data=payload(); const err=validateBeforeSubmit(data);
  if(err){notice('error',err);return;}
  state.busy=true; state.error='';render();
  try {
    const result=await api('/api/games',{method:'POST',body:JSON.stringify(data)});
    state.games=(await api('/api/games')).games;
    state.form=emptyGame();state.modal={type:'codes',...result};state.message='بازی جدید ذخیره شد.';
  }catch(e){state.error=e.message;}finally{state.busy=false;render();}
}
function downloadCodes() {
  const rows=[['Name','Access Code'],...state.modal.codes.map(e=>[e.name,e.code])];
  const text='\ufeff'+rows.map(cols=>cols.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\r\n');
  const blob=new Blob([text],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`fiery-board-codes-${state.modal.gameId}.csv`;a.click();URL.revokeObjectURL(url);
}
app.addEventListener('submit',async e=>{
  if(e.target.id==='login-form'){
    e.preventDefault();const password=e.target.elements.password.value;state.busy=true;state.error='';render();
    try{await api('/api/login',{method:'POST',body:JSON.stringify({password})});state.auth=true;state.games=(await api('/api/games')).games;}
    catch(err){state.error=err.message;}finally{state.busy=false;render();}
    return;
  }
  if(e.target.id==='game-form'){e.preventDefault();await submitGame();}
});
app.addEventListener('input',e=>{
  const el=e.target;
  if(el.dataset.field==='search'){state.search=el.value;renderHistory();return;}
  if(el.dataset.list){const idx=Number(el.dataset.index);if(el.dataset.list==='questions')state.form.questions[idx][el.dataset.field]=el.value;else state.form[el.dataset.list][idx]=el.value;return;}
  if(el.name==='name'||el.name==='description')state.form[el.name]=el.value;
});
app.addEventListener('change',e=>{if(e.target.name==='showIndividualVotes')state.form.showIndividualVotes=e.target.checked;if(e.target.dataset.field==='filter'){state.filter=e.target.value;renderHistory();}});
app.addEventListener('click',async e=>{
  const btn=e.target.closest('[data-action]');if(!btn)return;
  const action=btn.dataset.action;
  if(action==='add'){
    const list=btn.dataset.list;
    if(state.form[list].length>=500){notice('error','حداکثر ۵۰۰ مورد مجاز است.');return;}
    state.form[list].push(list==='questions'?{text:'',weight:'1'}:'');render();
  }
  if(action==='remove'){
    const list=btn.dataset.list;
    if(state.form[list].length<=1){notice('error','حداقل یک مورد ضروری است.');return;}
    state.form[list].splice(Number(btn.dataset.index),1);render();
  }
  if(action==='clear'){state.form=emptyGame();state.error='';render();}
  if(action==='new'){state.form=emptyGame();state.error='';window.scrollTo({top:0,behavior:'smooth'});render();}
  if(action==='dismiss'){state.error='';state.message='';render();}
  if(action==='close'){state.modal=null;render();}
  if(action==='download'){downloadCodes();}
  if(action==='copy'){try{await navigator.clipboard.writeText(btn.dataset.code);state.message='کد کپی شد.';render();}catch{notice('error','کپی ناموفق بود. کد را دستی انتخاب کنید.');}}
  if(action==='details'){
    try{const result=await api(`/api/games/${btn.dataset.id}`);state.modal={type:'details',game:result.game};render();}
    catch(err){notice('error',err.message);}
  }
  if(action==='logout'){
    try{await api('/api/logout',{method:'POST',body:'{}'});state.auth=false;state.modal=null;state.form=emptyGame();state.games=[];state.message='';state.error='';render();}catch(err){notice('error',err.message);}
  }
});
(async()=>{try{state.auth=(await api('/api/session')).authenticated;if(state.auth)state.games=(await api('/api/games')).games;}catch(e){state.error=e.message;}render();})();
