import { HubInvitationError, type HubInvitationErrorCode } from '@fxl-business/hub-sdk/server';

/**
 * The ONE translation from a Hub invitation failure to a Sales HTTP response.
 *
 * It keys on `HubInvitationError.code` and on nothing else. The message is SDK
 * prose for logs and may change in any release; the Hub status is an input to the
 * SDK's own classification and is already folded into `code`. So neither may move
 * the mapping, and the message is never echoed into a response body.
 */

/** User-facing copy, pt-BR. Exported so the web side and tests share the strings. */
export const INVITATION_COPY = {
  notAllowed: 'Você não pode convidar para esta Organization.',
  invalidRole: 'Papel inválido.',
  invitationGone: 'Este convite não existe mais ou já foi aceito ou revogado.',
  signInAgain: 'Sua sessão expirou. Entre novamente para continuar.',
  rateLimited: 'Muitas tentativas. Aguarde um pouco e tente novamente.',
  temporary: 'Falha temporária ao enviar o convite. Tente novamente em instantes.',
  configurationDefect: 'Não foi possível processar o convite. Contate o suporte.',
  operatorItem: 'O serviço de convites não está disponível. Contate o suporte.',
} as const;

export type InvitationErrorBody = {
  error: string;
  /** The SDK code, or `unknown` for a code this build does not recognise. */
  code: HubInvitationErrorCode | 'unknown';
  message: string;
};

export type InvitationErrorResponse = {
  httpStatus: number;
  body: InvitationErrorBody;
  /** Present only on `rate_limited`, and only when the Hub stated a Retry-After. */
  retryAfterSeconds?: number;
};

type Mapping = { httpStatus: number; error: string; message: string };

const CONFIGURATION_DEFECT: Mapping = {
  httpStatus: 500,
  error: 'internal_error',
  message: INVITATION_COPY.configurationDefect,
};

/**
 * A full Record over the SDK union, so a code added by a future SDK fails
 * type-check here instead of silently falling through to the default.
 */
const MAPPING: Record<HubInvitationErrorCode, Mapping> = {
  // The inviting person may not invite into this Organization.
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
  // The actor token was refused: the person must sign in again.
  invalid_actor_token: {
    httpStatus: 401,
    error: 'unauthorized',
    message: INVITATION_COPY.signInAgain,
  },
  rate_limited: { httpStatus: 429, error: 'rate_limited', message: INVITATION_COPY.rateLimited },
  // Temporary: the Hub was unreachable, or answered something unparseable.
  network_error: { httpStatus: 503, error: 'unavailable', message: INVITATION_COPY.temporary },
  unexpected_response: {
    httpStatus: 502,
    error: 'bad_gateway',
    message: INVITATION_COPY.temporary,
  },
  // A configuration or code defect on the Sales side; retrying will not help.
  invalid_client: CONFIGURATION_DEFECT,
  application_mismatch: CONFIGURATION_DEFECT,
  not_an_application: CONFIGURATION_DEFECT,
  invalid_request: CONFIGURATION_DEFECT,
  // An operator item: the Hub's discovery document is not usable for invitations.
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

function isKnownCode(code: unknown): code is HubInvitationErrorCode {
  return typeof code === 'string' && Object.hasOwn(MAPPING, code);
}

export function mapInvitationError(
  err: Pick<HubInvitationError, 'code' | 'retryAfterSeconds'>,
): InvitationErrorResponse {
  const code = err.code;
  if (!isKnownCode(code)) {
    return {
      httpStatus: CONFIGURATION_DEFECT.httpStatus,
      body: { error: CONFIGURATION_DEFECT.error, code: 'unknown', message: CONFIGURATION_DEFECT.message },
    };
  }
  const mapping = MAPPING[code];
  const response: InvitationErrorResponse = {
    httpStatus: mapping.httpStatus,
    body: { error: mapping.error, code, message: mapping.message },
  };
  if (code === 'rate_limited' && typeof err.retryAfterSeconds === 'number') {
    response.retryAfterSeconds = err.retryAfterSeconds;
  }
  return response;
}

export function isHubInvitationError(value: unknown): value is HubInvitationError {
  return value instanceof HubInvitationError;
}

/**
 * The answer whenever the invitations client is null: no Hub configuration, or
 * the development identity adapter is installed. Byte-identical to the body
 * `hubAppAuthMiddleware` answers for a missing Hub configuration, so the web
 * reads both the same way.
 */
export const INVITATIONS_UNAVAILABLE = {
  httpStatus: 503,
  body: { error: 'unavailable', code: 'hub_auth_not_configured' },
} as const;
