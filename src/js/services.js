/* Autonomous public catalogue details and non-submitting demonstration forms. */
(() => {
  'use strict';
  const offers = { member: 'A–Member', patron: 'A–Patron', platinum: 'Patron Platinum' };
  const openers = new WeakMap();
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

  function syncScrollLock() {
    document.documentElement.classList.toggle('services-modal-open', !!$('dialog.services-dialog[open]'));
  }

  function closeDialog(dialog) {
    if (!dialog?.open) return;
    dialog.close();
    syncScrollLock();
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
      syncScrollLock();
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
      field.setCustomValidity('');
      showFieldError(field, '');
    });
    const result = $('[data-service-result]', form);
    if (result) result.hidden = true;
    const status = $('[data-service-status]', form);
    if (status) status.textContent = '';
    setOffer(form);
  }

  function showFieldError(field, message) {
    if (message) field.setAttribute('aria-invalid', 'true');
    else field.removeAttribute('aria-invalid');
    const hint = field.closest('.t-input-group')?.querySelector('.t-input-error');
    if (!hint) return;
    hint.textContent = message;
    hint.toggleAttribute('data-service-field-error', Boolean(message));
    if (message && hint.id) {
      const descriptions = new Set((field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
      descriptions.add(hint.id);
      field.setAttribute('aria-describedby', [...descriptions].join(' '));
    }
  }

  function validateField(field) {
    field.setCustomValidity('');
    const value = field.value.trim();
    let message = '';
    if (field.validity.valueMissing || (field.required && !value && !['radio', 'checkbox'].includes(field.type))) {
      if (field.type === 'radio' || field.tagName === 'SELECT') message = 'Выберите один из вариантов.';
      else if (field.type === 'checkbox') message = 'Для продолжения требуется согласие.';
      else message = 'Заполните это поле.';
    } else if (field.type === 'tel' && value) {
      const digits = value.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15 || /[^\d\s+().-]/.test(value)) {
        message = 'Укажите номер телефона, например +7 900 000-00-00.';
      }
    } else if (field.type === 'email' && field.validity.typeMismatch) {
      message = 'Укажите адрес почты в формате name@example.ru.';
    }
    field.setCustomValidity(message);
    showFieldError(field, field.validationMessage);
  }

  function reviewForm(form) {
    const status = $('[data-service-status]', form);
    $$('input,select,textarea', form).forEach(validateField);
    if (form.querySelector('[aria-invalid="true"]')) {
      if (status) status.textContent = 'Исправьте отмеченные поля. Подсказка есть рядом с каждым из них.';
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
      const field = event.target;
      if (!field.matches('input,select,textarea') || !field.hasAttribute('aria-invalid')) return;
      if (field.type === 'radio') {
        $$('input[type="radio"]', form).filter(radio => radio.name === field.name).forEach(validateField);
      } else validateField(field);
      const status = $('[data-service-status]', form);
      if (status && !form.querySelector('[aria-invalid="true"]')) status.textContent = '';
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
    });
    window.addEventListener('hashchange', openHash);
    // A history traversal can leave the dialog's section while the dialog is open.
    // Release the modal before the destination restores keyboard focus and scroll.
    window.addEventListener('popstate', () => {
      for (const dialog of $$('dialog.services-dialog[open]')) {
        if ('#' + dialog.id === location.hash) continue;
        openers.delete(dialog);
        closeDialog(dialog);
      }
    }, { capture: true });
    // Only the current DOM holds entries; clear them when leaving or closing.
    window.addEventListener('pagehide', () => $$('[data-service-form]').forEach(clearForm));
    openHash();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
