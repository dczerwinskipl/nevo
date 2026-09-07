import assert from 'node:assert/strict';
import test from 'node:test';

import { startHttpRedirectServer } from '../server/index.mjs';

test('startHttpRedirectServer rejects conflicting HTTP and HTTPS ports before runtime binding', () => {
  assert.throws(
    () => startHttpRedirectServer({ httpsUrl: 'https://127.0.0.1:4318', host: '127.0.0.1', redirectPort: 4318 }),
    /HTTP redirect port \(4318\) cannot be identical to HTTPS serving port \(4318\)\./,
  );
  assert.throws(
    () => startHttpRedirectServer({ httpsUrl: 'https://localhost:443', host: '127.0.0.1', redirectPort: 443 }),
    /HTTP redirect port \(443\) cannot be identical to HTTPS serving port \(443\)\./,
  );
});

test('HTTP redirect server binds, redirects to HTTPS, and preserves path and query string', async () => {
  const httpsUrl = 'https://127.0.0.1:9443';
  const server = await startHttpRedirectServer({ httpsUrl, host: '127.0.0.1', redirectPort: 0 });
  assert.ok(server, 'Server should have started successfully');

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const redirectPort = address.port;
    assert.ok(redirectPort > 0, 'HTTP server should bind to the configured port');

    // Make an HTTP request to the redirect server
    const response = await fetch(`http://127.0.0.1:${redirectPort}/specs/claude/active?query=status&order=asc`, {
      redirect: 'manual',
    });

    assert.equal(response.status, 301, 'HTTP request should return a redirect response');
    const location = response.headers.get('location');
    assert.ok(location, 'Response should contain Location header');

    const targetUrl = new URL(location);
    assert.equal(targetUrl.protocol, 'https:', 'Redirect destination should use HTTPS');
    assert.equal(targetUrl.hostname, '127.0.0.1');
    assert.equal(targetUrl.port, '9443', 'HTTPS port should be correctly represented in the destination');
    assert.equal(targetUrl.pathname, '/specs/claude/active', 'Request pathname should be preserved');
    assert.equal(targetUrl.search, '?query=status&order=asc', 'Query string should be preserved');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
