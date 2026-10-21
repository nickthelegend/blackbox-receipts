// What the proxy needs from whatever actually runs the tools: the built-in workspace tools, or any
// upstream stdio MCP server (`--upstream`).
import type { CallToolResult, ListToolsResult } from '@modelcontextprotocol/sdk/types.js';

export type Planned = {
  /** Paths the call touches, recorded in the receipt and checked by the policy before it runs. */
  paths: string[];
  permissions: string[];
  productionTarget?: boolean;
  /** Runs the call. `recorded` is what the receipt's salted resultHash commits to. */
  run: () => Promise<{ result: CallToolResult; recorded: unknown }>;
};

export type Backend = {
  label: string;
  listTools: (cursor?: string) => Promise<ListToolsResult>;
  /** Validates a call and resolves its paths without running it. Throws for calls it won't make. */
  plan: (name: string, args: Record<string, unknown>) => Promise<Planned>;
  close?: () => Promise<void>;
};

export function textOf(result: CallToolResult): string {
  return (result.content ?? []).map((item) => (item.type === 'text' ? item.text : `[${item.type}]`)).join('\n');
}
