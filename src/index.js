import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readConfig } from './config.js';
import { createApi } from './core/client.js';
import { registerWorkItemTools } from './tools/workitems.tools.js';
import { registerPullRequestTools } from './tools/pullrequests.tools.js';
import { registerRepoTools } from './tools/repos.tools.js';

function buildServer(ctx) {
  const server = new McpServer({ name: 'ado', version: '1.0.0' });
  registerWorkItemTools(server, ctx);
  registerPullRequestTools(server, ctx);
  registerRepoTools(server, ctx);
  return server;
}

async function main() {
  const config = readConfig();
  const ctx = { config, api: createApi(config) };
  const server = buildServer(ctx);
  await server.connect(new StdioServerTransport());
  console.error(`ado-mcp-server pronto — projeto '${config.project}', modo ${config.mode.toUpperCase()}`);
}

main().catch((err) => {
  console.error(`ado-mcp-server falhou: ${err.message}`);
  process.exit(1);
});

export { buildServer };
