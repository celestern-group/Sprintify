/** The least privilege required for Sprintify's MCP read tools. */
export const MCP_READ_PERMISSION: Record<string, string[]> = {
  mcp: ["read"],
};

/** Required in addition to read before an MCP client can mutate backlog data. */
export const MCP_WRITE_PERMISSION: Record<string, string[]> = {
  mcp: ["read", "write"],
};
