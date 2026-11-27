for (const gallery of document.querySelectorAll('[data-press-motion]')) {
  const image = gallery.querySelector('img');
  const button = gallery.querySelector('button');
  const label = button.querySelector('span');
  const status = gallery.querySelector('[role="status"]');
  const still = image.getAttribute('src');
  const animation = gallery.dataset.pressMotion;

  function showMotion(playing) {
    image.src = playing ? animation : still;
    label.textContent = playing ? 'Остановить анимацию' : 'Смотреть анимацию';
  }

  button.addEventListener('click', () => {
    status.textContent = '';
    showMotion(image.getAttribute('src') === still);
  });
  image.addEventListener('error', () => {
    if (image.getAttribute('src') !== animation) return;
    showMotion(false);
    status.textContent = 'Не удалось загрузить анимацию.';
  });
  button.hidden = false;
}

for (const player of document.querySelectorAll('[data-press-release-player]')) {
  const video = player.querySelector('video');
  const button = player.querySelector('button');
  const status = player.querySelector('[role="status"]');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const observer = new IntersectionObserver(([entry]) => {
    if (entry.intersectionRatio >= .5 && !reducedMotion.matches) start(false);
  }, { threshold: .5 });

  function start(requested) {
    observer.disconnect();
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
  if (!reducedMotion.matches) observer.observe(video);
}
