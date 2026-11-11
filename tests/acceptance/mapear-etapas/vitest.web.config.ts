import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const web = (p: string) => fileURLToPath(new URL(`../../../apps/web/${p}`, import.meta.url));

/** The test file lives outside apps/web, so the dependencies it imports directly are pointed at explicitly. */
const dep = (name: string) => ({ find: new RegExp(`^${name}(/|$)`), replacement: `${web(`node_modules/${name}`)}$1` });

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: [{ find: /^@\//, replacement: `${web('src')}/` }, ...['@tanstack/react-query', 'react-dom', 'react'].map(dep)],
  },
  test: { include: ['*.web.test.tsx'] },
});
