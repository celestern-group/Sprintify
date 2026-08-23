import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Carries the API-key owner into existing server actions.  This keeps MCP
 * writes on the same authorization, audit, notification, and embedding paths
 * as an interactive web request.
 */
const mcpActorStorage = new AsyncLocalStorage<{ userId: string }>();

export function mcpActor() {
  return mcpActorStorage.getStore() ?? null;
}

export function withMcpActor<T>(userId: string, operation: () => Promise<T>) {
  return mcpActorStorage.run({ userId }, operation);
}
