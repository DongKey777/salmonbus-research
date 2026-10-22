// Build-time site facts. `import.meta.env` exists under Vite only; node --test sees the local defaults.
const env = import.meta.env as Partial<ImportMetaEnv> | undefined;

/** Deployment prefix such as `/salmonbus-research/`; `/` on the local dev server and in tests. */
export const BASE_URL: string = (env?.BASE_URL ?? '/').replace(/\/?$/, '/');

/** True only in the GitHub Pages build (`vite build --mode pages`): no local APIs, static snapshots only. */
export const PUBLIC_SITE: boolean = env?.MODE === 'pages';

/** Header mark that tells the local monitor and the public copy apart. */
export const SITE_MARK: string = PUBLIC_SITE ? 'PUBLIC SNAPSHOT' : 'LOCAL RESEARCH';

/** Resolves a site-relative file or API path against the deployment prefix. */
export function siteUrl(path: string): string {
  return BASE_URL + path.replace(/^\/+/, '');
}

/** Link to one research view of the single-page app, keeping the deployment prefix. */
export function viewUrl(view: string, extra?: Record<string, string>): string {
  return `${BASE_URL}?${new URLSearchParams({ view, ...extra })}`;
}

/** Static copies of local API responses, written by scripts/capture-snapshots.mjs for the public build. */
export const SNAPSHOT = {
  realCycles: 'snapshots/real-cycles.json',
  preparation: 'snapshots/preparation.json',
} as const;
