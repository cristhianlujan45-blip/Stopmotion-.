import { test } from 'node:test';
import assert from 'node:assert/strict';
import updates from '../electron/core/updates.cjs';

const { checkForUpdate } = updates;

const fakeFetch = (routes) => async (url) => {
  const hit = Object.entries(routes).find(([k]) => url.endsWith(k));
  if (!hit) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => hit[1] };
};
const routes = (sha) => ({
  '/git/ref/tags/ultima-version': { object: { sha } },
  '/releases/tags/ultima-version': { html_url: 'https://github.com/x/y/releases/tag/ultima-version', published_at: '2026-10-26T18:56:00Z' },
});

test('avisa cuando la descarga publicada es de otra compilación', async () => {
  const r = await checkForUpdate({ commit: 'aaa', fetch: fakeFetch(routes('bbb')) });
  assert.equal(r.available, true);
  assert.match(r.url, /releases\/tag\/ultima-version$/);
});

test('no avisa cuando ya es la misma compilación', async () => {
  const r = await checkForUpdate({ commit: 'bbb', fetch: fakeFetch(routes('bbb')) });
  assert.equal(r.available, false);
});

test('repositorio privado, sin red o sin commit: no avisa ni falla', async () => {
  assert.equal((await checkForUpdate({ commit: 'aaa', fetch: fakeFetch({}) })).available, false);
  assert.equal((await checkForUpdate({ commit: 'aaa', fetch: async () => { throw new Error('offline'); } })).available, false);
  assert.equal((await checkForUpdate({ commit: null, fetch: fakeFetch(routes('bbb')) })).available, false);
});
