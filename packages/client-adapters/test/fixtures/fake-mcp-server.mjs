#!/usr/bin/env node
// A minimal fake MCP-server-shaped process for testing real signal/exit-code
// propagation through scopewatch-run's actual spawn (not an injected fake).
// Behavior driven by argv so one fixture covers both test cases:
//   node fake-mcp-server.mjs exit <code>       -> exits immediately with <code>
//   node fake-mcp-server.mjs wait-for-signal   -> runs until it receives SIGTERM,
//                                                  then exits 0
const [mode, arg] = process.argv.slice(2);

if (mode === 'exit') {
  process.stdout.write('fake-mcp-server started\n');
  process.exit(Number(arg));
} else if (mode === 'wait-for-signal') {
  process.stdout.write('fake-mcp-server waiting\n');
  process.on('SIGTERM', () => {
    process.stdout.write('fake-mcp-server received SIGTERM\n');
    process.exit(0);
  });
  setInterval(() => {}, 1000); // keep alive until signaled
} else {
  process.exit(99);
}
