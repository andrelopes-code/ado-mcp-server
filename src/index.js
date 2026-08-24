import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRequire } from 'node:module';
import { readConfig } from './config.js';
import { createContext } from './core/client.js';
import { registerWorkItemTools } from './tools/workitems.tools.js';
import { registerPullRequestTools } from './tools/pullrequests.tools.js';
import { registerRepoTools } from './tools/repos.tools.js';
import { registerProjectTools } from './tools/projects.tools.js';

const { version } = createRequire(import.meta.url)('../package.json');

function buildServer(ctx) {
  const server = new McpServer({ name: 'ado', version });
  registerWorkItemTools(server, ctx);
  registerPullRequestTools(server, ctx);
  registerRepoTools(server, ctx);
  registerProjectTools(server, ctx);
  return server;
}

async function main() {
  const config = readConfig();
  const ctx = createContext(config);
  const server = buildServer(ctx);
  await server.connect(new StdioServerTransport());
  const extra = config.projectAllowlist.length ? ` (+ ${config.projectAllowlist.join(', ')})` : '';
  console.error(`ado-mcp-server pronto — projeto '${config.project}'${extra}, modo ${config.mode.toUpperCase()}`);
}

main().catch((err) => {
  console.error(`ado-mcp-server falhou: ${err.message}`);
  process.exit(1);
});

export { buildServer };
