// Tells whether the "ultima-version" download on GitHub was built from a
// different commit than the running app. Only reads public information; when
// the repository is private or offline it simply reports no update.
const REPO = 'cristhianlujan45-blip/MESORA-';
const TAG = 'ultima-version';

/**
 * @param {{ commit: string|null, fetch: typeof fetch, repo?: string }} opts
 * @returns {Promise<{ available: boolean, url?: string, publishedAt?: string }>}
 */
async function checkForUpdate({ commit, fetch, repo = REPO }) {
  if (!commit) return { available: false };
  const api = `https://api.github.com/repos/${repo}`;
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'MESORA-Studio' };
  try {
    const [refRes, relRes] = await Promise.all([
      fetch(`${api}/git/ref/tags/${TAG}`, { headers }),
      fetch(`${api}/releases/tags/${TAG}`, { headers }),
    ]);
    if (!refRes.ok || !relRes.ok) return { available: false };
    const ref = await refRes.json();
    const release = await relRes.json();
    const latest = ref?.object?.sha;
    if (!latest || !release?.html_url) return { available: false };
    return { available: latest !== commit, url: release.html_url, publishedAt: release.published_at || null };
  } catch {
    return { available: false };
  }
}

module.exports = { checkForUpdate, REPO, TAG };
