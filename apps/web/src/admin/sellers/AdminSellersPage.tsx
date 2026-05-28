import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
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
import { useInviteSeller, useSellers } from './hooks/useSellers';

export function AdminSellersPage() {
  const { t } = useTranslation();
  const { data: sellers, isLoading } = useSellers();
  const invite = useInviteSeller();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  function reset() {
    setDisplayName('');
    setContactEmail('');
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
                onClick={() =>
                  invite.mutate(
                    { displayName: displayName.trim(), contactEmail: contactEmail.trim() },
                    {
                      onSuccess: () => {
                        setOpen(false);
                        reset();
                      },
                    },
                  )
                }
              >
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {sellers.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.displayName}</TableCell>
                    <TableCell>{s.contactEmail}</TableCell>
                    <TableCell>
                      <Badge variant={s.status === 'active' ? 'default' : 'secondary'}>
                        {t(`admin.status.${s.status === 'active' ? 'active' : 'disabled'}`)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
