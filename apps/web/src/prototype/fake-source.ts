// The prototype's network: `fetch` and `EventSource` answered from the fixtures, inside the page. The app reaches the
// API through `apiFetch`/`apiFetchBlob`/`apiUpload` only (always `${VITE_API_URL}${path}`), so installing these before the
// App mounts feeds the real screens. Reads answer the real route shapes from an in-memory world seeded from the
// fixtures; a write changes that world, so the reads after it show the change, and a reload seeds the fixtures again.
// A combination the fixtures do not cover answers an error that names it (method, path, query, identity).
import { todayInSaoPaulo } from '@fxl-sales/shared-utils/sao-paulo-day';
import { createWorld, notInFixtures, type World } from './http';
import { route } from './router';

const realFetch: typeof fetch = globalThis.fetch.bind(globalThis);
let world: World = createWorld(todayInSaoPaulo(), Date.now());

const isApiPath = (path: string): boolean => path.startsWith('/api/');

function headerOf(input: RequestInfo | URL, init: RequestInit | undefined, name: string): string | null {
  const fromInit = init?.headers ? new Headers(init.headers).get(name) : null;
  if (fromInit) return fromInit;
  return input instanceof Request ? input.headers.get(name) : null;
}

function bodyOf(init: RequestInit | undefined): unknown {
  const raw = init?.body;
  if (typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function respond(status: number, body: unknown): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify(body ?? {}), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    globalThis.location.href,
  );
  const sameOrigin = url.origin === globalThis.location.origin;
  // `/auth/*` is the Hub BFF the dev identity replaces: nothing may reach it, so it is never routed.
  if (!url.pathname.startsWith('/auth/') && !isApiPath(url.pathname)) {
    // The page's own assets (modules, fonts, the favicon) are served by Vite and pass through.
    if (sameOrigin) return realFetch(input, init);
    const req = { method: 'GET', path: url.pathname, query: url.searchParams, body: undefined };
    const reply = notInFixtures({ ...req, method: (init?.method ?? 'GET').toUpperCase() }, null, `an outside request to ${url.origin} is blocked: the prototype has no network`);
    console.error((reply.body as { message: string }).message);
    return respond(reply.status, reply.body);
  }
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const req = { method, path: url.pathname, query: url.searchParams, body: bodyOf(init) };
  const reply = url.pathname.startsWith('/auth/')
    ? notInFixtures(req, null, 'the prototype signs in through the development identity and seeds no /auth route')
    : route(world, req, headerOf(input, init, 'authorization'));
  if (reply.status === 404 && (reply.body as { error?: string } | undefined)?.error === 'not_in_prototype') {
    console.error((reply.body as { message: string }).message);
  }
  return respond(reply.status, reply.body);
};

/** No fixture streams exist yet: an open names itself in the console and fails like a refused connection. */
class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  readyState = 0;
  readonly url: string;
  readonly withCredentials = false;

  constructor(url: string | URL) {
    this.url = String(url);
    const target = new URL(this.url, globalThis.location.href);
    const reply = notInFixtures(
      { method: 'GET', path: target.pathname, query: target.searchParams, body: undefined },
      null,
      'the prototype seeds no event stream (EventSource)',
    );
    console.error((reply.body as { message: string }).message);
    setTimeout(() => {
      this.readyState = FakeEventSource.CLOSED;
      this.onerror?.(new Event('error'));
    }, 0);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }

  addEventListener(): void {
    // Streams never deliver here, so there is nothing to subscribe a listener to.
  }

  removeEventListener(): void {
    // See addEventListener.
  }
}

/** Replaces the page's network with the fixtures. Called once, before the App mounts. */
export function installFakeSource(): void {
  world = createWorld(todayInSaoPaulo(), Date.now());
  globalThis.fetch = fakeFetch as typeof fetch;
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
}
