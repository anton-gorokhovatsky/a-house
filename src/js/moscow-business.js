(function(){
  const root=document.querySelector('.ah-hero');
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Загрузите фото в Тильду и вставьте ссылки (https://static.tildacdn.com/...) вместо пустых строк.
  // Номера совпадают с именами файлов в папке photos.
  const IMGS=[
    "https://static.tildacdn.com/tila3166-6264-4337-b763-333836363761/DSCF1117_2.png", // 01-zal-tsvet.jpg
    "https://static.tildacdn.com/tila3736-3963-4561-b835-623736303733/DSCF7583_2_02_4.png", // 02-spiker.jpg
    "https://static.tildacdn.com/tila6536-6531-4963-b862-326632326136/DSC02693_resized_1.png", // 03-dve-devushki.jpg
    "https://static.tildacdn.com/tila3463-3466-4237-b330-373132343937/DSC00109_resized_1.png", // 04-prezentatsiya.jpg
    "https://static.tildacdn.com/tila3033-6334-4139-a632-343838373532/DSC09542_resized_1.png", // 05-divan-razgovor.jpg
    "https://static.tildacdn.com/tila3534-6232-4136-a136-396236643065/DSC02444_resized_1.png", // 07-lounge.jpg
    "https://static.tildacdn.com/tila3862-3932-4462-b135-313231393662/DSC07607_resized_1.png", // 09-kresla.jpg
    "https://static.tildacdn.com/tila6561-6237-4239-b635-313363613264/DSC02249_resized_1.png", // 06-zal-chb-ekran.jpg
    "https://static.tildacdn.com/tila3033-3932-4432-a635-656364633439/DSCF1127_2.png", // 08-derevyannaya-stena.jpg
    "https://static.tildacdn.com/tila3138-3335-4463-a238-353936643431/DSC09522_resized_1.png"  // 10-zal-chb.jpg
  ];
/* ---------- hero photos: плавное движение по траекториям ---------- */
  // фотографии стоят друг за другом на одном овале и вместе движутся по нему
  // [img index, ширина в % от ширины сцены, h/w] — порядок по овалу
  const RING=[[3,12.5,1.24],[7,12.4,1.24],[2,12.5,1.36],[5,18.8,.66],[1,12.6,1.34],[6,12.8,1.06],[0,18.7,.67],[8,12,1.27],[9,18.7,.67],[4,12.5,1.22]];
  const RINGMOB=[20,15,18,26,20,21,25.5,16,21.5,21];   // ширины для мобильной версии
  const stage=root.querySelector('#ah-stage');
  const els=RING.map(r=>{
    const d=document.createElement('div'); d.className='ph';
    d.innerHTML=`<img alt="" src="${IMGS[r[0]]}">`;
    stage.appendChild(d); return d;
  });
  let W=0,H=0,mobile=false,cx=0,cy=0,rx=0,ry=0,TILT=0,ARC=[0],OFF=[];
  function angleAt(f){ // f — доля пути 0..1 → угол
    f=((f%1)+1)%1; const L=ARC[ARC.length-1]*f; let lo=0,hi=ARC.length-1;
    while(hi-lo>1){const m=(lo+hi)>>1; if(ARC[m]<L)lo=m; else hi=m;}
    const k=(L-ARC[lo])/((ARC[hi]-ARC[lo])||1); return 2*Math.PI*(lo+k)/(ARC.length-1);
  }
  function measure(){
    mobile=matchMedia('(max-width:760px)').matches;
    const r=stage.getBoundingClientRect(); W=r.width; H=r.height;
    cx=W/2; cy=H*(mobile?.5:.48);
    rx=W*(mobile?.37:.35); ry=H*(mobile?.32:.31);
    TILT=(mobile?-24:-16)*Math.PI/180;   // наклон овала
    // таблица длины дуги — чтобы фотографии шли по овалу на равном расстоянии друг от друга
    ARC=[0]; const M=720;
    for(let i=1;i<=M;i++){const a0=2*Math.PI*(i-1)/M,a1=2*Math.PI*i/M;
      ARC.push(ARC[i-1]+Math.hypot(rx*(Math.cos(a1)-Math.cos(a0)),ry*(Math.sin(a1)-Math.sin(a0))));}
    els.forEach((el,k)=>{
      const w=(mobile?RINGMOB[k]:RING[k][1])/100*W*.85, h=w*RING[k][2];
      el.style.width=w+'px'; el.style.height=h+'px'; el._w=w; el._h=h;
    });
    OFF=els.map((el,k)=>k/els.length);
  }
  // равные промежутки между краями фото: в каждом кадре считаем, сколько места каждое фото
  // занимает вдоль овала в своей точке, и делим остаток длины поровну между фото
  function spread(){
    const L=ARC[ARC.length-1], cT=Math.cos(TILT), sT=Math.sin(TILT);
    for(let it=0;it<3;it++){
      const ext=els.map((el,k)=>{
        const a=angleAt(pos+OFF[k]);
        const tx=-Math.sin(a)*rx, ty=Math.cos(a)*ry;
        const gx=tx*cT-ty*sT, gy=tx*sT+ty*cT, n=Math.hypot(gx,gy)||1;
        return Math.abs(el._w*gx/n)+Math.abs(el._h*gy/n);
      });
      const gap=(L-ext.reduce((a,b)=>a+b,0))/els.length;
      let c=0; OFF=els.map((el,k)=>{ if(k) c+=ext[k-1]/2+gap+ext[k]/2; return c/L; });
    }
  }
  measure();
  // 1) при загрузке фото медленно проезжают небольшой участок овала и за 5 секунд плавно останавливаются
  // 2) дальше двигаются только от движения мыши по первому блоку и снова плавно тормозят
  const START=.75, INTRO=.04, DUR=5;
  const t0=performance.now();
  let pos=START, vel=0, last=t0, running=true;
  function placePhotos(){
    spread();
    const cT=Math.cos(TILT), sT=Math.sin(TILT);
    els.forEach((el,k)=>{
      const a=angleAt(pos + OFF[k]);
      const ex=Math.cos(a)*rx, ey=Math.sin(a)*ry;
      const x=cx + ex*cT - ey*sT - el._w/2;
      const y=cy + ex*sT + ey*cT - el._h/2;
      el.style.transform=`translate3d(${x}px,${y}px,0)`;
    });
  }
  function frame(now){
    const dt=Math.min(.05,(now-last)/1000); last=now;
    const t=(now-t0)/1000;
    if(t<DUR) pos=START + INTRO*Math.sin(t/DUR*Math.PI/2);
    else { pos+=vel*dt; vel*=Math.exp(-dt*1.6); }
    placePhotos();
    if(t<DUR || Math.abs(vel)>1e-5) requestAnimationFrame(frame); else running=false;
  }
  let px=null, py=null;
  root.querySelector('.hero').addEventListener('pointermove',e=>{
    if(reduce) return;
    if(px!==null && performance.now()-t0>DUR*1000){
      const d=Math.hypot(e.clientX-px,e.clientY-py);
      vel=Math.min(.03, vel + d*.00003);          // скорость — от длины движения мыши, с ограничением
      if(!running){ running=true; last=performance.now(); requestAnimationFrame(frame); }
    }
    px=e.clientX; py=e.clientY;
  });
  root.querySelector('.hero').addEventListener('pointerleave',()=>{px=py=null});
  addEventListener('resize',()=>{measure(); placePhotos();});
  if(reduce){ pos=START; placePhotos(); running=false; } else requestAnimationFrame(frame);
  placePhotos();
})();

(function(){
// Мероприятия. reg — ссылка на регистрацию (кнопка «Регистрация» в карточке и в раскрытой карточке),
// img — ссылка на картинку карточки (пусто = серая заглушка).
const EVENTS = [
  {date:"1 декабря, вторник 18:30", title:"Инновации в строительстве: от задачи девелопера до пилотного проекта",
   lead:"Презентация раздела «Инновации на A-Index»",
   desc:"Паблик-ток объединит девелоперов, архитекторов, продуктологов и технических директоров. Участники познакомятся с инновационными решениями из раздела A-Index и каталога МИК, обсудят актуальные задачи строительного рынка и подберут объекты для пилотного внедрения технологий.",
   reg:"https://a-housefest.timepad.ru/event/4321862/", img:"https://static.tildacdn.com/tila3139-6130-4436-b165-343365656566/Rectangle_26.png", spk:"Главстрой, ЛСР, ФСК"},
  {date:"11 декабря, пятница 18:30", title:"Иностранные таланты в Москве: как привлекать лучших специалистов",
   lead:"", desc:"Текст-заглушка: разговор о найме иностранных специалистов, городских программах поддержки и адаптации сотрудников.", reg:"https://a-housefest.timepad.ru/event/4322469/", img:"https://static.tildacdn.com/tila3531-3561-4430-a531-313035353063/Rectangle_25.png", spk:"уточняются"},
  {date:"14 декабря, понедельник 18:30", title:"Ритейл будущего: как роботы меняют магазины, склады и клиентский опыт",
   lead:"", desc:"Текст-заглушка: кейсы автоматизации складов и торговых залов, экономика роботизации и реакция покупателей.", reg:"https://a-housefest.timepad.ru/event/4324817/", img:"https://static.tildacdn.com/tila3661-3562-4136-b464-346263393333/Rectangle_24.png", spk:"уточняются"},
  {date:"18 декабря, пятница 18:30", title:"За место на полке: как бренду попасть в большой ритейл",
   lead:"", desc:"Текст-заглушка: требования сетей к поставщикам, переговоры о входе и первые полгода на полке.", reg:"https://a-housefest.timepad.ru/event/4322473/", img:"https://static.tildacdn.com/tila3863-3666-4231-b232-386537653535/Rectangle_23.png", spk:"уточняются"},
  {date:"23 декабря, среда 18:30", title:"Лонжевити: как на самом деле продлить жизнь и построить бизнес будущего",
   lead:"", desc:"Текст-заглушка: что говорит наука о долголетии и какие бизнес-модели складываются вокруг этого рынка.", reg:"https://a-housefest.timepad.ru/event/4322478/", img:"https://static.tildacdn.com/tila3732-3362-4463-a336-653236313139/Rectangle_22.png", spk:"уточняются"}
];

/* ---------- program cards ---------- */
const grid=document.getElementById('ah-grid');
EVENTS.forEach((e,i)=>{
  const c = document.createElement('article');
  c.className='card'; c.id='meeting-'+(i+1); c.dataset.i=i;
  c.innerHTML = `<div class="img"${e.img?` style="background:url(${e.img}) center/cover"`:''}></div><div class="meta caps">${e.date}</div><h3>${e.title}</h3> <button class="more caps" type="button">Подробнее</button><a class="btn caps" data-reg href="${e.reg||'#'}" target="_blank" rel="noopener">Регистрация</a>`;
  const more=c.querySelector('.more');
  more.setAttribute('aria-label','Подробнее: '+e.title);
  more.setAttribute('aria-haspopup','dialog');
  more.setAttribute('aria-controls','ah-modal');
  grid.appendChild(c);
});
grid.addEventListener('click',ev=>{
  const c = ev.target.closest('.card'); if(!c) return;
  if(ev.target.closest('[data-reg]')) return; // регистрация — не открывает карточку
  openModal(+c.dataset.i, c.querySelector('.more'));
});

/* ---------- modal: раскрывается из центра как папка ---------- */
const modal=document.getElementById('ah-modal'), overlay=document.getElementById('ah-overlay');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const previousContent = [
  document.querySelector('#allrecords > .landing-title'),
  document.querySelector('.ah-hero'),
  document.querySelector('.ah-program .program'),
  document.querySelector('.ah-archive')
];
let origin=null, timers=[], closing=false;
const later=(fn,ms)=>timers.push(setTimeout(fn,reduce?0:ms));
const clearT=()=>{timers.forEach(clearTimeout);timers=[]};
function place(){
  const r=modal.getBoundingClientRect();
  modal.style.left=Math.round((innerWidth-r.width)/2)+'px';
  modal.style.top=Math.round((innerHeight-r.height)/2)+'px';
  modal.style.setProperty('--half',(r.height/2)+'px');
}
function openModal(i,card){
  const e=EVENTS[i]; origin=card; clearT(); closing=false;
  document.getElementById('ah-m-meta').textContent=e.date;
  document.getElementById('ah-m-title').textContent=e.title;
  const lead=document.getElementById('ah-m-lead'); lead.textContent=e.lead; lead.style.display=e.lead?'':'none';
  document.getElementById('ah-m-desc').textContent=e.desc;
  document.getElementById('ah-m-spk').textContent='Спикеры: '+e.spk;
  document.getElementById('ah-m-reg').href=e.reg||'#';
  document.getElementById('ah-m-img').style.background=e.img?`url(${e.img}) center/cover`:'';
  document.body.classList.add('ah-lock');
  for (const section of previousContent) section.inert=true;
  modal.inert=false;
  overlay.classList.add('open');
  modal.classList.remove('drawn','split');
  modal.classList.add('open','instant');
  modal.querySelector('.modal-scroll').scrollTop=0;
  place();
  modal.offsetWidth;
  modal.classList.remove('instant');
  // 1) чёрные уголки появляются вместе в центре  2) расходятся вверх и вниз, открывая контент
  later(()=>modal.classList.add('drawn'),120);
  later(()=>modal.classList.add('split'),420);
  document.getElementById('ah-m-close').focus({preventScroll:true});
}
function closeModal(){
  if(modal.inert || closing) return;
  closing=true;
  clearT();
  // обратный порядок: уголки сходятся к центру, затем схлопываются
  modal.classList.remove('split');
  later(()=>modal.classList.remove('drawn'),650);
  later(()=>overlay.classList.remove('open'),800);
  later(()=>{
    modal.classList.remove('open');
    modal.removeAttribute('style');
    document.body.classList.remove('ah-lock');
    modal.inert=true;
    for (const section of previousContent) section.inert=false;
    origin?.focus({preventScroll:true});
  },1000);
}
addEventListener('resize',()=>{if(modal.classList.contains('open'))place()});
document.getElementById('ah-m-close').onclick=closeModal;
overlay.onclick=closeModal;
addEventListener('keydown',e=>{
  if(modal.inert) return;
  if(e.key==='Escape') closeModal();
  if(e.key!=='Tab') return;
  const controls=[...modal.querySelectorAll('button, a[href]')];
  const first=controls.at(0), last=controls.at(-1);
  if(e.shiftKey ? document.activeElement===first : document.activeElement===last){
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  }
});


})();

(function(){
// Архив: [дата, тип, название, описание (необязательно), спикеры (необязательно)]
const PLACEHOLDER = "Текст-заглушка: краткое описание встречи появится здесь.";
const ARCHIVE = [
  ["08.10","дискуссия","Мировые рынки ближе, чем кажется: экспортируй высокотехнологичные решения с поддержкой города"],
  ["05.11","дискуссия","Искусство дарить: культура подарков в России"],
  ["09.11","дискуссия","Как российские косметические бренды завоевывают рынок"],
  ["20.11","дискуссия","Первые этажи новостроек: как выбрать арендаторов и сервисы",
   "На встрече обсудим, как размещать на первых этажах жилых комплексов кафе и нужные жителям сервисы, а также как подбирать помещения для франшиз. Представители МБМ расскажут об инструменте «Оценка потенциала локации» и других сервисах, которые помогают выбрать подходящее место и формат бизнеса.",
   "Амир Идиатуллин (IND), Амир Идиатуллин (IND), Амир Идиатуллин (IND)"],
  ["23.11","дискуссия","Соседи по цеху: каким должен быть кластер индустрии интерьера"],
  ["24.11","дискуссия","Анатомия доходности: от пассивных вкладов к умным сделкам"],
  ["26.11","дискуссия","Технопарк глазами собственника: зачем девелоперу этот формат"],
  ["30.11","бизнес-завтрак","Архитектура индустриальных объектов: как спроектировать технопарк, который нужен резидентам"],
  ["04.12","дискуссия","Оформление Москвы к лету 2027"],
  ["07.12","бизнес-завтрак","Итоги 2026 года в индустриальной недвижимости"]
];

/* ---------- archive ---------- */
const arc=document.getElementById('ah-arc');
ARCHIVE.forEach((a,i)=>{
  const li=document.createElement('li'); li.className='arc-item';
  li.innerHTML=`<button class="arc-row caps" aria-expanded="false" aria-controls="ah-ab${i}"> <span class="d">${a[0]}</span><span class="ty">${a[1]}</span><span class="t">${a[2]}</span><span class="pm" aria-hidden="true">+</span></button> <div class="arc-body" id="ah-ab${i}"><div><div class="arc-inner"><p>${a[3]||PLACEHOLDER}</p><p>Спикеры: ${a[4]||'уточняются'}</p></div></div></div> <i class="cn tr"></i><i class="cn bl"></i>`;
  arc.appendChild(li);
});
arc.addEventListener('click',e=>{
  const btn=e.target.closest('.arc-row'); if(!btn) return;
  const li=btn.parentElement, willOpen=!li.classList.contains('open');
  arc.querySelectorAll('.arc-item.open').forEach(x=>{x.classList.remove('open');x.firstElementChild.setAttribute('aria-expanded','false')});
  if(willOpen){li.classList.add('open');btn.setAttribute('aria-expanded','true')}
});

function followArchiveBookmark(){
  const target=document.getElementById(location.hash.slice(1));
  if(!target?.matches('.arc-body')) return;
  const opener=target.previousElementSibling;
  if(opener.getAttribute('aria-expanded')==='false') opener.click();
  opener.scrollIntoView();
}
window.addEventListener('load',followArchiveBookmark,{once:true});
window.addEventListener('hashchange',followArchiveBookmark);


})();
