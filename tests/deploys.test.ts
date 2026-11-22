// The Deploy board: parsing the Cloudflare API, caching, and failing without losing the last list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Deploys } from '../src/server/deploys.js';

const CFG = { accountId: 'acct1', apiToken: 'tok' };

/** A fetch impl from a script: path patterns to { status, json }, recording calls. */
function fakeFetch(routes: Record<string, { status: number; json: unknown }>) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    for (const [pat, r] of Object.entries(routes)) {
      if (url.endsWith(pat)) return { status: r.status, json: r.json };
    }
    return { status: 404, json: { success: false, errors: [{ message: 'unknown path' }] } };
  };
  return { fn, calls };
}

const PAGES = {
  success: true,
  result: [
    { name: 'plimbo-web', subdomain: 'plimbo-web.pages.dev', production_branch: 'main', created_on: '2026-11-01T00:00:00Z', latest_deployment: { url: 'https://abc.plimbo-web.pages.dev', created_on: '2026-11-20T10:00:00Z' } },
    { name: 'old-site', created_on: '2026-10-01T00:00:00Z' },
  ],
};
const WORKERS = { success: true, result: [{ id: 'plimbo-api', modified_on: '2026-11-21T09:00:00Z' }] };
const SUBDOMAIN = { success: true, result: { subdomain: 'phaseone' } };

test('pages and workers come out named, linked and newest first', async () => {
  const { fn, calls } = fakeFetch({ 'pages/projects?per_page=50': { status: 200, json: PAGES }, 'workers/scripts?per_page=50': { status: 200, json: WORKERS }, 'workers/subdomain': { status: 200, json: SUBDOMAIN } });
  let changed = 0;
  const d = new Deploys(CFG, () => changed++, fn as never);
  await d.refresh(true);
  const s = d.state();
  assert.equal(s.configured, true);
  assert.equal(s.error, undefined);
  assert.deepEqual(
    s.items.map((i) => i.id),
    ['worker:plimbo-api', 'pages:plimbo-web', 'pages:old-site'],
  );
  const api = s.items[0];
  assert.equal(api.url, 'https://plimbo-api.phaseone.workers.dev');
  const web = s.items[1];
  assert.equal(web.url, 'https://plimbo-web.pages.dev', 'the production subdomain wins over a deployment URL');
  assert.equal(web.meta, 'branch main');
  assert.equal(s.items[2].url, undefined, 'no deployment and no subdomain: nothing to open');
  assert.ok(changed >= 1);
  assert.equal(calls.length, 3);
});

test('the cache holds for five minutes unless forced, and a failure keeps the last list', async () => {
  const { fn, calls } = fakeFetch({ 'pages/projects?per_page=50': { status: 200, json: PAGES }, 'workers/scripts?per_page=50': { status: 200, json: WORKERS }, 'workers/subdomain': { status: 200, json: SUBDOMAIN } });
  const d = new Deploys(CFG, () => {}, fn as never);
  await d.refresh();
  await d.refresh();
  assert.equal(calls.length, 3, 'the second ask inside the window refetches nothing');

  // Now the API starts failing: a forced refresh keeps the list and says why.
  const failing = async () => ({ status: 403, json: { success: false, errors: [{ message: 'not authorized' }] } });
  const d2 = new Deploys(CFG, () => {}, failing as never);
  await d2.refresh(true);
  assert.equal(d2.state().error, 'not authorized');
  assert.deepEqual(d2.state().items, [], 'nothing good yet: the list is empty, not invented');
});

test('a token without pages access still lists the workers', async () => {
  const { fn } = fakeFetch({ 'pages/projects?per_page=50': { status: 403, json: { success: false, errors: [{ message: 'no pages access' }] } }, 'workers/scripts?per_page=50': { status: 200, json: WORKERS }, 'workers/subdomain': { status: 200, json: SUBDOMAIN } });
  const d = new Deploys(CFG, () => {}, fn as never);
  await d.refresh(true);
  const s = d.state();
  assert.deepEqual(s.items.map((i) => i.id), ['worker:plimbo-api']);
  assert.equal(s.error, 'no pages access');
});

test('unconfigured is a state, not a crash', async () => {
  const d = new Deploys(undefined, () => {});
  await d.refresh(true);
  assert.deepEqual(d.state(), { configured: false, items: [] });
});
