import test from 'node:test';
import assert from 'node:assert/strict';
import { findKimi } from '../src/server/signin-flows.js';

const CODE = 'ABCD-EFGH';
const URL = `https://www.kimi.com/code/authorize_device?user_code=${CODE}&source=kimi-code`;
// The installed Kimi Code CLI prints verificationUriComplete using these two lines (stderr).
// All URLs/codes here are synthetic; no OAuth request or account is used.
const output = (url = URL, code = CODE) => `\nOpening browser for Kimi device login: ${url}\nIf the browser did not open, paste the URL above and enter code: ${code}\nWaiting for authorization to complete…\n`;

test('Kimi keeps the full verification URL and its matching user code', () => {
  assert.deepEqual(findKimi(output()), { url: URL, code: CODE });
  const legacy = URL.replace('kimi.com', 'kimi.ai');
  assert.deepEqual(findKimi(output(legacy)), { url: legacy, code: CODE });
  const encoded = `https://auth.kimi.com/device?source=cli&user_code=ABCD%2DEFGH`;
  assert.deepEqual(findKimi(output(encoded)), { url: encoded, code: CODE });
});

test('Kimi strips terminal formatting and takes the labelled URL, not nearby links', () => {
  const formatted = output(`\x1b]8;;${URL}\x07\x1b[34m${URL}\x1b[0m\x1b]8;;\x07`, `\x1b[1m${CODE}\x1b[0m`).replaceAll('\n', '\r\n');
  assert.deepEqual(findKimi(`Help: https://example.com/\n${formatted}`), { url: URL, code: CODE });
});

test('Kimi waits for complete URL/code lines instead of freezing a partial or fallback link', () => {
  const codeFirst = `If the browser did not open, paste the URL above and enter code: ${CODE}\nOpening browser for Kimi device login: ${URL}\n`;
  for (const text of [output(), codeFirst]) {
    const completeAt = text.indexOf(CODE, text.indexOf('enter code:')) + CODE.length + 1;
    const urlEndsAt = text.indexOf('\n', text.indexOf('Opening browser')) + 1;
    for (let length = 0; length < Math.max(completeAt, urlEndsAt); length++) {
      assert.equal(findKimi(text.slice(0, length)), undefined, `incomplete prefix of length ${length}`);
    }
    assert.deepEqual(findKimi(text), { url: URL, code: CODE });
  }
});

test('Kimi does not invent a link when the complete authorization URL is missing', () => {
  assert.equal(findKimi(`enter code: ${CODE}\n`), undefined);
  assert.equal(findKimi(output('https://www.kimi.ai/code/authorize_device')), undefined);
  assert.equal(findKimi(`Opening browser for Kimi device login: ${URL}\n`), undefined);
});

test('Kimi rejects mismatched, ambiguous, malformed or unsafe authorization URLs', () => {
  for (const url of [
    URL.replace(CODE, 'WXYZ-1234'),
    `${URL}&user_code=${CODE}`,
    URL.replace('https:', 'http:'),
    URL.replace('https://', 'https://user:password@'),
    URL.replace('www.kimi.com', 'example.com'),
    URL.replace('www.kimi.com', 'notkimi.com'),
    URL.replace('www.kimi.com', 'kimi.com.evil.test'),
    'https://[bad-host]/?user_code=ABCD-EFGH',
  ]) assert.equal(findKimi(output(url)), undefined, url);
});
