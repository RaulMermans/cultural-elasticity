// TEST DOUBLE for `qloo mcp` (newline-delimited JSON-RPC over stdio). Never contacts Qloo.
// Behaviour by FAKE_MCP_MODE: ok | rpc-error | no-structured | hang | leaky-exit.
import { createInterface } from "node:readline";

const [, , command] = process.argv;
if (command !== "mcp") {
  process.stderr.write("fake qloo: only mcp is supported\n");
  process.exit(2);
}
const mode = process.env.FAKE_MCP_MODE ?? "ok";
const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialize") return write({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fake" } } });
  if (request.method === "notifications/initialized") return;
  if (request.method !== "tools/call") return write({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not found" } });
  if (mode === "hang") return;
  if (mode === "leaky-exit") {
    process.stderr.write(`fatal: key ${process.env.QLOO_API_KEY} rejected\n`);
    process.exit(1);
  }
  if (mode === "rpc-error") return write({ jsonrpc: "2.0", id: request.id, error: { code: -32602, message: `Unknown Qloo MCP tool: ${request.params.name}` } });
  if (mode === "no-structured") return write({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "nothing" }] } });
  const operation = String(request.params.name).replace(/^qloo_/u, "");
  write({
    jsonrpc: "2.0",
    id: request.id,
    result: {
      content: [{ type: "text", text: "{}" }],
      structuredContent: {
        schema_version: "1.0-preview.1",
        operation,
        status: "ok",
        results: [],
        echo: request.params.arguments,
        execution: { transport: "mcp", transport_name: "fake", correlation_id: `mcp-${request.id}`, duration_ms: 0 },
      },
    },
  });
});
