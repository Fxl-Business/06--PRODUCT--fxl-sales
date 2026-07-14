import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HUB_SDK_VERSION } from '@fxl-business/hub-sdk';
import { describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, '../../../../..');
const require = createRequire(import.meta.url);

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function readTrackedProductSource(): string {
  const files = execFileSync(
    'git',
    ['ls-files', 'apps/api/src/**/*.ts', 'apps/web/src/**/*.ts'],
    { cwd: repoRoot, encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter((file) => file && !file.includes('/__tests__/'));

  return files.map((file) => readFileSync(resolve(repoRoot, file), 'utf8')).join('\n');
}

describe('Hub SDK contract', () => {
  it('pins both product packages and the lockfile to the published Hub SDK 1.2.0 artifact', () => {
    const apiManifest = readJson(resolve(repoRoot, 'apps/api/package.json')) as {
      dependencies?: Record<string, string>;
    };
    const webManifest = readJson(resolve(repoRoot, 'apps/web/package.json')) as {
      dependencies?: Record<string, string>;
    };
    const lockfile = readFileSync(resolve(repoRoot, 'pnpm-lock.yaml'), 'utf8');
    const resolvedSdkEntry = require.resolve('@fxl-business/hub-sdk');
    const installedManifest = readJson(resolve(dirname(resolvedSdkEntry), '../package.json')) as {
      version?: string;
    };

    expect(apiManifest.dependencies?.['@fxl-business/hub-sdk']).toBe('^1.2.0');
    expect(webManifest.dependencies?.['@fxl-business/hub-sdk']).toBe('^1.2.0');
    expect(lockfile.match(/version: 1\.2\.0\(hono@4\.12\.25\)/g)).toHaveLength(2);
    expect(lockfile).toContain(
      "'@fxl-business/hub-sdk@1.2.0':\n    resolution: {integrity: sha512-/9o1+wOAXzFILE9AT8aGvObzRaeFYGpXd20gSxkpoHqeSnnqOws1a3RsO7sjw2Ow1NlcprTCjfdBMwcXAE50LQ==}",
    );
    expect(
      lockfile.match(
        /'@fxl-business\/hub-sdk':\n\s+specifier: \^1\.2\.0\n\s+version: 1\.2\.0\(hono@4\.12\.25\)/g,
      ),
    ).toHaveLength(2);
    expect(lockfile).not.toMatch(/'@fxl-business\/hub-sdk@1\.2\.0':\n\s+resolution: \{tarball:/);
    expect(HUB_SDK_VERSION).toBe('1.2.0');
    expect(installedManifest.version).toBe('1.2.0');
  });

  it('keeps OAuth discovery verification and Hub web integration behind the SDK dependency', () => {
    const apiManifest = readJson(resolve(repoRoot, 'apps/api/package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const webManifest = readJson(resolve(repoRoot, 'apps/web/package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const forbiddenDependencies = ['jose', '@fxl-hub/hub-auth', 'openid-client', 'oauth4webapi'];
    const productSource = readTrackedProductSource();

    for (const dependency of forbiddenDependencies) {
      expect(apiManifest.dependencies?.[dependency]).toBeUndefined();
      expect(apiManifest.devDependencies?.[dependency]).toBeUndefined();
      expect(webManifest.dependencies?.[dependency]).toBeUndefined();
      expect(webManifest.devDependencies?.[dependency]).toBeUndefined();
    }

    expect(productSource).not.toMatch(/from ['"](?:jose|@fxl-hub\/hub-auth)['"]/);
    expect(productSource).not.toMatch(/\.well-known\/oauth-authorization-server/);
    expect(productSource).not.toMatch(/\.well-known\/jwks\.json/);
    expect(productSource).not.toMatch(
      /(?:authorizationEndpoint|tokenEndpoint|jwksUri|hubWebUrl|fxlWebUrl)\s*=/,
    );
  });

  it('keeps the SDK BFF mounted at root before protected product route handlers', () => {
    const server = readFileSync(resolve(repoRoot, 'apps/api/src/server.ts'), 'utf8');

    expect(server).toContain('const authBff = createAppAuthBff()');
    expect(server).toContain("app.route('', authBff)");
    expect(server).toMatch(/app\.use\('\/api\/v1\/[^"]*', appAuthMiddleware/);
    expect(server.indexOf("app.route('', authBff)")).toBeLessThan(
      server.indexOf("app.use('/api/v1/"),
    );
    expect(server).not.toMatch(
      /app\.(?:get|post|put|patch|delete|route)\([^\n]*(?:trials?|grants?|organizations?|entitlements?\/reconcil|memberships?\/invitations?)/i,
    );
  });

  it('documents every operator-owned Hub deployment responsibility without assigning Hub endpoints to Sales', () => {
    const handoff = readFileSync(
      resolve(repoRoot, 'docs/deployment/hub-sdk-integration.md'),
      'utf8',
    );

    expect(handoff).toContain('product.fxl-sales');
    expect(handoff).toContain('sales.core');
    expect(handoff).toMatch(/active.*trialing|trialing.*active/i);
    expect(handoff).toMatch(/Hub-owned membership invitation/i);
    expect(handoff).toMatch(/same registrable domain/i);
    expect(handoff).toContain('http://localhost:8006/auth/callback');
    expect(handoff).toContain('AUTH_PUBLIC_URL');
    expect(handoff).toContain('HUB_ISSUER');
    expect(handoff).toMatch(/matching web auth origin/i);
    expect(handoff).toMatch(/workspace.*org_id|org_id.*workspace/i);
    expect(handoff).toMatch(/periodic reconciliation/i);
    expect(handoff).toMatch(/durable production session storage/i);
    expect(handoff).toMatch(
      /FXL Sales does not implement Hub Admin trials, grants, organizations, reconciliation workers, or invitation delivery/i,
    );
  });
});
