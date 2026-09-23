import { describe, expect, it } from 'vitest';
import { resolveListenHost } from '../listen-host.js';

describe('resolveListenHost', () => {
  it('binds loopback only in development, so the API is never reachable from the LAN', () => {
    expect(resolveListenHost({ nodeEnv: 'development', listenHost: undefined })).toBe('localhost');
  });

  it('binds loopback only under test as well', () => {
    expect(resolveListenHost({ nodeEnv: 'test', listenHost: undefined })).toBe('localhost');
  });

  it('keeps the runtime default in production, which the container port mapping relies on', () => {
    expect(resolveListenHost({ nodeEnv: 'production', listenHost: undefined })).toBeUndefined();
  });

  it('honours an explicit SALES_LISTEN_HOST in every environment', () => {
    expect(resolveListenHost({ nodeEnv: 'development', listenHost: '0.0.0.0' })).toBe('0.0.0.0');
    expect(resolveListenHost({ nodeEnv: 'production', listenHost: '127.0.0.1' })).toBe('127.0.0.1');
  });
});
