import '@shopify/ui-extensions';

//@ts-ignore
declare module './src/Portal.tsx' {
  const shopify: import('@shopify/ui-extensions/customer-account.page.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/graphql.ts' {
  const shopify: import('@shopify/ui-extensions/customer-account.page.render').Api;
  const globalThis: { shopify: typeof shopify };
}
