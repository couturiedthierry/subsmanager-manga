import type { ReactNode } from "react";
import { Link, useOutletContext } from "react-router";
import type { SafeStaffUser } from "../lib/control-auth.server";
import styles from "../styles/control.module.css";

export type ControlOutletContext = {
  user: SafeStaffUser;
  csrfToken: string;
};

export function useControlContext() {
  return useOutletContext<ControlOutletContext>();
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      <div>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className={styles.pageDescription}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.headerActions}>{actions}</div> : null}
    </header>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: "neutral" | "positive" | "warning" | "critical";
}) {
  return (
    <article className={`${styles.metricCard} ${styles[`metric_${tone}`]}`}>
      <div className={styles.metricTop}>
        <span>{label}</span>
        <i aria-hidden="true" />
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

export function StatusBadge({ value }: { value: string }) {
  const normalized = value.toUpperCase();
  const tone = ["ACTIVE", "SUCCESS", "CONNECTED", "OWNER"].includes(normalized)
    ? "success"
    : ["FAILED", "FAILURE", "CANCELLED", "DISCONNECTED"].includes(normalized)
      ? "critical"
      : ["PAUSED", "PENDING", "SUPPORT"].includes(normalized) || normalized.startsWith("DUE")
        ? "warning"
        : "neutral";
  return <span className={`${styles.badge} ${styles[`badge_${tone}`]}`}>{value}</span>;
}

export function Panel({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${styles.panel} ${className}`}>
      {title || action ? (
        <div className={styles.panelHeader}>
          <div>
            {title ? <h2>{title}</h2> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className={styles.emptyState}>
      <span aria-hidden="true">SM</span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

export function Pagination({
  page,
  pages,
  buildHref,
}: {
  page: number;
  pages: number;
  buildHref: (page: number) => string;
}) {
  if (pages <= 1) return null;
  return (
    <nav className={styles.pagination} aria-label="Pagination">
      {page > 1 ? <Link to={buildHref(page - 1)}>Previous</Link> : <span>Previous</span>}
      <strong>Page {page} of {pages}</strong>
      {page < pages ? <Link to={buildHref(page + 1)}>Next</Link> : <span>Next</span>}
    </nav>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "success" | "warning" | "critical"; children: ReactNode }) {
  return <div className={`${styles.notice} ${styles[`notice_${tone}`]}`}>{children}</div>;
}

export function ControlLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link className={styles.textLink} to={to}>{children}</Link>;
}

export { styles };
