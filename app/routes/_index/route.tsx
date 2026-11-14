import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect } from "react-router";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export const meta: MetaFunction = () => [
  { title: "SubsManager Manga — Shopify subscriptions" },
  {
    name: "description",
    content: "Subscription plans, renewal operations, analytics, and customer self-service for Shopify.",
  },
];

export default function App() {
  return (
    <main className={styles.index}>
      <nav className={styles.nav} aria-label="Primary navigation">
        <a className={styles.brand} href="/" aria-label="SubsManager Manga home">
          <span className={styles.mark}>SM</span>
          <span>SubsManager Manga</span>
        </a>
        <span className={styles.shopifyBadge}>Built on Shopify APIs</span>
      </nav>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>Subscription operations, in one place</span>
          <h1 className={styles.heading}>Recurring revenue that feels native to your store.</h1>
          <p className={styles.text}>
            Create purchase options, manage contracts, recover payments, and give customers a
            polished self-service portal—all while Shopify keeps checkout and card data secure.
          </p>
          <div className={styles.installNote}>
            <span className={styles.statusDot} aria-hidden="true"></span>
            Install SubsManager Manga from its Shopify-owned App Store or Partner development link.
          </div>
        </div>

        <div className={styles.preview} aria-label="Example subscription dashboard using sample data">
          <div className={styles.previewHeader}>
            <div>
              <span className={styles.previewKicker}>Example dashboard</span>
              <strong>Subscription health</strong>
            </div>
            <span className={styles.liveBadge}>Sample data</span>
          </div>
          <div className={styles.metrics}>
            <article><span>Active</span><strong>1,248</strong><small>+8.4%</small></article>
            <article><span>Next-cycle revenue</span><strong>$48.2k</strong><small>Projected</small></article>
          </div>
          <div className={styles.chart} aria-hidden="true">
            <span style={{ height: "38%" }}></span><span style={{ height: "52%" }}></span>
            <span style={{ height: "47%" }}></span><span style={{ height: "68%" }}></span>
            <span style={{ height: "61%" }}></span><span style={{ height: "79%" }}></span>
            <span style={{ height: "92%" }}></span>
          </div>
          <div className={styles.previewFooter}>
            <span>Payment success</span><strong>97.6%</strong>
          </div>
        </div>
      </section>

      <section className={styles.features} aria-label="Features">
        <article>
          <span className={styles.featureIcon}>01</span>
          <h2>Shopify-native plans</h2>
          <p>Create recurring delivery and discounts from the app or directly on product pages.</p>
        </article>
        <article>
          <span className={styles.featureIcon}>02</span>
          <h2>Customer self-service</h2>
          <p>Buyers can pause, resume, skip, cancel, and replace payment methods in their account.</p>
        </article>
        <article>
          <span className={styles.featureIcon}>03</span>
          <h2>Reliable operations</h2>
          <p>Authenticated webhooks, idempotent jobs, retry controls, and renewal analytics are built in.</p>
        </article>
      </section>

      <footer className={styles.footer}>
        <span>SubsManager Manga</span>
        <span>Checkout and vaulted payment details stay with Shopify.</span>
      </footer>
    </main>
  );
}
