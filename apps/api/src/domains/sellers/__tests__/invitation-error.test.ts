/**
 * ORACLE for the invitation error mapper.
 *
 * Every `HubInvitationErrorCode` the installed SDK declares maps to one fixed
 * HTTP response, and the mapping is decided by `code` alone: neither the message
 * nor the Hub's own status may move it.
 */
import { HubInvitationError, type HubInvitationErrorCode } from '@fxl-business/hub-sdk/server';
import { describe, expect, it } from 'vitest';
import {
  INVITATION_COPY,
  INVITATIONS_UNAVAILABLE,
  isHubInvitationError,
  mapInvitationError,
} from '../invitation-error.js';

type Expected = { httpStatus: number; error: string; message: string };

/**
 * Typed as a full Record so a code added to the SDK union fails type-check here
 * until this table covers it.
 */
const EXPECTED: Record<HubInvitationErrorCode, Expected> = {
  actor_not_member: { httpStatus: 403, error: 'forbidden', message: INVITATION_COPY.notAllowed },
  application_not_granted: {
    httpStatus: 403,
    error: 'forbidden',
    message: INVITATION_COPY.notAllowed,
  },
  invalid_app_roles: {
    httpStatus: 400,
    error: 'invalid_request',
    message: INVITATION_COPY.invalidRole,
  },
  invitation_not_found: {
    httpStatus: 404,
    error: 'not_found',
    message: INVITATION_COPY.invitationGone,
  },
  invitation_not_pending: {
    httpStatus: 409,
    error: 'conflict',
    message: INVITATION_COPY.invitationGone,
  },
  invalid_actor_token: {
    httpStatus: 401,
    error: 'unauthorized',
    message: INVITATION_COPY.signInAgain,
  },
  rate_limited: { httpStatus: 429, error: 'rate_limited', message: INVITATION_COPY.rateLimited },
  network_error: { httpStatus: 503, error: 'unavailable', message: INVITATION_COPY.temporary },
  unexpected_response: {
    httpStatus: 502,
    error: 'bad_gateway',
    message: INVITATION_COPY.temporary,
  },
  invalid_client: {
    httpStatus: 500,
    error: 'internal_error',
    message: INVITATION_COPY.configurationDefect,
  },
  application_mismatch: {
    httpStatus: 500,
    error: 'internal_error',
    message: INVITATION_COPY.configurationDefect,
  },
  not_an_application: {
    httpStatus: 500,
    error: 'internal_error',
    message: INVITATION_COPY.configurationDefect,
  },
  invalid_request: {
    httpStatus: 500,
    error: 'internal_error',
    message: INVITATION_COPY.configurationDefect,
  },
  discovery_missing_api_url: {
    httpStatus: 503,
    error: 'unavailable',
    message: INVITATION_COPY.operatorItem,
  },
  discovery_insecure_api_url: {
    httpStatus: 503,
    error: 'unavailable',
    message: INVITATION_COPY.operatorItem,
  },
};

const ALL_CODES = Object.keys(EXPECTED) as HubInvitationErrorCode[];

describe('mapInvitationError', () => {
  it('covers all fifteen SDK codes', () => {
    expect(ALL_CODES).toHaveLength(15);
  });

  it.each(ALL_CODES)('maps %s to its fixed response', (code) => {
    const expected = EXPECTED[code];
    const mapped = mapInvitationError(new HubInvitationError(code, 400, `whatever ${code}`));
    expect(mapped).toEqual({
      httpStatus: expected.httpStatus,
      body: { error: expected.error, code, message: expected.message },
    });
  });

  it.each(ALL_CODES)(
    'keys %s on the code, never on a misleading message or the Hub status',
    (code) => {
      const plain = mapInvitationError(new HubInvitationError(code, null, 'x'));
      // A message that names a DIFFERENT code and a status that contradicts it.
      const misleading = mapInvitationError(
        new HubInvitationError(
          code,
          code === 'invitation_not_found' ? 403 : 404,
          'hub-sdk: invitation create failed: invitation_not_found (HTTP 404) actor_not_member rate_limited',
        ),
      );
      expect(misleading).toEqual(plain);
    },
  );

  it('carries retryAfterSeconds on rate_limited when the Hub stated it', () => {
    const mapped = mapInvitationError(new HubInvitationError('rate_limited', 429, 'x', 42));
    expect(mapped.httpStatus).toBe(429);
    expect(mapped.retryAfterSeconds).toBe(42);
  });

  it('omits retryAfterSeconds on rate_limited when the Hub did not state it', () => {
    const mapped = mapInvitationError(new HubInvitationError('rate_limited', 429, 'x', null));
    expect(mapped).not.toHaveProperty('retryAfterSeconds');
  });

  it('never carries retryAfterSeconds on a code other than rate_limited', () => {
    const mapped = mapInvitationError(new HubInvitationError('network_error', null, 'x', 30));
    expect(mapped).not.toHaveProperty('retryAfterSeconds');
  });

  it('treats an unknown code as a configuration or code defect (500)', () => {
    const forged = new HubInvitationError('invalid_request', 400, 'x');
    Object.defineProperty(forged, 'code', { value: 'a_code_from_the_future' });
    expect(mapInvitationError(forged)).toEqual({
      httpStatus: 500,
      body: {
        error: 'internal_error',
        code: 'unknown',
        message: INVITATION_COPY.configurationDefect,
      },
    });
  });

  it('does not treat an inherited Object.prototype key as a known code', () => {
    const forged = new HubInvitationError('invalid_request', 400, 'x');
    Object.defineProperty(forged, 'code', { value: 'toString' });
    expect(mapInvitationError(forged).httpStatus).toBe(500);
    expect(mapInvitationError(forged).body.code).toBe('unknown');
  });

  it('never echoes the error message into the body', () => {
    const secretish = 'https://hub.example/accept?token=single-use-secret';
    const mapped = mapInvitationError(new HubInvitationError('network_error', null, secretish));
    expect(JSON.stringify(mapped)).not.toContain('single-use-secret');
  });
});

describe('isHubInvitationError', () => {
  it('recognises the SDK error and nothing else', () => {
    expect(isHubInvitationError(new HubInvitationError('network_error', null, 'x'))).toBe(true);
    expect(isHubInvitationError(new Error('network_error'))).toBe(false);
    expect(isHubInvitationError({ code: 'network_error' })).toBe(false);
    expect(isHubInvitationError(null)).toBe(false);
  });
});

describe('INVITATIONS_UNAVAILABLE', () => {
  it('is a 503 whose body is byte-identical to the existing hub_auth_not_configured body', () => {
    expect(INVITATIONS_UNAVAILABLE.httpStatus).toBe(503);
    expect(JSON.stringify(INVITATIONS_UNAVAILABLE.body)).toBe(
      '{"error":"unavailable","code":"hub_auth_not_configured"}',
    );
  });
});
