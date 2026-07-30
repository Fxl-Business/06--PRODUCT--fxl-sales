import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAdminApps } from '@/admin/apps/useApps';
import type { ProductRow, ProductStatus } from '@/admin/types';
import { useCreateProduct, useUpdateProduct } from './useProducts';

interface ProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product?: ProductRow;
}

export function ProductDialog({ open, onOpenChange, product }: ProductDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <ProductDialogForm
            key={product?.id ?? 'create'}
            product={product}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ProductDialogForm({
  product,
  onClose,
}: {
  product?: ProductRow;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const isEdit = Boolean(product);
  const { data: apps } = useAdminApps();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();

  const [appId, setAppId] = useState(product?.appId ?? '');
  const [slug, setSlug] = useState(product?.slug ?? '');
  const [name, setName] = useState(product?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [status, setStatus] = useState<ProductStatus>(product?.status ?? 'active');
  const [error, setError] = useState<string | null>(null);

  const pending = createProduct.isPending || updateProduct.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (isEdit && product) {
        await updateProduct.mutateAsync({
          id: product.id,
          data: { slug, name, description: description || undefined, status },
        });
      } else {
        await createProduct.mutateAsync({
          appId,
          slug,
          name,
          description: description || undefined,
          status,
        });
      }
      onClose();
    } catch {
      setError(t('admin.products.saveError'));
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isEdit ? t('admin.products.editTitle') : t('admin.products.createTitle')}
        </DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        {!isEdit ? (
          <div className="space-y-2">
            <Label htmlFor="product-app">{t('admin.products.field.app')}</Label>
            <Combobox
              id="product-app"
              onChange={setAppId}
              options={(apps ?? []).map((app) => ({ value: app.id, label: app.name }))}
              placeholder={t('admin.products.field.appPlaceholder')}
              value={appId}
            />
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="product-slug">{t('admin.products.field.slug')}</Label>
          <Input id="product-slug" value={slug} onChange={(e) => setSlug(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="product-name">{t('admin.products.field.name')}</Label>
          <Input id="product-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="product-desc">{t('admin.products.field.description')}</Label>
          <Input
            id="product-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {isEdit ? (
          <div className="space-y-2">
            <Label htmlFor="product-status">{t('admin.products.field.status')}</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as ProductStatus)}>
              <SelectTrigger id="product-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">{t('admin.status.active')}</SelectItem>
                <SelectItem value="archived">{t('admin.status.archived')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={pending || (!isEdit && !appId)}>
            {pending ? t('common.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
