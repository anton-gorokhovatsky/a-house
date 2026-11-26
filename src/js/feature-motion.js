(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const narrow = matchMedia('(max-width: 479px)');
  const parallax = [...document.querySelectorAll('[data-feature-parallax]')];
  const scenes = [...document.querySelectorAll('[data-feature-motion="scroll"]')];
  const entrances = [...document.querySelectorAll('[data-feature-motion="intoview"]')];
  const clamp = value => Math.max(0, Math.min(1, value));
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const motion = new Map();
  const entered = new Set();
  const live = new Map();
  let frameId;

  function readFrames(element) {
    const data = element.dataset;
    const raw = narrow.matches && data.featureFramesMobile ? data.featureFramesMobile : data.featureFrames;
    try {
      return JSON.parse(raw).map(step => ({
        x: number(step.mx), y: number(step.my),
        sx: number(step.sx, 1), sy: number(step.sy, 1),
        alpha: number(step.op, 1), angle: number(step.ro),
        time: number(step.ti), delay: number(step.dt),
        distance: Math.max(0, number(step.di)),
        startAfter: Math.max(0, number(step.dd)),
        fixed: step.fi === 'fixed',
      }));
    } catch {
      return [];
    }
  }

  const interpolate = (a, b, t) => a + (b - a) * t;
  function atScroll(frames, distance) {
    let elapsed = 0;
    let pinned = 0;
    for (let index = 1; index < frames.length; index++) {
      const previous = frames[index - 1];
      const step = frames[index];
      const length = step.startAfter + step.distance;
      const traveled = Math.min(Math.max(0, distance - elapsed), length);
      if (step.fixed) pinned += traveled;
      if (distance < elapsed + length || index === frames.length - 1) {
        const progress = step.distance ? clamp((traveled - step.startAfter) / step.distance) : 1;
        return {
          x: interpolate(previous.x, step.x, progress),
          y: interpolate(previous.y, step.y, progress) + pinned,
          sx: interpolate(previous.sx, step.sx, progress),
          sy: interpolate(previous.sy, step.sy, progress),
          alpha: interpolate(previous.alpha, step.alpha, progress),
          angle: interpolate(previous.angle, step.angle, progress),
        };
      }
      elapsed += length;
    }
    return frames[0];
  }

  function apply(element, state) {
    if (!state) return;
    element.style.translate = state.x + 'px ' + state.y + 'px';
    element.style.scale = state.sx + ' ' + state.sy;
    element.style.rotate = state.angle + 'deg';
    element.style.opacity = state.alpha;
  }

  function clear(element) {
    for (const property of ['translate', 'scale', 'rotate', 'opacity']) element.style.removeProperty(property);
  }

  function paint() {
    frameId = undefined;
    if (reduced.matches) return;
    const scale = number(getComputedStyle(document.documentElement).getPropertyValue('--feature-scale'), 1) || 1;
    for (const element of parallax) {
      const distance = number(narrow.matches ? element.dataset.featureParallaxMobile : element.dataset.featureParallax);
      const rect = element.closest('.feature-canvas').getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) continue;
      const progress = clamp((innerHeight - rect.top) / (rect.height + innerHeight));
      element.style.translate = '0 ' + (progress - .5) * distance + 'px';
    }
    for (const element of scenes) {
      const rect = element.closest('.feature-canvas').getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) continue;
      apply(element, atScroll(motion.get(element), Math.max(0, (innerHeight * .5 - rect.top) / scale)));
    }
  }

  function schedule() {
    if (!reduced.matches && frameId === undefined) frameId = requestAnimationFrame(paint);
  }

  function enter(element) {
    if (entered.has(element)) return;
    const frames = motion.get(element);
    if (!frames.length) return;
    entered.add(element);
    let duration = 0;
    const keyframes = frames.map(frame => {
      duration += frame.delay + frame.time;
      return {
        offset: duration,
        translate: frame.x + 'px ' + frame.y + 'px',
        scale: frame.sx + ' ' + frame.sy,
        rotate: frame.angle + 'deg',
        opacity: frame.alpha,
      };
    });
    if (duration < 1) return;
    for (const frame of keyframes) frame.offset /= duration;
    const animation = element.animate(keyframes, {duration, fill: 'both'});
    live.set(element, animation);
  }

  const observer = new IntersectionObserver(entries => {
    if (!reduced.matches) for (const entry of entries) if (entry.isIntersecting) enter(entry.target);
  }, {threshold: .14});

  function setMode() {
    for (const element of [...scenes, ...entrances]) motion.set(element, readFrames(element));
    if (reduced.matches) {
      for (const animation of live.values()) animation.cancel();
      live.clear();
      entered.clear();
      for (const element of [...parallax, ...scenes, ...entrances]) clear(element);
      observer.disconnect();
    } else {
      for (const element of entrances) observer.observe(element);
      schedule();
    }
  }

  setMode();
  addEventListener('scroll', schedule, {passive:true});
  addEventListener('resize', schedule, {passive:true});
  narrow.addEventListener('change', setMode);
  reduced.addEventListener('change', setMode);
})();
