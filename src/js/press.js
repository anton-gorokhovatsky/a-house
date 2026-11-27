const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

for (const gallery of document.querySelectorAll('[data-press-motion]')) {
  const image = gallery.querySelector('img');
  const button = gallery.querySelector('button');
  const status = gallery.querySelector('[role="status"]');
  const still = image.getAttribute('src');
  const animation = gallery.dataset.pressMotion;
  const subject = gallery.dataset.motionSubject;
  let inView = false;
  let playOnEntry = true;

  function showMotion(playing) {
    const source = playing ? animation : still;
    if (image.getAttribute('src') !== source) image.src = source;
    button.toggleAttribute('data-playing', playing);
    const action = playing ? 'Остановить' : 'Смотреть';
    button.setAttribute('aria-label', `${action} анимацию ${subject}`);
  }

  function autoplay() {
    if (inView && playOnEntry && !reducedMotion.matches) showMotion(true);
  }

  const observer = new IntersectionObserver(([entry]) => {
    inView = entry.intersectionRatio >= .5;
    if (!entry.isIntersecting) showMotion(false);
    else autoplay();
  }, { threshold: [0, .5] });
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) showMotion(false);
    else autoplay();
  });
  button.addEventListener('click', () => {
    status.textContent = '';
    playOnEntry = !button.hasAttribute('data-playing');
    showMotion(playOnEntry);
  });
  image.addEventListener('error', () => {
    if (image.getAttribute('src') !== animation) return;
    playOnEntry = false;
    showMotion(false);
    status.textContent = 'Не удалось загрузить анимацию.';
  });
  showMotion(false);
  button.hidden = false;
  observer.observe(image);
}

for (const player of document.querySelectorAll('[data-press-release-player]')) {
  const video = player.querySelector('video');
  const button = player.querySelector('button');
  const status = player.querySelector('[role="status"]');
  let playOnEntry = true;
  const observer = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting && !video.paused) {
      playOnEntry = video.muted;
      video.pause();
    }
    if (entry.intersectionRatio >= .5 && playOnEntry && !reducedMotion.matches) start(false);
  }, { threshold: [0, .5] });

  function start(requested) {
    playOnEntry = false;
    status.textContent = '';
    if (video.error) video.load();
    video.play().then(() => {
      const moveFocus = document.activeElement === button;
      video.controls = true;
      button.hidden = true;
      if (moveFocus) video.focus({ preventScroll: true });
    }, () => {
      if (requested) status.textContent = 'Не удалось запустить ролик. Попробуйте ещё раз.';
    });
  }

  video.muted = true;
  video.controls = false;
  button.hidden = false;
  button.addEventListener('click', () => start(true));
  observer.observe(video);
}
