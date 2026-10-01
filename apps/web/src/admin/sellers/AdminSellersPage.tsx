import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { SellerInvitationStatus, SellerRow } from '@/admin/types';
import type { ApiError, SellerInviteDelivery } from '@/lib/api-client';
import {
  useInviteSeller,
  useResendSellerInvitation,
  useRevokeSellerInvitation,
  useSellers,
  useSendSellerInvitation,
} from './hooks/useSellers';

/**
 * Admin sellers page with Hub invitations (v4.1.0).
 *
 * Every invite warning and error is rendered BY CODE through
 * `admin.sellers.invitation.{warnings,errors}.<code>`; the server `message` is
 * never shown. The invitation state comes verbatim from the list (the API
 * reconciles it with the Hub); nothing here derives accepted or expired.
 * `acceptUrl` is single-use: it lives only in the open outcome dialog's state,
 * shown for `email_not_configured`, and is never logged or stored.
 */

/** Codes with their own copy; anything else renders `errors.unknown`. */
const INVITE_ERROR_CODES: ReadonlySet<string> = new Set([
  'actor_not_member',
  'application_not_granted',
  'invalid_app_roles',
  'invitation_not_found',
  'invitation_not_pending',
  'invalid_actor_token',
  'rate_limited',
  'network_error',
  'unexpected_response',
  'invalid_client',
  'application_mismatch',
  'not_an_application',
  'invalid_request',
  'discovery_missing_api_url',
  'discovery_insecure_api_url',
  'hub_auth_not_configured',
  'seller_not_invited',
  'seller_already_invited',
  'not_found',
  'unknown',
]);

type InviteProblem = { code: string; retryAfterSeconds?: number };

type InviteOutcome =
  | { kind: 'created' | 'invited' | 'resent'; seller: SellerRow; delivery: SellerInviteDelivery }
  | {
      kind: 'createFailed' | 'inviteFailed' | 'resendFailed' | 'revokeFailed';
      seller: SellerRow;
      problem: InviteProblem;
    };

const OUTCOME_TITLE: Record<InviteOutcome['kind'], string> = {
  created: 'admin.sellers.invitation.outcome.createdTitle',
  createFailed: 'admin.sellers.invitation.outcome.createdTitle',
  invited: 'admin.sellers.invitation.outcome.invitedTitle',
  inviteFailed: 'admin.sellers.invitation.outcome.inviteFailedTitle',
  resent: 'admin.sellers.invitation.outcome.resentTitle',
  resendFailed: 'admin.sellers.invitation.outcome.resendFailedTitle',
  revokeFailed: 'admin.sellers.invitation.outcome.revokeFailedTitle',
};

const STATUS_VARIANT: Record<SellerInvitationStatus, NonNullable<BadgeProps['variant']>> = {
  accepted: 'default',
  pending: 'secondary',
  expired: 'outline',
  revoked: 'destructive',
};

/** A rejected request as an invite problem, keyed on the body `code` (or `error` when absent). */
function problemOf(error: unknown): InviteProblem {
  if (error && typeof error === 'object' && 'status' in error) {
    const apiError = error as ApiError;
    return {
      code: apiError.code ?? apiError.error,
      ...(apiError.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: apiError.retryAfterSeconds }
        : {}),
    };
  }
  return { code: 'unknown' };
}

/**
 * A NEW invitation is offered only when there is none (the create-time invite
 * failed) or the last one was revoked; pending and expired ones are resent, and
 * an accepted one needs nothing. Mirrors the API's `409 seller_already_invited`.
 */
function canSendInvitation(status: SellerInvitationStatus | null): boolean {
  return status === null || status === 'revoked';
}

/**
 * The seller of a failed resend or revoke HAS an invitation, so the no-Hub copy
 * must not point to Enviar convite: it asks to try again instead.
 */
const HAS_INVITATION_KINDS: ReadonlySet<InviteOutcome['kind']> = new Set(['resendFailed', 'revokeFailed']);

function canResend(status: SellerInvitationStatus | null): boolean {
  return status === 'pending' || status === 'expired';
}

function canRevoke(status: SellerInvitationStatus | null): boolean {
  return status === 'pending';
}

export function AdminSellersPage() {
  const { t } = useTranslation();
  const { data: sellers, isLoading } = useSellers();
  const invite = useInviteSeller();
  const resend = useResendSellerInvitation();
  const revoke = useRevokeSellerInvitation();
  const send = useSendSellerInvitation();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [outcome, setOutcome] = useState<InviteOutcome | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<SellerRow | null>(null);

  function reset() {
    setDisplayName('');
    setContactEmail('');
  }

  function create() {
    invite.mutate(
      { displayName: displayName.trim(), contactEmail: contactEmail.trim() },
      {
        onSuccess: (result) => {
          setOpen(false);
          reset();
          if (result.inviteError) {
            const { code, retryAfterSeconds } = result.inviteError;
            setOutcome({
              kind: 'createFailed',
              seller: result.seller,
              problem: { code, ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) },
            });
          } else {
            setOutcome({ kind: 'created', seller: result.seller, delivery: result });
          }
        },
      },
    );
  }

  function resendFor(seller: SellerRow) {
    resend.mutate(seller.id, {
      onSuccess: (result) => setOutcome({ kind: 'resent', seller: result.seller, delivery: result }),
      onError: (error) => setOutcome({ kind: 'resendFailed', seller, problem: problemOf(error) }),
    });
  }

  function sendFor(seller: SellerRow) {
    send.mutate(seller.id, {
      onSuccess: (result) => setOutcome({ kind: 'invited', seller: result.seller, delivery: result }),
      onError: (error) => setOutcome({ kind: 'inviteFailed', seller, problem: problemOf(error) }),
    });
  }

  function confirmRevoke() {
    const seller = revokeTarget;
    setRevokeTarget(null);
    if (!seller) return;
    revoke.mutate(seller.id, {
      onError: (error) => setOutcome({ kind: 'revokeFailed', seller, problem: problemOf(error) }),
    });
  }

  function rowBusy(sellerId: string): boolean {
    return (
      (send.isPending && send.variables === sellerId) ||
      (resend.isPending && resend.variables === sellerId) ||
      (revoke.isPending && revoke.variables === sellerId)
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('admin.sellers.title')}</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>{t('admin.sellers.invite')}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('admin.sellers.invite')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="seller-name">{t('admin.sellers.fields.name')}</Label>
                <Input
                  id="seller-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="seller-email">{t('admin.sellers.fields.email')}</Label>
                <Input
                  id="seller-email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                disabled={displayName.trim().length < 2 || !contactEmail.includes('@') || invite.isPending}
                onClick={create}
              >
                {invite.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t('admin.sellers.invite')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : !sellers || sellers.length === 0 ? (
        <EmptyState title={t('admin.sellers.empty')} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.sellers.fields.name')}</TableHead>
                  <TableHead>{t('admin.sellers.fields.email')}</TableHead>
                  <TableHead>{t('admin.finders.columns.status')}</TableHead>
                  <TableHead>{t('admin.sellers.columns.invitation')}</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">{t('admin.sellers.columns.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sellers.map((s) => {
                  const busy = rowBusy(s.id);
                  const resending = resend.isPending && resend.variables === s.id;
                  const sending = send.isPending && send.variables === s.id;
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.displayName}</TableCell>
                      <TableCell>{s.contactEmail}</TableCell>
                      <TableCell>
                        <Badge variant={s.status === 'active' ? 'default' : 'secondary'}>
                          {t(`admin.status.${s.status === 'active' ? 'active' : 'disabled'}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <InvitationBadge status={s.invitationStatus} />
                      </TableCell>
                      <TableCell className="text-right">
                        {/* Fixed height so rows with and without actions line up. */}
                        <div className="flex h-9 items-center justify-end gap-2">
                          {canSendInvitation(s.invitationStatus) ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              aria-busy={sending}
                              onClick={() => sendFor(s)}
                            >
                              {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                              {t('admin.sellers.invitation.actions.send')}
                            </Button>
                          ) : null}
                          {canResend(s.invitationStatus) ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              aria-busy={resending}
                              onClick={() => resendFor(s)}
                            >
                              {resending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                              {t('admin.sellers.invitation.actions.resend')}
                            </Button>
                          ) : null}
                          {canRevoke(s.invitationStatus) ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              onClick={() => setRevokeTarget(s)}
                            >
                              {t('admin.sellers.invitation.actions.revoke')}
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={outcome !== null}
        onOpenChange={(next) => {
          if (!next) setOutcome(null);
        }}
      >
        <DialogContent>
          {outcome ? (
            <InviteOutcomeBody
              key={`${outcome.kind}:${outcome.seller.id}:${
                'delivery' in outcome ? outcome.delivery.acceptUrl : outcome.problem.code
              }`}
              outcome={outcome}
              resending={resend.isPending}
              onResend={() => resendFor(outcome.seller)}
              onClose={() => setOutcome(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRevokeTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('admin.sellers.invitation.revokeConfirm.title', {
                name: revokeTarget?.displayName ?? '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('admin.sellers.invitation.revokeConfirm.description', {
                email: revokeTarget?.contactEmail ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('admin.sellers.invitation.revokeConfirm.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRevoke}>
              {t('admin.sellers.invitation.revokeConfirm.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function InvitationBadge({ status }: { status: SellerInvitationStatus | null }) {
  const { t } = useTranslation();
  if (status === null) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        {t('admin.sellers.invitation.status.none')}
      </Badge>
    );
  }
  return (
    <Badge variant={STATUS_VARIANT[status]}>{t(`admin.sellers.invitation.status.${status}`)}</Badge>
  );
}

function InviteOutcomeBody({
  outcome,
  resending,
  onResend,
  onClose,
}: {
  outcome: InviteOutcome;
  resending: boolean;
  onResend: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const delivery = 'delivery' in outcome ? outcome.delivery : null;
  const problem = 'problem' in outcome ? outcome.problem : null;
  const warningCodes = delivery ? delivery.warnings.map((warning) => warning.code) : [];
  const showAcceptUrl = warningCodes.includes('email_not_configured');
  const offerResend = warningCodes.includes('email_failed');

  async function copyAcceptUrl() {
    if (!delivery) return;
    try {
      await navigator.clipboard.writeText(delivery.acceptUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The link stays on screen and selectable; nothing is logged on purpose.
      setCopied(false);
    }
  }

  function problemCopy(value: InviteProblem): string {
    if (value.code === 'rate_limited' && value.retryAfterSeconds !== undefined) {
      return t('admin.sellers.invitation.rateLimitedWait', { seconds: value.retryAfterSeconds });
    }
    if (value.code === 'hub_auth_not_configured' && HAS_INVITATION_KINDS.has(outcome.kind)) {
      return t('admin.sellers.invitation.hubNotConfiguredRetry');
    }
    const code = INVITE_ERROR_CODES.has(value.code) ? value.code : 'unknown';
    return t(`admin.sellers.invitation.errors.${code}`);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t(OUTCOME_TITLE[outcome.kind])}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3 text-sm">
        {delivery ? (
          <p>
            {t(
              delivery.emailDelivery.status === 'sent'
                ? 'admin.sellers.invitation.outcome.sent'
                : 'admin.sellers.invitation.outcome.created',
              { email: outcome.seller.contactEmail },
            )}
          </p>
        ) : null}
        {warningCodes.map((code) => (
          <div
            key={code}
            className="rounded-md border border-amber-400 bg-amber-50 p-3 text-amber-900"
          >
            {t(`admin.sellers.invitation.warnings.${code}`)}
          </div>
        ))}
        {delivery && showAcceptUrl ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              {t('admin.sellers.invitation.outcome.acceptUrlLabel')}
            </p>
            <code className="block break-all rounded-md bg-muted p-3 font-mono text-xs">
              {delivery.acceptUrl}
            </code>
          </div>
        ) : null}
        {outcome.kind === 'createFailed' ? (
          <p>{t('admin.sellers.invitation.outcome.sellerSaved', { name: outcome.seller.displayName })}</p>
        ) : null}
        {problem ? <p className="text-destructive">{problemCopy(problem)}</p> : null}
      </div>
      <DialogFooter>
        {delivery && showAcceptUrl ? (
          <Button type="button" variant="outline" onClick={copyAcceptUrl}>
            {copied
              ? t('admin.sellers.invitation.actions.copied')
              : t('admin.sellers.invitation.actions.copy')}
          </Button>
        ) : null}
        {offerResend ? (
          <Button
            type="button"
            variant="outline"
            disabled={resending}
            aria-busy={resending}
            onClick={onResend}
          >
            {resending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('admin.sellers.invitation.actions.resend')}
          </Button>
        ) : null}
        <Button type="button" onClick={onClose}>
          {t('admin.sellers.invitation.actions.close')}
        </Button>
      </DialogFooter>
    </>
  );
}
