import test from 'node:test';
import assert from 'node:assert/strict';
import { linkify } from '../src/client/ui/links.js';

test('a URL in a message becomes a link, the rest stays plain text', () => {
  assert.deepEqual(linkify('see https://example.com/pr/12 for the fix'), ['see ', { href: 'https://example.com/pr/12' }, ' for the fix']);
  assert.deepEqual(linkify('https://example.com'), [{ href: 'https://example.com' }]);
  assert.deepEqual(linkify('HTTP://EXAMPLE.COM/A'), [{ href: 'HTTP://EXAMPLE.COM/A' }]);
});

test('several links in one message each become their own link', () => {
  assert.deepEqual(linkify('a https://x.dev b https://y.dev c'), ['a ', { href: 'https://x.dev' }, ' b ', { href: 'https://y.dev' }, ' c']);
});

test('punctuation ending the sentence is not part of the link', () => {
  assert.deepEqual(linkify('(see https://example.com/a).'), ['(see ', { href: 'https://example.com/a' }, ').']);
  assert.deepEqual(linkify('look: https://example.com/a,b!'), ['look: ', { href: 'https://example.com/a,b' }, '!']);
});

test('markup-looking text and non-links stay plain text', () => {
  assert.deepEqual(linkify('<b>hi</b> <script>alert(1)</script>'), ['<b>hi</b> <script>alert(1)</script>']);
  assert.deepEqual(linkify('ftp://example.com and www.example.com'), ['ftp://example.com and www.example.com']);
  assert.deepEqual(linkify('a bare http://. stays text'), ['a bare http://. stays text']);
  assert.deepEqual(linkify(''), []);
});
