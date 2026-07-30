import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PriceBandSummary, ReferralLink } from '@/finder/types';
import { useCreateLink, useFinderApps, useFinderProducts } from './useLinks';

interface LinkGeneratorFormProps {
  onSuccess: (link: ReferralLink, fullUrl: string) => void;
}

/** Cents → "1.234,56" (no currency symbol; the label/hint provides "R$"). */
function centsToReaisDisplay(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    cents / 100,
  );
}

/** Parse a R$ text input ("1.234,56" or "1234.56") to int cents. */
function reaisInputToCents(input: string): number | null {
  const cleaned = input.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number.parseFloat(cleaned);
  if (Number.isNaN(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function LinkGeneratorForm({ onSuccess }: LinkGeneratorFormProps) {
  const { t } = useTranslation();
  const appsQuery = useFinderApps();
  const [appId, setAppId] = useState<string>('');
  const productsQuery = useFinderProducts(appId || undefined);
  const [productId, setProductId] = useState<string>('');
  const [setupInput, setSetupInput] = useState<string>('');
  const [monthlyInput, setMonthlyInput] = useState<string>('');
  const createLink = useCreateLink();
  const [error, setError] = useState<string | null>(null);

  const apps = appsQuery.data ?? [];
  const products = productsQuery.data ?? [];
  const selectedProduct = products.find((p) => p.id === productId);

  const setupCents = reaisInputToCents(setupInput);
  const monthlyCents = reaisInputToCents(monthlyInput);

  const setupInBand = useMemo(
    () => bandCheck(selectedProduct?.setupBand, setupCents),
    [selectedProduct, setupCents],
  );
  const monthlyInBand = useMemo(
    () => bandCheck(selectedProduct?.monthlyBand, monthlyCents),
    [selectedProduct, monthlyCents],
  );

  const canSubmit =
    !!appId &&
    !!productId &&
    setupCents !== null &&
    monthlyCents !== null &&
    setupInBand &&
    monthlyInBand &&
    !createLink.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (setupCents === null || monthlyCents === null) return;
    try {
      const res = await createLink.mutateAsync({
        appId,
        productId,
        quotedSetupBrl: setupCents,
        quotedMonthlyBrl: monthlyCents,
      });
      onSuccess(res.link, res.fullUrl);
    } catch (err) {
      const code = (err as { error?: string }).error ?? 'request_failed';
      setError(t(`finder.links.error.${code}`, t('finder.links.error.request_failed')));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="app">{t('finder.links.form.app')}</Label>
        <Combobox
          id="app"
          onChange={(v) => {
            setAppId(v);
            setProductId('');
          }}
          options={apps.map((a) => ({ value: a.id, label: a.name }))}
          placeholder={t('finder.links.form.appPlaceholder')}
          value={appId}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="product">{t('finder.links.form.product')}</Label>
        <Combobox
          disabled={!appId}
          id="product"
          onChange={setProductId}
          options={products.map((p) => ({ value: p.id, label: p.name }))}
          placeholder={t('finder.links.form.productPlaceholder')}
          value={productId}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="setup">{t('finder.links.form.setupPrice')}</Label>
        <Input
          id="setup"
          inputMode="decimal"
          value={setupInput}
          onChange={(e) => setSetupInput(e.target.value)}
          disabled={!productId}
        />
        {selectedProduct?.setupBand ? (
          <p className={hintClass(setupInBand, setupInput)}>
            {bandHint(t, selectedProduct.setupBand)}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="monthly">{t('finder.links.form.monthlyPrice')}</Label>
        <Input
          id="monthly"
          inputMode="decimal"
          value={monthlyInput}
          onChange={(e) => setMonthlyInput(e.target.value)}
          disabled={!productId}
        />
        {selectedProduct?.monthlyBand ? (
          <p className={hintClass(monthlyInBand, monthlyInput)}>
            {bandHint(t, selectedProduct.monthlyBand)}
          </p>
        ) : null}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button type="submit" disabled={!canSubmit}>
        {createLink.isPending ? t('finder.links.form.submitting') : t('finder.links.form.submit')}
      </Button>
    </form>
  );
}

function bandCheck(band: PriceBandSummary | null | undefined, cents: number | null): boolean {
  if (!band || cents === null) return false;
  return cents >= band.minBrl && cents <= band.maxBrl;
}

function bandHint(t: (k: string, o?: Record<string, unknown>) => string, band: PriceBandSummary): string {
  return t('finder.links.form.bandHint', {
    min: centsToReaisDisplay(band.minBrl),
    max: centsToReaisDisplay(band.maxBrl),
  });
}

function hintClass(inBand: boolean, input: string): string {
  if (!input) return 'text-xs text-muted-foreground';
  return inBand ? 'text-xs text-muted-foreground' : 'text-xs text-destructive';
}
