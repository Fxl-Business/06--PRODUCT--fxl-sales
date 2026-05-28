import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import type { FinderRow } from '@/admin/types';
import { useApproveFinder, useFinder, useSuspendFinder } from './hooks/useFinders';

/**
 * Raw Clerk IDs (user_*, org_*) must NEVER render as plain text (FXL contract).
 * No display-name resolution exists for these yet (D-R deferral), so render via
 * the mandated font-mono fallback class.
 */
function RawId({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return <span className="font-mono text-xs text-muted-foreground">{value}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

export function AdminFinderDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const { data: finder, isLoading } = useFinder(id);
  const approve = useApproveFinder();
  const suspend = useSuspendFinder();
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!finder) {
    return <p className="text-muted-foreground">{t('admin.finders.empty')}</p>;
  }

  const f: FinderRow = finder;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/finders')}>
            ←
          </Button>
          <h1 className="text-2xl font-semibold">{f.displayName}</h1>
          <Badge variant={f.status === 'approved' ? 'default' : f.status === 'suspended' ? 'destructive' : 'secondary'}>
            {t(`admin.finders.tabs.${f.status}`)}
          </Badge>
        </div>
        <div className="flex gap-2">
          {f.status === 'pending' && (
            <Button onClick={() => approve.mutate(id)} disabled={approve.isPending}>
              {t('admin.finders.actions.approve')}
            </Button>
          )}
          {f.status === 'approved' && (
            <Button variant="destructive" onClick={() => setSuspendOpen(true)}>
              {t('admin.finders.actions.suspend')}
            </Button>
          )}
        </div>
      </div>

      {f.status === 'pending' && (
        <p className="text-sm text-muted-foreground">{t('admin.finders.approveConfirm')}</p>
      )}

      <Card>
        <CardContent className="grid grid-cols-1 gap-6 p-6 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t('admin.finders.columns.email')}>{f.contactEmail}</Field>
          <Field label={t('admin.finders.columns.cpf')}>{f.cpfMasked ?? '—'}</Field>
          <Field label={t('admin.finders.columns.pixKey')}>{f.pixKey ?? '—'}</Field>
          <Field label={t('admin.finders.fields.phone')}>{f.phone ?? '—'}</Field>
          <Field label={t('admin.finders.fields.pixKeyType')}>{f.pixKeyType ?? '—'}</Field>
          <Field label={t('admin.finders.columns.createdAt')}>
            {new Date(f.createdAt).toLocaleString('pt-BR')}
          </Field>
          <Field label={t('admin.finders.fields.orgId')}>
            <RawId value={f.clerkOrgId ?? (f.orgId || null)} />
          </Field>
          <Field label={t('admin.finders.fields.approvedBy')}>
            <RawId value={f.approvedByUserId} />
          </Field>
          {f.suspendedReason && (
            <Field label={t('admin.finders.suspendLabel')}>{f.suspendedReason}</Field>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">LGPD</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('admin.finders.lgpd.essential')}>
            {f.lgpdConsentEssential ? '✓' : '—'}
          </Field>
          <Field label={t('admin.finders.lgpd.marketing')}>
            {f.lgpdConsentMarketing ? '✓' : '—'}
          </Field>
          <Field label={t('admin.finders.lgpd.version')}>{f.lgpdConsentVersion || '—'}</Field>
          <Field label={t('admin.finders.lgpd.consentedAt')}>
            {f.lgpdConsentedAt ? new Date(f.lgpdConsentedAt).toLocaleString('pt-BR') : '—'}
          </Field>
        </CardContent>
      </Card>

      <Dialog open={suspendOpen} onOpenChange={setSuspendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.finders.actions.suspend')}</DialogTitle>
            <DialogDescription>{t('admin.finders.suspendLabel')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="suspend-reason">{t('admin.finders.suspendLabel')}</Label>
            <Input
              id="suspend-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspendOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={!reason.trim() || suspend.isPending}
              onClick={() =>
                suspend.mutate(
                  { id, reason: reason.trim() },
                  {
                    onSuccess: () => {
                      setSuspendOpen(false);
                      setReason('');
                    },
                  },
                )
              }
            >
              {t('admin.finders.actions.suspend')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
