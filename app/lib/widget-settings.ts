/**
 * Settings for the product-page subscription widget, edited on the app's Widget page.
 * They are published to the shop metafield `subsmanager.settings` (key `widget`) and read by
 * the theme block, so design changes never need the widget to be republished.
 * Everything is validated here, because the values end up in the storefront's HTML and CSS.
 */

export type WidgetSettings = {
  purchase: "both" | "subscription_only";
  defaultOption: "subscription" | "one_time";
  order: "subscription_first" | "one_time_first";
  frequencyStyle: "buttons" | "dropdown" | "list";

  heading: string;
  subscribeLabel: string;
  oneTimeLabel: string;
  frequencyLabel: string;
  savingText: string;
  badgeText: string;
  benefits: string[];
  note: string;

  showRadios: boolean;
  showBadge: boolean;
  showPrices: boolean;
  showComparePrice: boolean;
  showBenefits: boolean;
  showNote: boolean;
  showFrequencyLabel: boolean;
  showSavings: boolean;

  fontSize: number;
  textColor: string;
  headingColor: string;
  optionBackground: string;
  selectedBackground: string;
  borderColor: string;
  selectedBorderColor: string;
  accentColor: string;
  accentTextColor: string;
  frequencyBackground: string;
  frequencyTextColor: string;
  badgeBackground: string;
  badgeTextColor: string;
  iconColor: string;
  borderWidth: number;
  radius: number;
  padding: number;
  gap: number;
  marginTop: number;
  marginBottom: number;
  maxWidth: number;

  className: string;
  customCss: string;
};

export const DEFAULT_WIDGET: WidgetSettings = {
  purchase: "both",
  defaultOption: "subscription",
  order: "subscription_first",
  frequencyStyle: "buttons",

  heading: "",
  subscribeLabel: "Subscribe & save",
  oneTimeLabel: "One-time purchase",
  frequencyLabel: "Deliver every:",
  savingText: "save [saving]",
  badgeText: "SAVE UP TO [saving]",
  benefits: ["No commitment — pause or cancel anytime", "Skip or reschedule deliveries from your account"],
  note: "Subscription orders repeat at the frequency you choose. Manage everything from your account.",

  showRadios: false,
  showBadge: true,
  showPrices: true,
  showComparePrice: true,
  showBenefits: true,
  showNote: true,
  showFrequencyLabel: true,
  showSavings: true,

  fontSize: 0,
  textColor: "",
  headingColor: "",
  optionBackground: "",
  selectedBackground: "#fdf7ef",
  borderColor: "#e9dcc9",
  selectedBorderColor: "",
  accentColor: "#23395d",
  accentTextColor: "#ffffff",
  frequencyBackground: "#ffffff",
  frequencyTextColor: "",
  badgeBackground: "",
  badgeTextColor: "",
  iconColor: "",
  borderWidth: 1,
  radius: 10,
  padding: 16,
  gap: 12,
  marginTop: 16,
  marginBottom: 20,
  maxWidth: 0,

  className: "",
  customCss: "",
};

export const MAX_BENEFITS = 5;
export const MAX_CUSTOM_CSS = 10_000;

/** Color settings that may be left empty to use the theme's own color. */
export const OPTIONAL_COLORS = new Set<keyof WidgetSettings>([
  "textColor",
  "headingColor",
  "optionBackground",
  "selectedBorderColor",
  "frequencyTextColor",
  "badgeBackground",
  "badgeTextColor",
  "iconColor",
]);

const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function text(value: unknown, fallback: string, max = 200) {
  if (typeof value !== "string") return fallback;
  return value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

function choice<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (value === "on" || value === "true") return true;
  if (value === "false" || value === "off") return false;
  return fallback;
}

function num(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function color(value: unknown, fallback: string, optional: boolean) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return optional ? "" : fallback;
  const hex = raw.startsWith("#") ? raw : `#${raw}`;
  return COLOR.test(hex) ? hex.toLowerCase() : fallback;
}

/** Only letters, digits, dashes and underscores, separated by spaces. */
function classNames(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .split(/\s+/)
    .map((name) => name.replace(/[^a-zA-Z0-9_-]/g, ""))
    .filter((name) => name && /^[a-zA-Z_-]/.test(name))
    .slice(0, 10)
    .join(" ")
    .slice(0, 200);
}

/** Custom CSS goes inside a <style> tag, so "<" (which could close it) is removed. */
export function sanitizeCss(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/</g, "").slice(0, MAX_CUSTOM_CSS);
}

export function normalizeWidgetSettings(input: unknown): WidgetSettings {
  const source = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_WIDGET;
  const benefitsSource = Array.isArray(source.benefits) ? source.benefits : d.benefits;
  const colorValue = (key: keyof WidgetSettings) =>
    color(source[key], d[key] as string, OPTIONAL_COLORS.has(key));
  return {
    purchase: choice(source.purchase, ["both", "subscription_only"] as const, d.purchase),
    defaultOption: choice(source.defaultOption, ["subscription", "one_time"] as const, d.defaultOption),
    order: choice(source.order, ["subscription_first", "one_time_first"] as const, d.order),
    frequencyStyle: choice(source.frequencyStyle, ["buttons", "dropdown", "list"] as const, d.frequencyStyle),

    heading: text(source.heading, d.heading),
    subscribeLabel: text(source.subscribeLabel, d.subscribeLabel) || d.subscribeLabel,
    oneTimeLabel: text(source.oneTimeLabel, d.oneTimeLabel) || d.oneTimeLabel,
    frequencyLabel: text(source.frequencyLabel, d.frequencyLabel),
    savingText: text(source.savingText, d.savingText),
    badgeText: text(source.badgeText, d.badgeText, 60),
    benefits: benefitsSource
      .map((benefit) => text(benefit, ""))
      .filter(Boolean)
      .slice(0, MAX_BENEFITS),
    note: text(source.note, d.note, 400),

    showRadios: bool(source.showRadios, d.showRadios),
    showBadge: bool(source.showBadge, d.showBadge),
    showPrices: bool(source.showPrices, d.showPrices),
    showComparePrice: bool(source.showComparePrice, d.showComparePrice),
    showBenefits: bool(source.showBenefits, d.showBenefits),
    showNote: bool(source.showNote, d.showNote),
    showFrequencyLabel: bool(source.showFrequencyLabel, d.showFrequencyLabel),
    showSavings: bool(source.showSavings, d.showSavings),

    fontSize: num(source.fontSize, d.fontSize, 0, 24),
    textColor: colorValue("textColor"),
    headingColor: colorValue("headingColor"),
    optionBackground: colorValue("optionBackground"),
    selectedBackground: colorValue("selectedBackground"),
    borderColor: colorValue("borderColor"),
    selectedBorderColor: colorValue("selectedBorderColor"),
    accentColor: colorValue("accentColor"),
    accentTextColor: colorValue("accentTextColor"),
    frequencyBackground: colorValue("frequencyBackground"),
    frequencyTextColor: colorValue("frequencyTextColor"),
    badgeBackground: colorValue("badgeBackground"),
    badgeTextColor: colorValue("badgeTextColor"),
    iconColor: colorValue("iconColor"),
    borderWidth: num(source.borderWidth, d.borderWidth, 0, 6),
    radius: num(source.radius, d.radius, 0, 40),
    padding: num(source.padding, d.padding, 4, 40),
    gap: num(source.gap, d.gap, 0, 40),
    marginTop: num(source.marginTop, d.marginTop, 0, 80),
    marginBottom: num(source.marginBottom, d.marginBottom, 0, 80),
    maxWidth: num(source.maxWidth, d.maxWidth, 0, 1200),

    className: classNames(source.className),
    customCss: sanitizeCss(source.customCss),
  };
}

export function parseStoredWidget(json: string | null | undefined) {
  if (!json) return { ...DEFAULT_WIDGET };
  try {
    return normalizeWidgetSettings(JSON.parse(json));
  } catch {
    return { ...DEFAULT_WIDGET };
  }
}

/**
 * CSS custom properties for the widget. Empty optional colors fall back to related values in the
 * stylesheet, so the theme's colors are used. Shared by the storefront payload and the preview.
 */
export function widgetCssVariables(w: WidgetSettings): Record<string, string> {
  const vars: Record<string, string> = {
    "--sm-surface": w.selectedBackground,
    "--sm-border": w.borderColor,
    "--sm-accent": w.accentColor,
    "--sm-accent-text": w.accentTextColor,
    "--sm-freq-bg": w.frequencyBackground,
    "--sm-border-width": `${w.borderWidth}px`,
    "--sm-radius": `${w.radius}px`,
    "--sm-pad": `${w.padding}px`,
    "--sm-gap": `${w.gap}px`,
    "--sm-mt": `${w.marginTop}px`,
    "--sm-mb": `${w.marginBottom}px`,
  };
  if (w.fontSize) vars["--sm-font-size"] = `${w.fontSize}px`;
  if (w.maxWidth) vars["--sm-max-width"] = `${w.maxWidth}px`;
  if (w.textColor) vars["--sm-text"] = w.textColor;
  if (w.headingColor) vars["--sm-heading"] = w.headingColor;
  if (w.optionBackground) vars["--sm-option-bg"] = w.optionBackground;
  if (w.selectedBorderColor) vars["--sm-border-selected"] = w.selectedBorderColor;
  if (w.frequencyTextColor) vars["--sm-freq-text"] = w.frequencyTextColor;
  if (w.badgeBackground) vars["--sm-badge-bg"] = w.badgeBackground;
  if (w.badgeTextColor) vars["--sm-badge-text"] = w.badgeTextColor;
  if (w.iconColor) vars["--sm-icon"] = w.iconColor;
  return vars;
}

export function widgetStyleAttribute(w: WidgetSettings) {
  return Object.entries(widgetCssVariables(w))
    .map(([key, value]) => `${key}: ${value};`)
    .join(" ");
}

/** Class names on the widget element, shared by the theme block (via the payload) and the preview. */
export function widgetClassList(w: WidgetSettings) {
  return [
    "sm-widget",
    w.order === "one_time_first" ? "sm-widget--one-time-first" : "",
    w.purchase === "subscription_only" ? "sm-widget--subscription-only" : "",
    `sm-widget--frequency-${w.frequencyStyle}`,
    w.showRadios ? "" : "sm-widget--no-radios",
    w.showPrices ? "" : "sm-widget--no-prices",
    w.showComparePrice ? "" : "sm-widget--no-compare",
    w.className,
  ]
    .filter(Boolean)
    .join(" ");
}
