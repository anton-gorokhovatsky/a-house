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
