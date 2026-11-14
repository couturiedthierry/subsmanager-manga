export type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type GraphqlEnvelope<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

export async function graphqlRequest<T>(
  admin: AdminGraphqlClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(query, { variables });
  const envelope = (await response.json()) as GraphqlEnvelope<T>;

  if (!response.ok || envelope.errors?.length) {
    const message = envelope.errors?.map((error) => error.message).join("; ");
    throw new Error(message || `Shopify API request failed (${response.status})`);
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
