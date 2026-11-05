import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '../index.css';
import { App } from '../App';
import { installFakeSource } from './fake-source';

const root = document.getElementById('root');
if (!root) throw new Error('root element not found');

/**
 * The prototype entry: the real `App` over a fake network and the EXISTING dev identity.
 *
 * Order matters. `installFakeSource()` swaps `fetch` and `EventSource` first, so nothing the
 * app does can reach a real server. `installDevIdentityIfEnabled()` then installs the same
 * signed-in session `make dev-fake` uses (this file never names the auth-fake package, and
 * adds no second fake login); it must complete before `render`, because `HubAuthProvider`
 * reads the registry once in its first render. The dev identity needs `VITE_AUTH_FAKE=1`,
 * which `project.fxl.yaml` puts in the serve command; without it this page says so instead
 * of falling through to the real Hub login.
 *
 * Nothing outside this folder imports it, and `index.html` is the only build input, so a
 * production build never contains any of it (`scripts/__tests__/prototype-isolation.test.mjs`).
 */
async function bootstrap(container: HTMLElement) {
  installFakeSource();
  const { installDevIdentityIfEnabled } = await import('../dev/install-dev-identity');
  await installDevIdentityIfEnabled();
  const { getDevIdentitySession } = await import('../dev/dev-identity-registry');
  if (!getDevIdentitySession()) {
    container.textContent =
      'Protótipo sem identidade: suba esta página com VITE_AUTH_FAKE=1 (o command do project.fxl.yaml já faz isso).';
    return;
  }
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap(root);
