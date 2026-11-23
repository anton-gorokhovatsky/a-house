for (const form of document.querySelectorAll('form[data-membership-form]')) {
  const fields = [...form.elements].filter(control =>
    control.matches('input:not([type="hidden"]), textarea, select') && control.name);
  const groups = new Map();
  for (const field of fields) {
    if (!groups.has(field.name)) groups.set(field.name, []);
    groups.get(field.name).push(field);
  }

  const programs = groups.get('offer');
  if (programs && !programs.some(option => option.checked)) {
    const requested = new URLSearchParams(location.search).get('offer');
    const option = programs.find(radio => radio.value === requested);
    if (option) option.checked = true;
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
        return 'Укажите номер с кодом страны, например +7 900 000-00-00.';
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
    if (form.method.toLowerCase() !== 'post' || !form.hasAttribute('action')) {
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
    }
  });
}
