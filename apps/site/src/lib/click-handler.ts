import { eq } from 'drizzle-orm';
import { ulid } from 'ulidx';
import { dailySalt, hashIp, signReferralUrl } from '@fxl-sales/shared-utils/hmac';
import { apps, clicks, getDb, referralLinks } from './db';
import { classifyUa } from './ua-family';

/**
 * Public referral redirect handler (Phase 04, T06; spec § 5 steps 1–8).
 *
 * Resolves a link by its bearer `code` with NO Clerk JWT / NO tenant context —
 * succeeds only via the referral_links_public_lookup RLS policy (D-E). Inserts a
 * clicks row SYNCHRONOUSLY (split-RLS clicks_insert_public, WITH CHECK true),
 * then 302s to the destination with `?ref=<click_id>&fxl_sig=<hmac>` appended
 * and sets the fxl_ref cookie (HttpOnly; Secure; SameSite=Lax; 90d — D-R).
 *
 * Branch outcomes: not-found/revoked/expired → 410; host-mismatch/unparseable
 * destination → 500 (misconfig, no detail leaked); valid → 302.
 */

const COOKIE_MAX_AGE = 7776000; // 90 days in seconds (D-R)

function htmlResponse(status: number, title: string, message: string): Response {
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${title}</title></head>` +
      `<body style="font-family:system-ui;text-align:center;padding:4rem"><h1>${title}</h1><p>${message}</p></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

/** EXACT host equality (open-redirect defense, D9). Never substring/suffix. */
function hostAllowed(destinationUrl: string, allowedHosts: string[]): boolean {
  const host = new URL(destinationUrl).host; // throws on bad URL (caught by caller)
  return allowedHosts.some((entry) => host === entry);
}

export async function handleReferralClick(code: string, request: Request): Promise<Response> {
  const db = getDb();

  // 1. Lookup link by code, joined to its app (for hosts + signing secret).
  const rows = await db
    .select({
      id: referralLinks.id,
      orgId: referralLinks.orgId,
      finderId: referralLinks.finderId,
      appId: referralLinks.appId,
      productId: referralLinks.productId,
      signature: referralLinks.signature,
      destinationUrl: referralLinks.destinationUrl,
      status: referralLinks.status,
      expiresAt: referralLinks.expiresAt,
      revokedAt: referralLinks.revokedAt,
      webhookSigningSecret: apps.webhookSigningSecret,
      allowedRedirectHosts: apps.allowedRedirectHosts,
    })
    .from(referralLinks)
    .innerJoin(apps, eq(referralLinks.appId, apps.id))
    .where(eq(referralLinks.code, code))
    .limit(1);

  const link = rows[0];

  // 2. Not found → 410.
  if (!link) {
    return htmlResponse(410, 'Link inválido', 'Este link de indicação não existe.');
  }

  // 3. Revoked or expired → 410.
  if (link.revokedAt !== null || link.status === 'revoked') {
    return htmlResponse(410, 'Link inválido', 'Este link de indicação foi revogado.');
  }
  if (link.expiresAt !== null && link.expiresAt < new Date()) {
    return htmlResponse(410, 'Link expirado', 'Este link de indicação expirou.');
  }

  // 4. Validate destination host with EXACT equality. Misconfig → 500 (no leak).
  let destOk: boolean;
  try {
    destOk = hostAllowed(link.destinationUrl, link.allowedRedirectHosts);
  } catch {
    destOk = false; // unparseable destination_url
  }
  if (!destOk) {
    console.error(
      `[r/${code}] destination host not in allowlist or unparseable: ${link.destinationUrl}`,
    );
    return htmlResponse(500, 'Erro de configuração', 'Não foi possível processar este link.');
  }

  // 5. Mint click_id.
  const clickId = ulid();

  // 6. Telemetry.
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('cf-connecting-ip') ??
    'unknown';
  const salt = dailySalt(new Date(), process.env.HASH_SALT_SECRET ?? 'dev_salt');
  const ipHash = hashIp(ip, salt);
  const uaFamily = classifyUa(request.headers.get('user-agent'));
  const referer = request.headers.get('referer') ?? null;
  const country = request.headers.get('cf-ipcountry') ?? null;
  const url = new URL(request.url);
  const utmSource = url.searchParams.get('utm_source');
  const utmMedium = url.searchParams.get('utm_medium');
  const utmCampaign = url.searchParams.get('utm_campaign');

  // 7. INSERT clicks row SYNCHRONOUSLY (before redirect). No setTenantContext —
  // clicks_insert_public WITH CHECK (true) allows the JWT-less insert (D-E/T03).
  await db.insert(clicks).values({
    clickId,
    orgId: link.orgId,
    linkId: link.id,
    finderId: link.finderId,
    appId: link.appId,
    productId: link.productId,
    ipHash,
    uaFamily,
    referer,
    utmSource,
    utmMedium,
    utmCampaign,
    country,
  });

  // 8. fxl_sig = hmac(click_id + "." + link.signature, webhook_signing_secret) (D-P).
  const fxlSig = signReferralUrl(link.webhookSigningSecret, clickId, link.signature);

  // 9. Build redirect URL with ?ref + &fxl_sig appended.
  const redirectUrl =
    link.destinationUrl +
    '?ref=' +
    encodeURIComponent(clickId) +
    '&fxl_sig=' +
    encodeURIComponent(fxlSig);

  // 10/11. 302 + fxl_ref cookie (HttpOnly; Secure; SameSite=Lax; 90d — D-R).
  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectUrl,
      'Set-Cookie': `fxl_ref=${clickId}; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}; Path=/`,
    },
  });
}
