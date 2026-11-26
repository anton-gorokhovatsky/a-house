for (const form of document.querySelectorAll('form[data-membership-form]')) {
  const fields = [...form.elements].filter(control =>
    control.matches('input:not([type="hidden"]), textarea, select') && control.name);
  const groups = new Map();
  for (const field of fields) {
    if (!groups.has(field.name)) groups.set(field.name, []);
    groups.get(field.name).push(field);
  }

  const applicationResult = form.querySelector('[data-application-result]');
  const submit = form.querySelector('button[type="submit"]');

  const programs = groups.get('offer');
  if (programs && !programs.some(option => option.checked)) {
    const requested = new URLSearchParams(location.search).get('offer');
    const option = programs.find(radio => radio.value === requested);
    if (option) option.checked = true;
  }

  const basket = form.querySelector('.friend-basket');
  if (basket) {
    const quantity = form.elements.namedItem('quantity');
    const price = Number(basket.dataset.unitPrice);
    const format = new Intl.NumberFormat('ru-RU');
    const less = basket.querySelector('[data-order-action="less"]');
    const more = basket.querySelector('[data-order-action="more"]');
    const restore = basket.querySelector('[data-order-action="restore"]');
    let previousQuantity = 1;
    let empty = false;
    quantity.readOnly = false;
    function displayQuantity() {
      const count = Number(quantity.value);
      const valid = Number.isSafeInteger(count * price) && Number.isInteger(count) && count > 0;
      quantity.setCustomValidity(valid || empty ? '' : 'Введите целое количество подписок от одной.');
      less.disabled = empty || !valid || count <= 1;
      basket.querySelector('[data-order-total]').textContent = empty || valid ? format.format(count * price) + ' ₽' : '—';
      basket.querySelector('[data-order-line]').hidden = empty;
      basket.querySelector('[data-order-empty]').hidden = !empty;
      form.querySelector('.friend-fields').hidden = empty;
    }
    for (const button of basket.querySelectorAll('[data-order-action]')) button.hidden = false;
    basket.addEventListener('click', event => {
      const action = event.target.closest('button')?.dataset.orderAction;
      if (!action) return;
      const count = Number(quantity.value);
      const retainKeyboardFocus = action === 'less' && event.detail === 0 && document.activeElement === less;
      if (action === 'more' && Number.isSafeInteger((count + 1) * price)) quantity.value = Math.max(1, Math.floor(count) + 1);
      if (action === 'less' && count > 1) quantity.value = count - 1;
      if (action === 'remove') {
        empty = true;
        previousQuantity = Number.isSafeInteger(count) && count > 0 ? count : 1;
        quantity.value = 0;
      }
      if (action === 'restore') {
        empty = false;
        quantity.value = previousQuantity;
      }
      displayQuantity();
      if (quantity.hasAttribute('aria-invalid') && !empty) validate([quantity]);
      if (retainKeyboardFocus && less.disabled) quantity.focus({ preventScroll: true });
      if (empty) restore.focus();
      if (action === 'restore') more.focus();
    });
    quantity.addEventListener('input', displayQuantity);
    quantity.addEventListener('blur', () => { if (!empty) validate([quantity]); });
    displayQuantity();
    window.addEventListener('pageshow', displayQuantity);
    document.addEventListener('click', event => {
      const link = event.target.closest('a[href^="#"]');
      if (!empty || !link || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const section = document.getElementById(link.hash.slice(1))?.closest('[data-home-section]');
      if (section && section.contains(form)) {
        empty = false;
        quantity.value = 1;
        displayQuantity();
        validate([quantity]);
      }
    });
  }

  function messageFor(controls) {
    const field = controls[0];
    if (field.type === 'radio') {
      if (controls.some(radio => radio.checked) || !controls.some(radio => radio.required)) return '';
      return field.name === 'offer' ? 'Выберите программу клуба.' : 'Выберите способ связи.';
    }
    if (field.type === 'checkbox') return field.required && !field.checked ? 'Для продолжения нужно согласие.' : '';
    if (!field.value.trim()) return field.required ? 'Заполните это поле.' : '';
    if (field.validity.typeMismatch && field.type === 'email') return 'Укажите адрес в формате name@example.ru.';
    if (field.type === 'tel') {
      const digits = field.value.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15 || /[^\d\s+().-]/.test(field.value)) {
        return 'Проверьте номер телефона. Например, +7 900 000-00-00.';
      }
    }
    return field.validity.valid ? '' : field.validationMessage;
  }

  function validate(controls) {
    const problem = messageFor(controls);
    const hint = form.querySelector('[data-field-error="' + controls[0].name + '"]');
    if (hint) {
      hint.textContent = problem;
      hint.hidden = !problem;
    }
    for (const field of controls) {
      if (problem) field.setAttribute('aria-invalid', 'true');
      else field.removeAttribute('aria-invalid');
    }
    return !problem;
  }

  async function sendApplication() {
    const body = new URLSearchParams(new FormData(form));
    const editable = fields.filter(field => !field.disabled);
    for (const field of editable) field.disabled = true;
    submit.disabled = true;
    applicationResult.textContent = 'Отправляем заявку…';
    let invalid = false;
    try {
      const response = await fetch(form.action, {
        method: 'POST', headers: { Accept: 'application/json' }, body,
        credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(55000)
      });
      invalid = response.status === 422;
      if (!response.ok || (await response.json()).status !== 'accepted') throw new Error('No application receipt');
      submit.hidden = true;
      applicationResult.textContent = 'Заявка отправлена. Команда клуба свяжется с вами выбранным способом.';
    } catch {
      for (const field of editable) field.disabled = false;
      submit.disabled = false;
      applicationResult.textContent = invalid ? 'Проверьте заполнение анкеты. Введённые данные на месте.' :
        'Не удалось подтвердить отправку. Данные остались в анкете. Попробуйте ещё раз.';
    }
    applicationResult.focus();
  }

  form.noValidate = true;
  form.addEventListener('focusout', event => {
    const field = event.target;
    if ((field.type === 'email' || field.type === 'tel') && field.value.trim()) validate(groups.get(field.name));
  });
  form.addEventListener('input', event => {
    const controls = groups.get(event.target.name);
    if (controls?.some(field => field.hasAttribute('aria-invalid'))) validate(controls);
  });
  form.addEventListener('submit', event => {
    if (submit.disabled || form.method.toLowerCase() !== 'post' || !form.hasAttribute('action') ||
        (basket && basket.querySelector('[data-order-line]').hidden)) {
      event.preventDefault();
      return;
    }
    let firstInvalid;
    for (const controls of groups.values()) {
      if (!validate(controls) && !firstInvalid) firstInvalid = controls[0];
    }
    if (firstInvalid) {
      event.preventDefault();
      firstInvalid.focus();
    } else if (applicationResult) {
      event.preventDefault();
      void sendApplication();
    }
  });
}
