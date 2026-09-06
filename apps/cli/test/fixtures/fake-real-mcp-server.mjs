#!/usr/bin/env node
// A fixture MCP server that speaks the real JSON-RPC-over-stdio protocol,
// for Journey A's end-to-end test. Responds to initialize and tools/list
// with realistic tool data (a mix of a read tool and a destructive write
// tool, so the resulting manifest has real capability differentiation to
// diff against on "update").
import { createInterface } from 'node:readline';

const TOOLS_V1 = [
  {
    name: 'read_record',
    description: 'Reads a record from the database.',
    inputSchema: { properties: { path: { type: 'string' } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'write_record',
    description: 'Writes a record to the database.',
    inputSchema: { properties: { path: { type: 'string' } } },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
];

// v2 adds a brand-new destructive tool - this is what the Journey A
// "update" step's diff should catch as Tier 1 (categorical_acquisition).
const TOOLS_V2 = [
  ...TOOLS_V1,
  {
    name: 'delete_record',
    description: 'Permanently deletes a record from the database.',
    inputSchema: { properties: { path: { type: 'string' } } },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
];

const tools = process.env.SCOPEWATCH_FIXTURE_VERSION === 'v2' ? TOOLS_V2 : TOOLS_V1;

const rl = createInterface({ input: process.stdin });

rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  if (msg.method === 'initialize') {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fixture-server', version: '1.0.0' } },
      }) + '\n'
    );
  } else if (msg.method === 'tools/list') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools } }) + '\n');
  }
  // notifications/initialized has no id and expects no response
});
