#!/usr/bin/env node
// Build contract guard.
//
// v2.3.0 shipped the first-ever apps/web -> @fxl-sales/shared-utils import and broke the
// Vercel production deploy with TS2307. Nothing in the suite caught it, because every root
// script (build, type-check, test) begins with `pnpm run build:packages`, so packages/*/dist
// always existed locally before tsc ran. Vercel builds from a fresh clone where dist/ is
// gitignored and absent, and its buildCommand built only the web app.
//
// This guard asserts the two invariants that failure violated. Both are static, so they cost
// milliseconds and run inside `pnpm test`.
//
// It cannot prove a clean-clone build succeeds - only actually running one does that. It pins
// the config shape that made the clean-clone build impossible.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const failures = []

const readJson = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'))

const listDirs = (dir) => {
  try {
    return readdirSync(join(ROOT, dir)).filter((entry) =>
      statSync(join(ROOT, dir, entry)).isDirectory(),
    )
  } catch {
    return []
  }
}

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      walk(full, out)
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

const apps = listDirs('apps').map((name) => ({
  dir: `apps/${name}`,
  pkg: readJson(`apps/${name}/package.json`),
}))

const packages = new Map(
  listDirs('packages').map((name) => [
    readJson(`packages/${name}/package.json`).name,
    readJson(`packages/${name}/package.json`),
  ]),
)

// Invariant 1 - every workspace subpath an app imports must be a declared export.
// An undeclared subpath resolves locally through a stale dist and fails on a clean clone.
const IMPORT_RE = /from\s+'(@fxl-sales\/[^']+)'/g

for (const app of apps) {
  let sources = []
  try {
    sources = walk(join(ROOT, app.dir, 'src'))
  } catch {
    continue
  }

  for (const file of sources) {
    const text = readFileSync(file, 'utf8')
    for (const [, specifier] of text.matchAll(IMPORT_RE)) {
      const parts = specifier.split('/')
      const pkgName = `${parts[0]}/${parts[1]}`
      const subpath = parts.length > 2 ? `./${parts.slice(2).join('/')}` : '.'
      const pkg = packages.get(pkgName)
      if (!pkg) continue

      if (!pkg.exports || !pkg.exports[subpath]) {
        failures.push(
          `${relative(ROOT, file)} imports '${specifier}', but ${pkgName} declares no ` +
            `"${subpath}" entry in its exports map.`,
        )
      }
    }
  }
}

// Invariant 2 - an app importing a workspace package must have that package built before it.
// Satisfied either by the app building its own dependencies (a `<name>^...` pnpm filter, which
// works no matter who invokes the build) or by every deploy entrypoint doing it explicitly.
const deployEntrypoints = () => {
  const sources = []
  for (const path of ['vercel.json', 'apps/api/Dockerfile']) {
    try {
      sources.push({ path, text: readFileSync(join(ROOT, path), 'utf8') })
    } catch {
      /* entrypoint absent in this repo state */
    }
  }
  return sources
}

const entrypoints = deployEntrypoints()

for (const app of apps) {
  const workspaceDeps = Object.entries(app.pkg.dependencies ?? {})
    .filter(([, range]) => String(range).startsWith('workspace:'))
    .map(([name]) => name)

  if (workspaceDeps.length === 0) continue

  const buildScript = app.pkg.scripts?.build ?? ''
  const selfSufficient = buildScript.includes(`${app.pkg.name}^...`)
  if (selfSufficient) continue

  // Otherwise every entrypoint that builds this app must build each dependency first.
  for (const { path, text } of entrypoints) {
    if (!text.includes(app.pkg.name)) continue

    for (const dep of workspaceDeps) {
      const buildsDep = text.includes(dep)
      const appIndex = text.lastIndexOf(app.pkg.name)
      const depIndex = text.indexOf(dep)

      if (!buildsDep || depIndex > appIndex) {
        failures.push(
          `${path} builds ${app.pkg.name}, which imports ${dep}, but does not build ${dep} ` +
            `first. On a clean clone ${dep}'s dist/ does not exist and the build fails with ` +
            `TS2307. Either build ${dep} in ${path} or give ${app.pkg.name} a ` +
            `"pnpm --filter ${app.pkg.name}^... build" prefix in its build script.`,
        )
      }
    }
  }
}

if (failures.length > 0) {
  console.error('build-contract: FAILED\n')
  for (const failure of failures) console.error(`  - ${failure}\n`)
  process.exit(1)
}

console.log('build-contract: ok')
