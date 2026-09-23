/**
 * The interface the API binds.
 *
 * PURE: every input arrives as an argument, nothing reads `process.env`.
 *
 * Outside production the answer is `localhost`, so a developer's API is never
 * reachable from the LAN, a tailnet or a Docker network - under `make dev-fake`
 * that would hand anyone nearby a signed-in `team-owner`. Production keeps the
 * runtime default (`undefined`, every interface), because the container's
 * published port only reaches a process listening beyond loopback.
 *
 * `SALES_LISTEN_HOST` overrides both. `docker-compose.yml` sets it to
 * `0.0.0.0` for the same reason production needs every interface. The name is
 * prefixed on purpose: a bare `HOST` is exported by some shells as the machine
 * name, which would silently bind the LAN address.
 */
export function resolveListenHost(input: {
  nodeEnv: 'development' | 'test' | 'production';
  listenHost: string | undefined;
}): string | undefined {
  if (input.listenHost) return input.listenHost;
  return input.nodeEnv === 'production' ? undefined : 'localhost';
}
