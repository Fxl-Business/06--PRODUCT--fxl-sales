import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { FinderStatus } from '@/admin/types';
import { useFinders } from './hooks/useFinders';

const STATUSES: FinderStatus[] = ['pending', 'approved', 'suspended'];

function statusVariant(status: FinderStatus): 'default' | 'secondary' | 'destructive' {
  if (status === 'approved') return 'default';
  if (status === 'suspended') return 'destructive';
  return 'secondary';
}

export function AdminFindersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<FinderStatus>('pending');
  const { data: finders, isLoading } = useFinders(status);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('admin.finders.title')}</h1>

      <Tabs value={status} onValueChange={(v) => setStatus(v as FinderStatus)}>
        <TabsList>
          {STATUSES.map((s) => (
            <TabsTrigger key={s} value={s}>
              {t(`admin.finders.tabs.${s}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : !finders || finders.length === 0 ? (
        <EmptyState title={t('admin.finders.empty')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.finders.columns.name')}</TableHead>
              <TableHead>{t('admin.finders.columns.email')}</TableHead>
              <TableHead>{t('admin.finders.columns.cpf')}</TableHead>
              <TableHead>{t('admin.finders.columns.pixKey')}</TableHead>
              <TableHead>{t('admin.finders.columns.createdAt')}</TableHead>
              <TableHead>{t('admin.finders.columns.status')}</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {finders.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="font-medium">{f.displayName}</TableCell>
                <TableCell>{f.contactEmail}</TableCell>
                <TableCell>{f.cpfMasked ?? '—'}</TableCell>
                <TableCell>{f.pixKey ?? '—'}</TableCell>
                <TableCell>{new Date(f.createdAt).toLocaleDateString('pt-BR')}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(f.status)}>
                    {t(`admin.finders.tabs.${f.status}`)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/admin/finders/${f.id}`)}
                  >
                    {t('admin.finders.actions.view')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
