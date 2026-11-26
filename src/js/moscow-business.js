const mediaDirectory = new URL('../media/', document.currentScript.src);
const mediaURL = filename => new URL(filename, mediaDirectory).href;

(() => {
  const root=document.querySelector('.ah-hero');
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  const IMGS=[
    "DSCF1117_2-706adf74ec3d.png",
    "DSCF7583_2_02_4-635ca3f3220b.png",
    "DSC02693_resized_1-19734d1b8aab.png",
    "DSC00109_resized_1-8ac15ee8a907.png",
    "DSC09542_resized_1-bf508425660f.png",
    "DSC02444_resized_1-9b1fd1b151e7.png",
    "DSC07607_resized_1-2a0a7ff7b571.png",
    "DSC02249_resized_1-1ae47fce68b6.png",
    "DSCF1127_2-85095f87450f.png",
    "DSC09522_resized_1-370b03eb2cda.png"
  ];
/* ---------- hero photos: плавное движение по траекториям ---------- */
  // фотографии стоят друг за другом на одном овале и вместе движутся по нему
  // [img index, ширина в % от ширины сцены, h/w] — порядок по овалу
  const RING=[[3,12.5,1.24],[7,12.4,1.24],[2,12.5,1.36],[5,18.8,.66],[1,12.6,1.34],[6,12.8,1.06],[0,18.7,.67],[8,12,1.27],[9,18.7,.67],[4,12.5,1.22]];
  const RINGMOB=[20,15,18,26,20,21,25.5,16,21.5,21];   // ширины для мобильной версии
  const stage=root.querySelector('#ah-stage');
  const els=RING.map(r=>{
    const d=document.createElement('div'); d.className='ph';
    const image = document.createElement('img');
    image.alt = '';
    image.src = mediaURL(IMGS[r[0]]);
    d.append(image);
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
  let pos=START, vel=0, last=t0, animationFrame;
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
    animationFrame = undefined;
    if (motionPreference.matches) return;
    const dt=Math.min(.05,(now-last)/1000); last=now;
    const t=(now-t0)/1000;
    if(t<DUR) pos=START + INTRO*Math.sin(t/DUR*Math.PI/2);
    else { pos+=vel*dt; vel*=Math.exp(-dt*1.6); }
    placePhotos();
    if(t<DUR || Math.abs(vel)>1e-5) animationFrame = requestAnimationFrame(frame);
  }
  let px=null, py=null;
  root.addEventListener('pointermove',e=>{
    if(motionPreference.matches || e.pointerType === 'touch') return;
    if(px!==null && performance.now()-t0>DUR*1000){
      const d=Math.hypot(e.clientX-px,e.clientY-py);
      vel=Math.min(.03, vel + d*.00003);          // скорость — от длины движения мыши, с ограничением
      if(!animationFrame){ last=performance.now(); animationFrame=requestAnimationFrame(frame); }
    }
    px=e.clientX; py=e.clientY;
  });
  root.addEventListener('pointerleave',()=>{px=py=null});
  addEventListener('resize',()=>{measure(); placePhotos();});
  motionPreference.addEventListener('change', () => {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = undefined;
    vel = 0;
    if (motionPreference.matches) {
      pos = START;
      placePhotos();
    } else {
      last = performance.now();
      animationFrame = requestAnimationFrame(frame);
    }
  });
  if (!motionPreference.matches) animationFrame = requestAnimationFrame(frame);
  placePhotos();
})();

(() => {
  const EVENTS = [
    {date:"1 декабря, вторник 18:30", title:"Инновации в строительстве: от задачи девелопера до пилотного проекта",
     lead:"Презентация раздела «Инновации на A-Index»",
     desc:"Паблик-ток объединит девелоперов, архитекторов, продуктологов и технических директоров. Участники познакомятся с инновационными решениями из раздела A-Index и каталога МИК, обсудят актуальные задачи строительного рынка и подберут объекты для пилотного внедрения технологий.",
     reg:"https://a-housefest.timepad.ru/event/4321862/", img:"Rectangle_26-3ff2195a3632.webp", spk:"Главстрой, ЛСР, ФСК"},
    {date:"11 декабря, пятница 18:30", title:"Иностранные таланты в Москве: как привлекать лучших специалистов",
     lead:"", desc:"Текст-заглушка: разговор о найме иностранных специалистов, городских программах поддержки и адаптации сотрудников.", reg:"https://a-housefest.timepad.ru/event/4322469/", img:"Rectangle_25-095858c89629.webp", spk:"уточняются"},
    {date:"14 декабря, понедельник 18:30", title:"Ритейл будущего: как роботы меняют магазины, склады и клиентский опыт",
     lead:"", desc:"Текст-заглушка: кейсы автоматизации складов и торговых залов, экономика роботизации и реакция покупателей.", reg:"https://a-housefest.timepad.ru/event/4324817/", img:"Rectangle_24-72c8fb2f637d.png", spk:"уточняются"},
    {date:"18 декабря, пятница 18:30", title:"За место на полке: как бренду попасть в большой ритейл",
     lead:"", desc:"Текст-заглушка: требования сетей к поставщикам, переговоры о входе и первые полгода на полке.", reg:"https://a-housefest.timepad.ru/event/4322473/", img:"Rectangle_23-7453d33b68be.png", spk:"уточняются"},
    {date:"23 декабря, среда 18:30", title:"Лонжевити: как на самом деле продлить жизнь и построить бизнес будущего",
     lead:"", desc:"Текст-заглушка: что говорит наука о долголетии и какие бизнес-модели складываются вокруг этого рынка.", reg:"https://a-housefest.timepad.ru/event/4322478/", img:"Rectangle_22-83f8d12d6327.png", spk:"уточняются"}
  ];

  const grid = document.getElementById('ah-grid');
  const modal = document.getElementById('ah-modal');
  const closeButton = document.getElementById('ah-m-close');
  const registration = document.getElementById('ah-m-reg');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const lead = document.getElementById('ah-m-lead');
  const page = document.documentElement;
  let opener;
  let closing = false;
  let animationTimers = [];

  EVENTS.forEach((event, index) => {
    const card = document.createElement('article');
    card.className = 'card';
    card.id = 'meeting-' + (index + 1);
    card.dataset.eventIndex = index;
    card.innerHTML = [
      '<img class="img" alt="" loading="lazy" decoding="async">',
      '<p class="meta caps"></p><h3></h3>',
      '<button class="more caps" type="button" aria-haspopup="dialog" aria-controls="ah-modal">Подробнее</button>',
      '<a class="btn caps" target="_blank" rel="noopener">Регистрация</a>',
    ].join('');
    card.querySelector('img').src = mediaURL(event.img);
    card.querySelector('.meta').textContent = event.date;
    card.querySelector('h3').textContent = event.title;
    card.querySelector('.more').setAttribute('aria-label', 'Подробнее: ' + event.title);
    card.querySelector('a').href = event.reg;
    grid.append(card);
  });

  function later(callback, delay) {
    animationTimers.push(setTimeout(callback, delay));
  }

  function clearAnimation() {
    animationTimers.forEach(clearTimeout);
    animationTimers = [];
  }

  function measureModal() {
    if (modal.open) modal.style.setProperty('--half', modal.getBoundingClientRect().height / 2 + 'px');
  }

  function openModal(event, origin) {
    if (modal.open) return;
    opener = origin;
    document.getElementById('ah-m-meta').textContent = event.date;
    document.getElementById('ah-m-title').textContent = event.title;
    document.getElementById('ah-m-img').src = mediaURL(event.img);
    lead.textContent = event.lead;
    lead.hidden = !event.lead;
    document.getElementById('ah-m-desc').textContent = event.desc;
    document.getElementById('ah-m-spk').textContent = 'Спикеры: ' + event.spk;
    registration.href = event.reg;
    page.classList.add('moscow-dialog-open');
    modal.classList.add('instant');
    modal.showModal();
    modal.querySelector('.modal-scroll').scrollTop = 0;
    measureModal();
    modal.classList.remove('instant');
    modal.classList.add('visible');
    if (reduceMotion.matches) {
      modal.classList.add('drawn', 'split');
    } else {
      later(() => modal.classList.add('drawn'), 120);
      later(() => modal.classList.add('split'), 420);
    }
  }

  function finishClosing() {
    modal.close();
    modal.classList.remove('split', 'drawn', 'visible');
    page.classList.remove('moscow-dialog-open');
    clearAnimation();
    closing = false;
    opener?.focus({preventScroll: true});
    opener = undefined;
  }

  function closeModal() {
    if (!modal.open || closing) return;
    if (reduceMotion.matches) {
      finishClosing();
      return;
    }
    closing = true;
    clearAnimation();
    modal.classList.remove('split');
    later(() => modal.classList.remove('drawn'), 650);
    later(() => modal.classList.remove('visible'), 800);
    later(finishClosing, 1000);
  }

  grid.addEventListener('click', event => {
    const card = event.target.closest('.card');
    if (card && !event.target.closest('a[href]')) {
      openModal(EVENTS[Number(card.dataset.eventIndex)], card.querySelector('.more'));
    }
  });
  new ResizeObserver(measureModal).observe(modal);
  closeButton.addEventListener('click', closeModal);
  modal.addEventListener('cancel', event => {
    event.preventDefault();
    closeModal();
  });
  modal.addEventListener('click', event => {
    if (event.target !== modal) return;
    const frame = modal.getBoundingClientRect();
    if (event.clientX < frame.left || event.clientX > frame.right ||
        event.clientY < frame.top || event.clientY > frame.bottom) closeModal();
  });
  modal.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const from = event.shiftKey ? closeButton : registration;
    const to = event.shiftKey ? registration : closeButton;
    if (document.activeElement === from) {
      event.preventDefault();
      to.focus();
    }
  });
  reduceMotion.addEventListener('change', () => {
    if (!modal.open || !reduceMotion.matches) return;
    if (closing) finishClosing();
    else {
      clearAnimation();
      modal.classList.add('drawn', 'split');
    }
  });
})();

(() => {
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

  const list = document.getElementById('ah-arc');
  for (const [index, [date, type, title, description, speakers]] of ARCHIVE.entries()) {
    const row = document.createElement('li');
    row.className = 'arc-item';
    row.innerHTML = [
      '<h3><button class="arc-row" type="button" aria-expanded="false" aria-controls="ah-ab' + index + '">',
      '<span class="d"></span><span class="ty"></span><span class="t"></span><span class="pm" aria-hidden="true">+</span>',
      '</button></h3>',
      '<div class="arc-body" id="ah-ab' + index + '" inert><div><div class="arc-inner"><p></p><p></p></div></div></div>',
      '<i class="cn tr" aria-hidden="true"></i><i class="cn bl" aria-hidden="true"></i>',
    ].join('');
    row.querySelector('.d').textContent = date;
    row.querySelector('.ty').textContent = type;
    row.querySelector('.t').textContent = title;
    const [about, participants] = row.querySelectorAll('.arc-inner p');
    about.textContent = description || PLACEHOLDER;
    participants.textContent = 'Спикеры: ' + (speakers || 'уточняются');
    list.append(row);
  }

  function setExpanded(row, expanded) {
    row.classList.toggle('open', expanded);
    row.querySelector('button').setAttribute('aria-expanded', String(expanded));
    row.querySelector('.arc-body').inert = !expanded;
  }

  list.addEventListener('click', event => {
    const button = event.target.closest('.arc-row');
    if (!button) return;
    const row = button.closest('.arc-item');
    const expanded = row.classList.contains('open');
    const previous = list.querySelector('.arc-item.open');
    if (previous) setExpanded(previous, false);
    if (!expanded) setExpanded(row, true);
  });

  function followBookmark() {
    const id = location.hash.slice(1);
    const target = document.getElementById(id);
    if (target?.matches('.arc-body')) {
      const button = target.closest('.arc-item').querySelector('button');
      if (button.getAttribute('aria-expanded') === 'false') button.click();
      button.scrollIntoView();
    } else if (target?.matches('.card')) {
      target.scrollIntoView({block: 'start'});
    }
  }
  window.addEventListener('load', followBookmark, {once: true});
  window.addEventListener('hashchange', followBookmark);
})();
