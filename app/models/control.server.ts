import prisma from "../db.server";
import type { AdminGraphqlClient } from "../lib/graphql.server";
import { graphqlRequest } from "../lib/graphql.server";
import { CONTRACTS_PAGE_QUERY, PLAN_GROUPS_PAGE_QUERY } from "../lib/shopify-queries";
import { parseContractLines } from "../lib/control-data";
import { ensureShop } from "./shop.server";
import { saveContractSnapshot } from "./subscriptions.server";

type ContractsPage = {
  subscriptionContracts: {
    nodes: Array<Parameters<typeof saveContractSnapshot>[1]>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

type PlanGroupsPage = {
  shop: { name: string; currencyCode: string };
  sellingPlanGroups: {
    nodes: Array<{
      id: string;
      name: string;
      merchantCode: string | null;
      productsCount: { count: number } | null;
      sellingPlans: { nodes: Array<{ id: string; name: string }> };
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

const MAX_SYNC_PAGES = 50; // 5,000 contracts per run

/** Mirrors every matching Shopify contract into the local database. */
export async function syncAllContracts(shopDomain: string, admin: AdminGraphqlClient, query?: string) {
  let after: string | null = null;
  let synchronized = 0;
  let due = 0;
  const now = Date.now();
  for (let page = 0; page < MAX_SYNC_PAGES; page += 1) {
    const data: ContractsPage = await graphqlRequest<ContractsPage>(admin, CONTRACTS_PAGE_QUERY, {
      query: query || null,
      after,
    });
    for (const contract of data.subscriptionContracts.nodes) {
      await saveContractSnapshot(shopDomain, contract);
      synchronized += 1;
      if (
        contract.status === "ACTIVE" &&
        contract.nextBillingDate &&
        new Date(contract.nextBillingDate).getTime() <= now
      ) {
        due += 1;
      }
    }
    if (!data.subscriptionContracts.pageInfo.hasNextPage) break;
    after = data.subscriptionContracts.pageInfo.endCursor;
  }
  return { synchronized, due };
}

export async function syncStoreSnapshot(shopDomain: string, admin: AdminGraphqlClient) {
  let after: string | null = null;
  let plans = 0;
  let shopInfo: PlanGroupsPage["shop"] | null = null;
  const seen: string[] = [];
  for (let page = 0; page < 20; page += 1) {
    const data: PlanGroupsPage = await graphqlRequest<PlanGroupsPage>(admin, PLAN_GROUPS_PAGE_QUERY, { after });
    shopInfo = data.shop;
    for (const plan of data.sellingPlanGroups.nodes) {
      seen.push(plan.id);
      await prisma.sellingPlanCache.upsert({
        where: { shopifyId: plan.id },
        create: {
          shopDomain,
          shopifyId: plan.id,
          name: plan.name,
          merchantCode: plan.merchantCode,
          rawJson: JSON.stringify(plan),
        },
        update: {
          shopDomain,
          name: plan.name,
          merchantCode: plan.merchantCode,
          status: "ACTIVE",
          rawJson: JSON.stringify(plan),
        },
      });
      plans += 1;
    }
    if (!data.sellingPlanGroups.pageInfo.hasNextPage) break;
    after = data.sellingPlanGroups.pageInfo.endCursor;
  }
  // Plan groups deleted in Shopify while webhooks were unavailable.
  await prisma.sellingPlanCache.updateMany({
    where: { shopDomain, status: "ACTIVE", shopifyId: { notIn: seen } },
    data: { status: "DELETED" },
  });

  const shop = await ensureShop(shopDomain, shopInfo?.name);
  if (shopInfo) {
    await prisma.shop.update({ where: { id: shop.id }, data: { currencyCode: shopInfo.currencyCode } });
  }
  const contracts = await syncAllContracts(shopDomain, admin);
  return { shop, contracts: contracts.synchronized, due: contracts.due, plans };
}

export async function controlDashboard() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const now = new Date();
  const [storeCount, activeContracts, dueContracts, attentionContracts, attempts, recentContracts, activity] =
    await Promise.all([
      prisma.shop.count(),
      prisma.subscriptionContract.count({ where: { status: "ACTIVE" } }),
      prisma.subscriptionContract.count({
        where: { status: "ACTIVE", nextBillingAt: { lte: now } },
      }),
      prisma.subscriptionContract.count({ where: { status: { in: ["FAILED", "PAUSED"] } } }),
      prisma.billingAttempt.findMany({
        where: { attemptedAt: { gte: since } },
        orderBy: { attemptedAt: "asc" },
      }),
      prisma.subscriptionContract.findMany({
        include: { shop: true },
        orderBy: { updatedAt: "desc" },
        take: 8,
      }),
      prisma.auditEvent.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    ]);

  const successful = attempts.filter((attempt) => attempt.status === "SUCCESS");
  const failed = attempts.filter((attempt) => attempt.status === "FAILURE");
  const revenue = successful.reduce((sum, attempt) => sum + Number(attempt.amount || 0), 0);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - (6 - index));
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + 1);
    const dayAttempts = attempts.filter(
      (attempt) => attempt.attemptedAt >= date && attempt.attemptedAt < next,
    );
    return {
      label: date.toLocaleDateString("en", { weekday: "short", timeZone: "UTC" }),
      revenue: dayAttempts
        .filter((attempt) => attempt.status === "SUCCESS")
        .reduce((sum, attempt) => sum + Number(attempt.amount || 0), 0),
      attempts: dayAttempts.length,
    };
  });

  return {
    metrics: {
      stores: storeCount,
      activeContracts,
      dueContracts,
      attentionContracts,
      revenue,
      successRate: attempts.length ? Math.round((successful.length / attempts.length) * 100) : 100,
      failedPayments: failed.length,
    },
    days,
    recentContracts: recentContracts.map((contract) => ({
      ...contract,
      rawJson: null,
      billingDue: contract.status === "ACTIVE" && Boolean(
        contract.nextBillingAt && contract.nextBillingAt.getTime() <= now.getTime(),
      ),
      lines: parseContractLines(contract.linesJson),
    })),
    activity,
  };
}

export async function controlStores() {
  const [shops, offlineSessions] = await Promise.all([
    prisma.shop.findMany({
      include: {
        _count: { select: { contracts: true, billingAttempts: true } },
        contracts: { select: { status: true } },
        webhookEvents: { orderBy: { processedAt: "desc" }, take: 1, select: { processedAt: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.session.findMany({ where: { isOnline: false }, select: { shop: true, expires: true } }),
  ]);
  const sessions = new Map(offlineSessions.map((session) => [session.shop, session]));
  return shops.map((shop) => ({
    ...shop,
    connected: sessions.has(shop.domain),
    tokenExpiresAt: sessions.get(shop.domain)?.expires || null,
    activeContracts: shop.contracts.filter((contract) => contract.status === "ACTIVE").length,
    attentionContracts: shop.contracts.filter((contract) => ["FAILED", "PAUSED"].includes(contract.status)).length,
    lastWebhookAt: shop.webhookEvents[0]?.processedAt || null,
  }));
}

export async function controlStoreDetail(id: string) {
  const shop = await prisma.shop.findUnique({
    where: { id },
    include: {
      contracts: { orderBy: { updatedAt: "desc" }, take: 10 },
      billingAttempts: { orderBy: { attemptedAt: "desc" }, take: 10 },
      webhookEvents: {
        orderBy: { processedAt: "desc" },
        take: 12,
        select: { id: true, topic: true, processedAt: true },
      },
    },
  });
  if (!shop) return null;
  const [session, plans] = await Promise.all([
    prisma.session.findFirst({ where: { shop: shop.domain, isOnline: false } }),
    prisma.sellingPlanCache.findMany({
      where: { shopDomain: shop.domain, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
      take: 12,
    }),
  ]);
  return {
    ...shop,
    connected: Boolean(session),
    tokenExpiresAt: session?.expires || null,
    plans,
    billingAttempts: shop.billingAttempts.map((attempt) => ({
      ...attempt,
      amount: attempt.amount ? String(attempt.amount) : null,
    })),
    contracts: shop.contracts.map((contract) => ({
      ...contract,
      lines: parseContractLines(contract.linesJson),
    })),
  };
}

export async function controlSubscriptions(filters: {
  query?: string;
  status?: string;
  shopId?: string;
  page?: number;
}) {
  const query = filters.query?.trim();
  const page = Math.max(1, filters.page || 1);
  const pageSize = 40;
  const dueOnly = filters.status === "DUE";
  const where = {
    ...(dueOnly
      ? { status: "ACTIVE", nextBillingAt: { lte: new Date() } }
      : filters.status
        ? { status: filters.status }
        : {}),
    ...(filters.shopId ? { shopId: filters.shopId } : {}),
    ...(query
      ? {
          OR: [
            { customerName: { contains: query } },
            { shopifyId: { contains: query } },
            { customerId: { contains: query } },
            { shop: { domain: { contains: query } } },
          ],
        }
      : {}),
  };
  const [records, total, shops] = await Promise.all([
    prisma.subscriptionContract.findMany({
      where,
      include: { shop: true, billingAttempts: { orderBy: { attemptedAt: "desc" }, take: 1 } },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.subscriptionContract.count({ where }),
    prisma.shop.findMany({ select: { id: true, domain: true, displayName: true }, orderBy: { domain: "asc" } }),
  ]);
  return {
    records: records.map((record) => ({
      ...record,
      billingDue: record.status === "ACTIVE" && Boolean(
        record.nextBillingAt && record.nextBillingAt.getTime() <= Date.now(),
      ),
      lines: parseContractLines(record.linesJson),
    })),
    shops,
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function controlBilling(filters: { status?: string; shopId?: string; page?: number }) {
  const page = Math.max(1, filters.page || 1);
  const pageSize = 50;
  const where = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.shopId ? { shopId: filters.shopId } : {}),
  };
  const [attempts, total, shops] = await Promise.all([
    prisma.billingAttempt.findMany({
      where,
      include: { shop: true, contract: true },
      orderBy: { attemptedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.billingAttempt.count({ where }),
    prisma.shop.findMany({ select: { id: true, domain: true, displayName: true }, orderBy: { domain: "asc" } }),
  ]);
  return {
    attempts: attempts.map((attempt) => ({
      ...attempt,
      amount: attempt.amount ? String(attempt.amount) : null,
    })),
    shops,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function controlActivity(filters: { action?: string; shopId?: string; page?: number }) {
  const page = Math.max(1, filters.page || 1);
  const pageSize = 50;
  const where = {
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.shopId ? { shopId: filters.shopId } : {}),
  };
  const [events, total, shops, actions] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      include: { shop: { select: { displayName: true, domain: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditEvent.count({ where }),
    prisma.shop.findMany({ select: { id: true, domain: true, displayName: true }, orderBy: { domain: "asc" } }),
    prisma.auditEvent.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
  ]);
  return {
    events,
    shops,
    actions: actions.map((entry) => entry.action),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
