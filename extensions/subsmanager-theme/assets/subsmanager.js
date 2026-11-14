class SubsManagerWidget extends HTMLElement {
  connectedCallback() {
    this.formId = this.dataset.productForm;
    this.hiddenInput = this.querySelector('[data-sm-selling-plan]');
    this.subscriptionOption = this.querySelector('[data-sm-subscription-option]');
    this.oneTimeOption = this.querySelector('[data-sm-one-time-option]');
    this.subscriptionRadio = this.querySelector('input[data-purchase-type="subscription"]');
    this.oneTimeRadio = this.querySelector('input[data-purchase-type="one-time"]');
    this.frequencies = this.querySelector('[data-sm-frequencies]');
    this.oneTimePrice = this.querySelector('[data-sm-one-time-price]');
    this.subscriptionPrice = this.querySelector('[data-sm-subscription-price]');
    this.comparePrice = this.querySelector('[data-sm-compare]');
    this.badge = this.querySelector('[data-sm-badge]');
    this.variantData = this.readVariantData();
    this.form = this.findProductForm();

    if (this.form && this.hiddenInput) {
      // Associate the selling_plan input with the theme's add-to-cart form, whatever its id is.
      // Use getAttribute: product forms contain a field named "id", which hides form.id.
      let formId = this.form.getAttribute('id');
      if (!formId) {
        formId = `subsmanager-form-${Math.random().toString(36).slice(2)}`;
        this.form.setAttribute('id', formId);
      }
      this.hiddenInput.setAttribute('form', formId);
    }

    this.onChange = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      // Choosing a frequency also selects the subscription option.
      if (target.closest('[data-sm-frequencies]') && this.subscriptionRadio) this.subscriptionRadio.checked = true;
      this.sync();
    };
    this.onVariantChange = (event) => {
      if (event.target instanceof Node && this.contains(event.target)) return;
      const eventVariantId = event.detail?.variant?.id || event.detail?.variantId;
      window.requestAnimationFrame(() => {
        const variantId = String(eventVariantId || this.currentVariantId() || '');
        if (variantId && variantId !== this.renderedVariantId) this.renderVariant(variantId);
      });
    };
    this.addEventListener('change', this.onChange);
    this.form?.addEventListener('change', this.onVariantChange);
    document.addEventListener('variant:change', this.onVariantChange);
    document.addEventListener('product:variant-change', this.onVariantChange);
    this.renderVariant(this.currentVariantId());
  }

  disconnectedCallback() {
    this.removeEventListener('change', this.onChange);
    this.form?.removeEventListener('change', this.onVariantChange);
    document.removeEventListener('variant:change', this.onVariantChange);
    document.removeEventListener('product:variant-change', this.onVariantChange);
  }

  findProductForm() {
    const isAddToCart = (form) => form instanceof HTMLFormElement && /\/cart\/add/.test(form.getAttribute('action') || '');
    const byId = this.formId ? document.getElementById(this.formId) : null;
    if (isAddToCart(byId)) return byId;
    const scopes = [
      this.closest('.shopify-section'),
      this.closest('section'),
      this.closest('[id^="MainProduct"], [id^="ProductInfo"], product-info, .product'),
      document,
    ].filter(Boolean);
    for (const scope of scopes) {
      const forms = Array.from(scope.querySelectorAll('form[action*="/cart/add"]'));
      const productForm = forms.find((form) => form.querySelector('[name="id"]')) || forms[0];
      if (productForm) return productForm;
    }
    return null;
  }

  readVariantData() {
    try {
      const data = JSON.parse(this.querySelector('[data-sm-variants]')?.textContent || '{}');
      // Radio values are strings; keep plan IDs as strings so comparisons match.
      for (const variant of Object.values(data)) {
        for (const allocation of variant.allocations || []) allocation.id = String(allocation.id);
      }
      return data;
    } catch {
      return {};
    }
  }

  currentVariantId() {
    const value = this.form?.querySelector('[name="id"]:not([disabled])')?.value;
    return value ? String(value) : this.dataset.initialVariant;
  }

  fill(template, saving) {
    return String(template || '').replace('[saving]', `${saving}%`);
  }

  selectedPlanId() {
    return this.frequencies?.querySelector('input[type="radio"]:checked')?.value || '';
  }

  renderVariant(variantId) {
    const variant = this.variantData[String(variantId || '')];
    if (!variant) {
      this.sync();
      return;
    }
    this.currentVariant = variant;
    this.renderedVariantId = String(variantId);
    const allocations = variant.allocations || [];
    if (this.oneTimePrice) this.oneTimePrice.textContent = variant.oneTimePrice;
    if (this.subscriptionOption) this.subscriptionOption.hidden = allocations.length === 0;

    if (allocations.length === 0) {
      if (this.oneTimeRadio) this.oneTimeRadio.checked = true;
      if (this.oneTimeOption) this.oneTimeOption.hidden = false;
      this.sync();
      return;
    }

    if (this.frequencies) {
      const previous = this.selectedPlanId();
      const groupName = this.frequencies.querySelector('input')?.name || `sm-plan-${Math.random().toString(36).slice(2)}`;
      const keep = allocations.some((allocation) => allocation.id === previous) ? previous : allocations[0].id;
      this.frequencies.replaceChildren(
        ...allocations.map((allocation) => {
          const label = document.createElement('label');
          label.className = 'sm-frequency';
          const input = document.createElement('input');
          input.type = 'radio';
          input.name = groupName;
          input.value = allocation.id;
          input.checked = allocation.id === keep;
          const title = document.createElement('span');
          title.className = 'sm-frequency__label';
          title.textContent = allocation.label;
          label.append(input, title);
          if (allocation.saving > 0) {
            const saving = document.createElement('span');
            saving.className = 'sm-frequency__saving';
            saving.textContent = this.fill(this.dataset.saveTemplate, allocation.saving);
            label.append(saving);
          }
          return label;
        }),
      );
    }

    if (this.badge) {
      const best = Math.max(0, ...allocations.map((allocation) => allocation.saving || 0));
      const enabled = Boolean(this.dataset.badgeTemplate) && this.badge.dataset.disabled !== 'true';
      this.badge.textContent = this.fill(this.dataset.badgeTemplate, best);
      this.badge.hidden = !enabled || best <= 0;
    }
    this.sync();
  }

  sync() {
    const subscribed = Boolean(this.subscriptionRadio?.checked && !this.subscriptionOption?.hidden);
    const planId = subscribed ? this.selectedPlanId() : '';
    const allocations = this.currentVariant?.allocations || [];
    const allocation = allocations.find(({ id }) => id === this.selectedPlanId()) || allocations[0];

    if (allocation) {
      if (this.subscriptionPrice) this.subscriptionPrice.textContent = allocation.price;
      if (this.comparePrice) {
        this.comparePrice.textContent = allocation.compare || '';
        this.comparePrice.hidden = !allocation.compare;
      }
    }
    this.subscriptionOption?.classList.toggle('is-selected', subscribed);
    this.oneTimeOption?.classList.toggle('is-selected', !subscribed);
    if (this.hiddenInput) {
      this.hiddenInput.value = planId;
      this.hiddenInput.disabled = !planId;
    }
    this.dispatchEvent(new CustomEvent('subsmanager:change', {
      bubbles: true,
      detail: { sellingPlanId: planId || null },
    }));
  }
}

if (!customElements.get('subsmanager-widget')) {
  customElements.define('subsmanager-widget', SubsManagerWidget);
}
