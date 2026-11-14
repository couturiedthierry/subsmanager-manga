import { createContext, useContext } from "react";

/** Per-request CSP nonce, provided by entry.server and read by the root document. */
export const NonceContext = createContext<string | undefined>(undefined);

export function useNonce() {
  return useContext(NonceContext);
}
