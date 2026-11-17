// Design, texts and behavior of the product-page subscription widget, with a live preview.
import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureShop } from "../models/shop.server";
import { syncStorefrontSettings } from "../models/storefront-settings.server";
import {
  MAX_BENEFITS,
  MAX_CUSTOM_CSS,
  normalizeWidgetSettings,
  parseStoredWidget,
  type WidgetSettings,
} from "../lib/widget-settings";
import { widgetPreviewHtml } from "../lib/widget-preview";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  return { widget: parseStoredWidget(shop.widgetSettings), widgetOn: shop.showProductWidget };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  let input: unknown = {};
  if (formData.get("intent") !== "reset") {
    try {
      input = JSON.parse(String(formData.get("settings") || "{}"));
    } catch {
      return { ok: false, error: "The settings could not be read. Reload the page and try again." };
    }
  }
  const widget = normalizeWidgetSettings(input);
  const shop = await ensureShop(session.shop);
  const saved = await prisma.shop.update({ where: { id: shop.id }, data: { widgetSettings: JSON.stringify(widget) } });
  const published = await syncStorefrontSettings(saved, admin);
  if (!published.ok) {
    return { ok: false, widget, error: `Saved, but your store could not be updated yet: ${published.error}. Save again to retry.` };
  }
  return { ok: true, widget, message: formData.get("intent") === "reset" ? "Widget reset to the default design" : "Widget saved. Your product pages are updated." };
};

type Updater = <K extends keyof WidgetSettings>(key: K, value: WidgetSettings[K]) => void;

const CLASS_NAMES = [
  [".sm-widget", "The whole widget"],
  [".sm-widget__heading", "Heading"],
  [".sm-option", "Each option box"],
  [".sm-option--subscription / .sm-option--one-time", "Subscription / one-time box"],
  [".sm-option.is-selected", "The selected box"],
  [".sm-option__title / .sm-option__price", "Option name / price"],
  [".sm-compare", "Crossed-out price"],
  [".sm-badge", "Savings badge"],
  [".sm-benefits / .sm-benefit", "Benefits list / one benefit"],
  [".sm-frequency-label", "“Deliver every” label"],
  [".sm-frequency / .sm-frequency-select", "Frequency button / dropdown"],
  [".sm-frequency__saving", "Saving under a frequency"],
  [".sm-note", "Note under the options"],
] as const;

function ColorInput({ label, field, value, update, optional }: {
  label: string;
  field: keyof WidgetSettings;
  value: string;
  update: Updater;
  optional?: boolean;
}) {
  return (
    <s-stack direction="block" gap="small-200">
      <s-color-field
        label={label}
        value={value}
        placeholder={optional ? "Theme color" : undefined}
        onChange={(event) => update(field, event.currentTarget.value as never)}
      ></s-color-field>
      {optional && value ? (
        <s-link onClick={() => update(field, "" as never)}>Use theme color</s-link>
      ) : null}
    </s-stack>
  );
}

function NumberInput({ label, field, value, update, min, max, suffix, details }: {
  label: string;
  field: keyof WidgetSettings;
  value: number;
  update: Updater;
  min: number;
  max: number;
  suffix?: string;
  details?: string;
}) {
  return (
    <s-number-field
      label={label}
      value={String(value)}
      min={min}
      max={max}
      suffix={suffix}
      details={details}
      onChange={(event) => update(field, Number(event.currentTarget.value || 0) as never)}
    ></s-number-field>
  );
}

function Toggle({ label, field, value, update, details }: {
  label: string;
  field: keyof WidgetSettings;
  value: boolean;
  update: Updater;
  details?: string;
}) {
  return (
    <s-switch
      label={label}
      details={details}
      checked={value}
      onChange={(event) => update(field, event.currentTarget.checked as never)}
    ></s-switch>
  );
}

export default function WidgetPage() {
  const { widget: saved, widgetOn } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [w, setW] = useState<WidgetSettings>(saved);
  // After a save or reset the page reloads the saved settings; show them in the form.
  const [shownSaved, setShownSaved] = useState(saved);
  if (saved !== shownSaved) {
    setShownSaved(saved);
    setW(saved);
  }
  const [previewBackground, setPreviewBackground] = useState("#ffffff");
  const [previewWidth, setPreviewWidth] = useState<"desktop" | "mobile">("desktop");
  const busy = fetcher.state !== "idle";
  const dirty = JSON.stringify(w) !== JSON.stringify(saved);

  const update: Updater = (key, value) => setW((current) => ({ ...current, [key]: value }));
  const setBenefit = (index: number, value: string) =>
    setW((current) => {
      const benefits = [...current.benefits];
      benefits[index] = value;
      return { ...current, benefits };
    });

  useEffect(() => {
    if (!fetcher.data || fetcher.state !== "idle") return;
    if (fetcher.data.ok) shopify.toast.show(fetcher.data.message || "Saved");
    else shopify.toast.show(fetcher.data.error || "Could not save", { isError: true });
  }, [fetcher.data, fetcher.state, shopify]);

  // The preview uses the settings exactly as they will be saved (same validation).
  const preview = useMemo(
    () => widgetPreviewHtml(normalizeWidgetSettings({ ...w, benefits: w.benefits }), { background: previewBackground }),
    [w, previewBackground],
  );

  const save = () => fetcher.submit({ intent: "save", settings: JSON.stringify(w) }, { method: "POST" });
  const benefitFields = Array.from({ length: MAX_BENEFITS }, (_, index) => w.benefits[index] || "");

  return (
    <s-page heading="Widget">
      <s-button slot="primary-action" variant="primary" loading={busy} disabled={!dirty} onClick={save}>
        Save
      </s-button>
      <s-button slot="secondary-actions" disabled={busy || !dirty} onClick={() => setW(saved)}>
        Discard changes
      </s-button>
      <s-button
        slot="secondary-actions"
        disabled={busy}
        onClick={() => {
          if (window.confirm("Reset every widget setting to the default design?")) {
            fetcher.submit({ intent: "reset" }, { method: "POST" });
          }
        }}
      >
        Reset to default
      </s-button>

      {!widgetOn ? (
        <s-banner tone="warning" heading="The widget is turned off">
          Customers don’t see it until you turn on “Show subscription options on product pages” in{" "}
          <s-link href="/app/settings">Settings</s-link>.
        </s-banner>
      ) : null}
      {fetcher.data && !fetcher.data.ok && fetcher.state === "idle" ? (
        <s-banner tone="critical">{fetcher.data.error}</s-banner>
      ) : null}

      <s-section heading="Purchase options">
        <s-stack direction="block" gap="base">
          <s-select
            label="What customers can choose"
            value={w.purchase}
            onChange={(event) => update("purchase", event.currentTarget.value as WidgetSettings["purchase"])}
          >
            <s-option value="both">Subscription or one-time purchase</s-option>
            <s-option value="subscription_only">Subscription only</s-option>
          </s-select>
          {w.purchase === "subscription_only" ? (
            <s-banner tone="info">
              The one-time option is hidden on every product page that has a subscription plan. To make a product
              impossible to buy without a subscription anywhere (quick-add buttons, links), also set the plan to
              “subscription only” in Seal.
            </s-banner>
          ) : (
            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <s-select
                label="Selected by default"
                value={w.defaultOption}
                onChange={(event) => update("defaultOption", event.currentTarget.value as WidgetSettings["defaultOption"])}
              >
                <s-option value="subscription">Subscription</s-option>
                <s-option value="one_time">One-time purchase</s-option>
              </s-select>
              <s-select
                label="Order"
                value={w.order}
                onChange={(event) => update("order", event.currentTarget.value as WidgetSettings["order"])}
              >
                <s-option value="subscription_first">Subscription first</s-option>
                <s-option value="one_time_first">One-time purchase first</s-option>
              </s-select>
            </s-grid>
          )}
          <s-select
            label="How delivery frequencies are shown"
            value={w.frequencyStyle}
            onChange={(event) => update("frequencyStyle", event.currentTarget.value as WidgetSettings["frequencyStyle"])}
          >
            <s-option value="buttons">Buttons</s-option>
            <s-option value="list">List with radio buttons</s-option>
            <s-option value="dropdown">Dropdown</s-option>
          </s-select>
        </s-stack>
      </s-section>

      <s-section heading="Texts">
        <s-stack direction="block" gap="base">
          <s-text-field label="Heading" value={w.heading} placeholder="No heading" onInput={(event) => update("heading", event.currentTarget.value)}></s-text-field>
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <s-text-field label="Subscription option" value={w.subscribeLabel} onInput={(event) => update("subscribeLabel", event.currentTarget.value)}></s-text-field>
            <s-text-field label="One-time option" value={w.oneTimeLabel} onInput={(event) => update("oneTimeLabel", event.currentTarget.value)}></s-text-field>
            <s-text-field label="Frequency label" value={w.frequencyLabel} onInput={(event) => update("frequencyLabel", event.currentTarget.value)}></s-text-field>
            <s-text-field
              label="Saving under each frequency"
              value={w.savingText}
              details="[saving] becomes the percentage, e.g. “save 20%”."
              onInput={(event) => update("savingText", event.currentTarget.value)}
            ></s-text-field>
          </s-grid>
          <s-text-field
            label="Savings badge"
            value={w.badgeText}
            details="[saving] becomes the best saving available."
            onInput={(event) => update("badgeText", event.currentTarget.value)}
          ></s-text-field>
          <s-stack direction="block" gap="small">
            <s-text type="strong">Benefits</s-text>
            {benefitFields.map((benefit, index) => (
              <s-text-field
                key={index}
                label={`Benefit ${index + 1}`}
                labelAccessibilityVisibility="exclusive"
                placeholder={`Benefit ${index + 1} (optional)`}
                value={benefit}
                onInput={(event) => setBenefit(index, event.currentTarget.value)}
              ></s-text-field>
            ))}
          </s-stack>
          <s-text-area label="Note under the options" rows={2} value={w.note} onInput={(event) => update("note", event.currentTarget.value)}></s-text-area>
        </s-stack>
      </s-section>

      <s-section heading="Show or hide">
        <s-grid gridTemplateColumns="1fr 1fr" gap="base">
          <Toggle label="Radio buttons (circles) on the options" field="showRadios" value={w.showRadios} update={update} />
          <Toggle label="Savings badge" field="showBadge" value={w.showBadge} update={update} />
          <Toggle label="Prices" field="showPrices" value={w.showPrices} update={update} />
          <Toggle label="Crossed-out original price" field="showComparePrice" value={w.showComparePrice} update={update} />
          <Toggle label="Benefits" field="showBenefits" value={w.showBenefits} update={update} />
          <Toggle label="Frequency label" field="showFrequencyLabel" value={w.showFrequencyLabel} update={update} />
          <Toggle label="Saving under each frequency" field="showSavings" value={w.showSavings} update={update} />
          <Toggle label="Note under the options" field="showNote" value={w.showNote} update={update} />
        </s-grid>
      </s-section>

      <s-section heading="Colors">
        <s-grid gridTemplateColumns="1fr 1fr" gap="base">
          <ColorInput label="Main color (selected frequency, radio)" field="accentColor" value={w.accentColor} update={update} />
          <ColorInput label="Text on main color" field="accentTextColor" value={w.accentTextColor} update={update} />
          <ColorInput label="Selected option background" field="selectedBackground" value={w.selectedBackground} update={update} />
          <ColorInput label="Option background" field="optionBackground" value={w.optionBackground} update={update} optional />
          <ColorInput label="Border" field="borderColor" value={w.borderColor} update={update} />
          <ColorInput label="Selected option border" field="selectedBorderColor" value={w.selectedBorderColor} update={update} optional />
          <ColorInput label="Text" field="textColor" value={w.textColor} update={update} optional />
          <ColorInput label="Heading" field="headingColor" value={w.headingColor} update={update} optional />
          <ColorInput label="Frequency button background" field="frequencyBackground" value={w.frequencyBackground} update={update} />
          <ColorInput label="Frequency button text" field="frequencyTextColor" value={w.frequencyTextColor} update={update} optional />
          <ColorInput label="Badge background" field="badgeBackground" value={w.badgeBackground} update={update} optional />
          <ColorInput label="Badge text" field="badgeTextColor" value={w.badgeTextColor} update={update} optional />
          <ColorInput label="Benefit check marks" field="iconColor" value={w.iconColor} update={update} optional />
        </s-grid>
      </s-section>

      <s-section heading="Size and spacing">
        <s-grid gridTemplateColumns="1fr 1fr" gap="base">
          <NumberInput label="Text size" field="fontSize" value={w.fontSize} update={update} min={0} max={24} suffix="px" details="0 uses your theme’s size." />
          <NumberInput label="Corner radius" field="radius" value={w.radius} update={update} min={0} max={40} suffix="px" />
          <NumberInput label="Border width" field="borderWidth" value={w.borderWidth} update={update} min={0} max={6} suffix="px" />
          <NumberInput label="Inner spacing" field="padding" value={w.padding} update={update} min={4} max={40} suffix="px" />
          <NumberInput label="Space between options" field="gap" value={w.gap} update={update} min={0} max={40} suffix="px" />
          <NumberInput label="Maximum width" field="maxWidth" value={w.maxWidth} update={update} min={0} max={1200} suffix="px" details="0 uses the full width." />
          <NumberInput label="Space above" field="marginTop" value={w.marginTop} update={update} min={0} max={80} suffix="px" />
          <NumberInput label="Space below" field="marginBottom" value={w.marginBottom} update={update} min={0} max={80} suffix="px" />
        </s-grid>
      </s-section>

      <s-section heading="Custom code">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Extra CSS class on the widget"
            value={w.className}
            placeholder="my-subscription-widget"
            details="Added to the widget element, next to sm-widget. Letters, numbers, - and _ only."
            onInput={(event) => update("className", event.currentTarget.value)}
          ></s-text-field>
          <s-text-area
            label="Custom CSS"
            rows={10}
            value={w.customCss}
            placeholder={".sm-widget .sm-option__title {\n  text-transform: uppercase;\n}"}
            details={`Applied on product pages after the widget’s own styles. Up to ${MAX_CUSTOM_CSS.toLocaleString()} characters.`}
            onInput={(event) => update("customCss", event.currentTarget.value)}
          ></s-text-area>
          <s-table variant="list">
            <s-table-header-row>
              <s-table-header listSlot="primary">Class</s-table-header>
              <s-table-header>Element</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {CLASS_NAMES.map(([name, element]) => (
                <s-table-row key={name}>
                  <s-table-cell><s-text type="strong">{name}</s-text></s-table-cell>
                  <s-table-cell>{element}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Preview">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small">
            <s-button variant={previewWidth === "desktop" ? "primary" : "secondary"} onClick={() => setPreviewWidth("desktop")}>Desktop</s-button>
            <s-button variant={previewWidth === "mobile" ? "primary" : "secondary"} onClick={() => setPreviewWidth("mobile")}>Mobile</s-button>
          </s-stack>
          <s-color-field
            label="Preview page background"
            value={previewBackground}
            onChange={(event) => setPreviewBackground(event.currentTarget.value || "#ffffff")}
          ></s-color-field>
          <s-box border="base" borderRadius="base" overflow="hidden">
            <iframe
              title="Widget preview"
              sandbox="allow-scripts"
              srcDoc={preview}
              style={{ border: 0, display: "block", height: 620, margin: "0 auto", maxWidth: "100%", width: previewWidth === "mobile" ? 360 : "100%" }}
            />
          </s-box>
          <s-paragraph color="subdued">
            Sample prices. The preview is interactive: click the options to try them. Your theme’s fonts may look
            slightly different on the store.
          </s-paragraph>
          {dirty ? <s-badge tone="warning">Unsaved changes</s-badge> : null}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Where it shows">
        <s-paragraph>
          Add the “Subscription selector” block to your product template in the theme editor once. Every change
          saved here updates all product pages right away; nothing needs to be published again.
        </s-paragraph>
        <s-button href={`shopify://admin/themes/current/editor?template=product`}>Open theme editor</s-button>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
