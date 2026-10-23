// Where the web app is served from. The local dashboard (pnpm dev / start) serves everything at the root,
// including /recorder and its local-only API. The static Pages build (scripts/build-pages.mjs) sets
// NEXT_PUBLIC_BLACKBOX_STATIC=1 and NEXT_PUBLIC_BASE_PATH (for example /blackbox-receipts): it contains only
// the landing and the offline /verify page, so recorder links point at the README's local setup instead.
export const STATIC_SITE = process.env.NEXT_PUBLIC_BLACKBOX_STATIC === '1';
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL || 'https://github.com/nickthelegend/blackbox-receipts';

/** An in-app link. The static build exports `verify/index.html`, so its links carry the base path and a trailing slash. */
export const route = (path: '/' | '/verify') => (STATIC_SITE ? `${BASE_PATH}${path === '/' ? '/' : `${path}/`}` : path);

/** The recorder needs the local proxy store, so the static site links to how to run it instead. */
export const recorder = STATIC_SITE
  ? { href: `${REPO_URL}#setup`, short: 'Run it locally', long: 'Run the recorder locally' }
  : { href: '/recorder', short: 'Open recorder', long: 'Open the recorder' };
