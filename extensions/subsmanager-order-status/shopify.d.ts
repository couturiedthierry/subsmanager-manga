import '@shopify/ui-extensions';

//@ts-ignore
declare module './src/OrderStatusBlock.tsx' {
  const shopify: import('@shopify/ui-extensions/customer-account.order-status.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/graphql.ts' {
  const shopify: import('@shopify/ui-extensions/customer-account.order-status.block.render').Api;
  const globalThis: { shopify: typeof shopify };
}
