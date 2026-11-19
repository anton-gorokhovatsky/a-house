/* Autonomous public catalogue details and non-submitting demonstration forms. */
(() => {
  'use strict';
  const offers = { member: 'A–Member', patron: 'A–Patron', platinum: 'Patron Platinum' };
  const openers = new WeakMap();
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

  function closeDialog(dialog) {
    if (!dialog?.open) return;
    dialog.close();
  }

  function wireDialog(dialog) {
    if (dialog.dataset.serviceWired) return;
    dialog.dataset.serviceWired = 'true';
    dialog.addEventListener('click', event => {
      if (event.target.closest('[data-service-close]')) closeDialog(dialog);
      if (event.target === dialog) {
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(dialog);
      }
    });
    dialog.addEventListener('close', () => {
      $$('[data-service-form]', dialog).forEach(clearForm);
      document.documentElement.classList.toggle('services-modal-open', !!$('dialog.services-dialog[open]'));
      const opener = openers.get(dialog);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    });
  }

  function openDialog(dialog, opener) {
    if (!dialog) return;
    wireDialog(dialog);
    openers.set(dialog, opener || document.activeElement);
    if (!dialog.open) dialog.showModal();
    document.documentElement.classList.add('services-modal-open');
    const initial = $('[data-service-close]', dialog) || dialog;
    initial.focus({ preventScroll: true });
  }

  function setOffer(form) {
    const select = $('[data-service-offer]', form);
    if (!select) return;
    const offer = new URLSearchParams(location.search).get('offer');
    if (Object.hasOwn(offers, offer)) select.value = offer;
  }

  function clearForm(form) {
    form.reset();
    form.removeAttribute('data-service-complete');
    $$('input,select,textarea', form).forEach(field => {
      field.removeAttribute('aria-invalid');
      if (typeof field.setCustomValidity === 'function') field.setCustomValidity('');
    });
    const result = $('[data-service-result]', form);
    if (result) result.hidden = true;
    const status = $('[data-service-status]', form);
    if (status) status.textContent = '';
    setOffer(form);
  }

  function fieldsValid(form) {
    let valid = true;
    $$('input,select,textarea', form).forEach(field => {
      field.setCustomValidity('');
      if (field.required && !['radio', 'checkbox'].includes(field.type) && !field.value.trim()) {
        field.setCustomValidity('Заполните это поле.');
      }
      if (field.type === 'tel' && field.value.trim()) {
        const digits = field.value.replace(/\D/g, '');
        if (digits.length < 7 || digits.length > 15 || /[^\d\s+().-]/.test(field.value)) field.setCustomValidity('Укажите номер телефона, например +7 900 000-00-00.');
      }
      const ok = field.validity.valid;
      if (ok) field.removeAttribute('aria-invalid');
      else {
        field.setAttribute('aria-invalid', 'true');
        valid = false;
      }
    });
    return valid;
  }

  function reviewForm(form) {
    const status = $('[data-service-status]', form);
    if (!fieldsValid(form)) {
      if (status) status.textContent = 'Проверьте обязательные поля и отметьте согласия. Анкета никуда не отправляется.';
      form.reportValidity();
      return;
    }
    if (status) status.textContent = '';
    const result = $('[data-service-result]', form);
    if (!result) return;
    const offer = $('[data-service-offer]', form)?.value;
    const order = $('#services-checkout-title', form.closest('dialog') || form);
    const summary = $('[data-service-result-offer]', result);
    if (summary) summary.textContent = offers[offer] ? `Выбран уровень ${offers[offer]}.` : order ? `Выбрано: ${order.textContent.trim()}.` : '';
    form.setAttribute('data-service-complete', 'true');
    result.hidden = false;
    $('h3', result)?.focus({ preventScroll: true });
    result.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }

  function wireForm(form) {
    if (form.dataset.serviceWired) return;
    form.dataset.serviceWired = 'true';
    setOffer(form);
    form.addEventListener('submit', event => {
      event.preventDefault();
      event.stopPropagation();
      reviewForm(form);
    });
    form.addEventListener('click', event => {
      if (event.target.closest('[data-service-review]')) reviewForm(form);
      if (event.target.closest('[data-service-edit]')) {
        form.removeAttribute('data-service-complete');
        $('[data-service-result]', form).hidden = true;
        $('input:not([type="hidden"]),select,textarea', form)?.focus();
      }
      if (event.target.closest('[data-service-clear]')) {
        clearForm(form);
        $('input:not([type="hidden"]),select,textarea', form)?.focus();
      }
    });
    form.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.isComposing && event.target.matches('input:not([type="checkbox"]):not([type="radio"])')) {
        event.preventDefault();
        reviewForm(form);
      }
    });
    form.addEventListener('input', event => {
      if (event.target.matches('input,select,textarea')) {
        event.target.setCustomValidity('');
        event.target.removeAttribute('aria-invalid');
      }
    });
  }

  function openCheckout(trigger) {
    const dialog = $('#services-checkout');
    if (!dialog) return false;
    const title = trigger.dataset.serviceOrder || 'A-Friend';
    const amount = Number(trigger.dataset.servicePrice);
    $('[data-service-order-title]', dialog).textContent = title;
    $('[data-service-order-price]', dialog).textContent = amount > 0 ? new Intl.NumberFormat('ru-RU').format(amount) + ' ₽' : '';
    const live = $('[data-service-real-operation]', dialog);
    if (live && trigger.dataset.serviceSource) live.href = trigger.dataset.serviceSource;
    const form = $('[data-service-form]', dialog);
    if (form) clearForm(form);
    openDialog(dialog, trigger);
    return true;
  }

  function requestDialog(trigger) {
    let dialog = $('#services-request');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'services-request';
      dialog.className = 'services-dialog services-request';
      dialog.setAttribute('aria-labelledby', 'services-request-title');
      dialog.innerHTML = '<button class="services-close" type="button" data-service-close aria-label="Закрыть">Закрыть ×</button><p class="services-eyebrow">Демонстрация</p><h2 id="services-request-title"></h2><p>В этой версии регистрация не проводится. Посмотрите условия и доступную запись на действующей странице A-House.</p><p>Персональные данные здесь не запрашиваются и не передаются.</p><a class="services-primary" data-service-live target="_blank" rel="noopener noreferrer">Открыть страницу A-House ↗</a>';
      document.body.append(dialog);
    }
    $('#services-request-title', dialog).textContent = trigger.dataset.serviceRequest || 'Регистрация на событие';
    const source = trigger.dataset.serviceSource || 'https://ahouseproject.com/';
    const url = new URL(source, 'https://ahouseproject.com/');
    $('[data-service-live]', dialog).href = ['http:', 'https:'].includes(url.protocol) ? url.href : 'https://ahouseproject.com/';
    openDialog(dialog, trigger);
  }

  function openHash() {
    if (location.hash.startsWith('#services-product-')) {
      const id = location.hash.slice(1);
      const dialog = document.getElementById(id);
      if (dialog?.matches('dialog.services-product')) openDialog(dialog, $(`[data-catalog-open="${id}"]`));
    } else if (location.hash === '#services-checkout') {
      const trigger = $('[data-service-order]');
      if (trigger) openCheckout(trigger);
    }
  }

  function init() {
    $$('dialog.services-dialog').forEach(wireDialog);
    $$('[data-service-form]').forEach(wireForm);
    document.addEventListener('click', event => {
      if (!(event.target instanceof Element) || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const order = event.target.closest('[data-service-order]');
      if (order && openCheckout(order)) {
        event.preventDefault();
        return;
      }
      const product = event.target.closest('[data-catalog-open]');
      if (product) {
        event.preventDefault();
        openDialog(document.getElementById(product.dataset.catalogOpen), product);
        return;
      }
      const request = event.target.closest('[data-service-request]');
      if (request) {
        event.preventDefault();
        requestDialog(request);
      }
    });
    window.addEventListener('hashchange', openHash);
    // Only the current DOM holds entries; clear them when leaving or closing.
    window.addEventListener('pagehide', () => $$('[data-service-form]').forEach(clearForm));
    openHash();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
