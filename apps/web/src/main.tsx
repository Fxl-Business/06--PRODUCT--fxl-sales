import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import './index.css';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('root element not found');

/**
 * `installDevIdentityIfEnabled()` MUST complete before `render`: `HubAuthProvider`
 * reads the dev identity registry in a `useMemo` during its first render, and a
 * session installed after that would never be seen.
 *
 * The `if (import.meta.env.DEV)` wrapper is what makes this structural rather than
 * merely conditional. Vite replaces `import.meta.env.DEV` with the literal `false`
 * in a production build, Rollup drops the whole branch, and with it the only
 * `import('./dev/install-dev-identity')` in the tree - so no chunk for the dev tree
 * is ever emitted into `dist`.
 *
 * ACCEPTED COST: `bootstrap` is async, so in EVERY build the first render is one
 * microtask later than before. The root element lookup, the `StrictMode` wrapper
 * and the `render` call stay byte-identical; a top-level `await` in this module
 * would make the whole entry chunk async in production instead, which is the worse
 * trade for the same saving.
 */
async function bootstrap() {
  if (import.meta.env.DEV) {
    const { installDevIdentityIfEnabled } = await import('./dev/install-dev-identity');
    await installDevIdentityIfEnabled();
  }

  /*
    Non-null by the guard above, which already threw otherwise - but TypeScript
    does not carry a `const` narrowing from an outer scope into a separately
    declared function body, so the assertion below is restating a fact this
    module has already proven, not introducing a new one.
  */
  createRoot(root!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
