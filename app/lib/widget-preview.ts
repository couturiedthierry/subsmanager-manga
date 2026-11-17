/**
 * Builds a self-contained HTML page that shows the product-page widget with sample prices.
 * It uses the storefront's real stylesheet and script, so the preview behaves like the store.
 */
import widgetCss from "../../extensions/subsmanager-theme/assets/subsmanager.css?raw";
import widgetJs from "../../extensions/subsmanager-theme/assets/subsmanager.js?raw";
import { widgetClassList, widgetStyleAttribute, type WidgetSettings } from "./widget-settings";

const SAMPLE = {
  oneTime: "$29.99",
  plans: [
    { id: "101", label: "1 month", price: "$26.99", compare: "$29.99", saving: 10 },
    { id: "102", label: "2 months", price: "$25.49", compare: "$29.99", saving: 15 },
    { id: "103", label: "3 months", price: "$23.99", compare: "$29.99", saving: 20 },
  ],
};

function esc(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

const fill = (template: string, saving: number) => template.replace("[saving]", `${saving}%`);

export function widgetPreviewHtml(w: WidgetSettings, options: { background?: string } = {}) {
  const subscriptionOnly = w.purchase === "subscription_only";
  const subscribed = subscriptionOnly || w.defaultOption === "subscription";
  const best = Math.max(...SAMPLE.plans.map((plan) => plan.saving));
  const savingTemplate = w.showSavings ? w.savingText : "";
  const first = SAMPLE.plans[0];

  const frequencies =
    w.frequencyStyle === "dropdown"
      ? `<div class="sm-frequencies sm-frequencies--dropdown" data-sm-frequencies>
          <select class="sm-frequency-select" aria-label="Delivery frequency" data-sm-plan-select>
            ${SAMPLE.plans
              .map((plan, index) => {
                const saving = savingTemplate ? fill(savingTemplate, plan.saving) : "";
                return `<option value="${plan.id}"${index === 0 ? " selected" : ""}>${esc(plan.label)}${saving ? ` (${esc(saving)})` : ""}</option>`;
              })
              .join("")}
          </select>
        </div>`
      : `<div class="sm-frequencies sm-frequencies--${w.frequencyStyle}" role="radiogroup" data-sm-frequencies>
          ${SAMPLE.plans
            .map((plan, index) => {
              const saving = savingTemplate ? fill(savingTemplate, plan.saving) : "";
              return `<label class="sm-frequency"><input type="radio" name="sm-plan" value="${plan.id}"${index === 0 ? " checked" : ""}><span class="sm-frequency__label">${esc(plan.label)}</span>${saving ? `<span class="sm-frequency__saving">${esc(saving)}</span>` : ""}</label>`;
            })
            .join("")}
        </div>`;

  const benefits =
    w.showBenefits && w.benefits.length
      ? `<ul class="sm-benefits" role="list">${w.benefits
          .map(
            (benefit) =>
              `<li class="sm-benefit"><svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${esc(benefit)}</span></li>`,
          )
          .join("")}</ul>`
      : "";

  const variants = JSON.stringify({ "1": { oneTimePrice: SAMPLE.oneTime, allocations: SAMPLE.plans } });
  const classes = widgetClassList(w);

  const widget = `
  <subsmanager-widget id="sm-widget-preview" class="${esc(classes)}" data-initial-variant="1"
    data-save-template="${esc(savingTemplate)}" data-badge-template="${esc(w.showBadge ? w.badgeText : "")}"
    data-frequency-style="${w.frequencyStyle}" ${subscriptionOnly ? 'data-subscription-only="true"' : ""}
    style="${esc(widgetStyleAttribute(w))}">
    ${w.heading ? `<p class="sm-widget__heading">${esc(w.heading)}</p>` : ""}
    <div class="sm-option sm-option--subscription${subscribed ? " is-selected" : ""}" data-sm-subscription-option>
      <span class="sm-badge" data-sm-badge ${w.showBadge ? "" : 'data-disabled="true" hidden'}>${esc(fill(w.badgeText, best))}</span>
      <label class="sm-option__head">
        <input class="sm-radio" type="radio" name="sm-purchase" value="subscription" data-purchase-type="subscription"${subscribed ? " checked" : ""}>
        <span class="sm-option__title">${esc(w.subscribeLabel)}</span>
        <span class="sm-option__price"><s class="sm-compare" data-sm-compare>${first.compare}</s><strong class="sm-subscription-price" data-sm-subscription-price>${first.price}</strong></span>
      </label>
      <div class="sm-option__body">
        ${benefits}
        ${w.showFrequencyLabel && w.frequencyLabel ? `<p class="sm-frequency-label">${esc(w.frequencyLabel)}</p>` : ""}
        ${frequencies}
      </div>
    </div>
    <label class="sm-option sm-option--one-time${subscribed ? "" : " is-selected"}" data-sm-one-time-option ${subscriptionOnly ? "hidden" : ""}>
      <span class="sm-option__head">
        <input class="sm-radio" type="radio" name="sm-purchase" value="" data-purchase-type="one-time"${subscribed ? "" : " checked"}>
        <span class="sm-option__title">${esc(w.oneTimeLabel)}</span>
        <span class="sm-option__price sm-one-time-price" data-sm-one-time-price>${SAMPLE.oneTime}</span>
      </span>
    </label>
    ${w.showNote && w.note ? `<p class="sm-note">${esc(w.note)}</p>` : ""}
    <input type="hidden" name="selling_plan" form="preview-form" value="" data-sm-selling-plan disabled>
    <script type="application/json" data-sm-variants>${variants.replace(/</g, "\\u003c")}</script>
  </subsmanager-widget>`;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin: 0; padding: 16px; background: ${options.background || "#ffffff"}; color: #1a1a1a;
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .preview-button { margin-top: 4px; width: 100%; padding: 12px; border: 0; border-radius: 6px; background: #1a1a1a; color: #fff; font: inherit; font-weight: 600; }
  ${widgetCss}
</style>
<style>${w.customCss}</style>
</head><body>
<form id="preview-form" action="/cart/add" onsubmit="return false"><input type="hidden" name="id" value="1"></form>
${widget}
<button class="preview-button" type="button">Add to cart</button>
<script>${widgetJs.replace(/<\/script/gi, "<\\/script")}</script>
</body></html>`;
}
