export type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type GraphqlError = { message: string; extensions?: { code?: string } };

type GraphqlEnvelope<T> = {
  data?: T;
  errors?: GraphqlError[];
};

/**
 * Thrown when Shopify refuses a request because the app has not been granted a permission yet
 * (for example, the subscription permissions that need Shopify's approval).
 */
export class ShopifyAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyAccessError";
  }
}

function isAccessDenied(errors: GraphqlError[] | undefined) {
  return Boolean(
    errors?.some(
      (error) => error.extensions?.code === "ACCESS_DENIED" || /access denied/i.test(error.message),
    ),
  );
}

function toError(errors: GraphqlError[] | undefined, fallback: string) {
  const message = errors?.map((error) => error.message).join("; ") || fallback;
  return isAccessDenied(errors) ? new ShopifyAccessError(message) : new Error(message);
}

export function isShopifyAccessError(error: unknown): error is ShopifyAccessError {
  return error instanceof ShopifyAccessError ||
    (error instanceof Error && /access denied/i.test(error.message));
}

export async function graphqlRequest<T>(
  admin: AdminGraphqlClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  let response: Response;
  try {
    response = await admin.graphql(query, { variables });
  } catch (error) {
    // The Shopify library throws its own error type when the response contains GraphQL errors.
    const body = (error as { body?: { errors?: GraphqlError[] | { graphQLErrors?: GraphqlError[] } } }).body;
    const errors = Array.isArray(body?.errors) ? body?.errors : body?.errors?.graphQLErrors;
    if (errors?.length) throw toError(errors, "Shopify API request failed");
    throw error;
  }
  const envelope = (await response.json()) as GraphqlEnvelope<T>;

  if (!response.ok || envelope.errors?.length) {
    throw toError(envelope.errors, `Shopify API request failed (${response.status})`);
  }

  if (!envelope.data) {
    throw new Error("Shopify API returned an empty response");
  }

  return envelope.data;
}

export function throwOnUserErrors(
  errors: Array<{ field?: string[] | null; message: string }> | undefined,
) {
  if (!errors?.length) return;
  throw new Error(errors.map((error) => error.message).join("; "));
}
