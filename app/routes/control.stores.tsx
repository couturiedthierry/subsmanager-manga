import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { requireControlUser } from "../lib/control-auth.server";
import { controlStores } from "../models/control.server";
import { formatDate } from "../lib/format";
import { ControlLink, EmptyState, PageHeader, Panel, StatusBadge, styles } from "../components/control-ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireControlUser(request);
  return controlStores();
};

export default function ControlStores() {
  const stores = useLoaderData<typeof loader>();
  return (
    <>
      <PageHeader
        eyebrow="Tenant operations"
        title="Connected stores"
        description="Each store appears after installing SubsManager Manga and completing Shopify authorization."
      />
      <Panel title={`${stores.length} store${stores.length === 1 ? "" : "s"}`} description="Connection, contract, and webhook health">
        {stores.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Store</th><th>Connection</th><th>Subscriptions</th><th>Needs attention</th><th>Last webhook</th></tr></thead>
              <tbody>
                {stores.map((store) => (
                  <tr key={store.id}>
                    <td className={styles.primaryCell}>
                      <ControlLink to={`/control/stores/${store.id}`}>{store.displayName || store.domain}</ControlLink>
                      <span className={styles.secondaryText}>{store.domain}</span>
                    </td>
                    <td><StatusBadge value={store.connected ? "Connected" : "Disconnected"} /></td>
                    <td>{store.activeContracts}<span className={styles.secondaryText}>{store._count.contracts} total contracts</span></td>
                    <td>{store.attentionContracts}</td>
                    <td>{store.lastWebhookAt ? formatDate(store.lastWebhookAt) : "No webhook received"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No Shopify stores connected" description="Install the development app on a store to establish an offline authorization session." />
        )}
      </Panel>
    </>
  );
}
