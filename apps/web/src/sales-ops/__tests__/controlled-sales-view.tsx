import * as React from 'react';
import { SalesView } from '../SalesOpsApp';

type SalesViewProps = React.ComponentProps<typeof SalesView>;

/**
 * `SalesView` with a stand-in for the URL. In the app the open proposta detail is URL
 * state owned by `SalesOpsApp` (`/:workspace/vendas/:saleId`); a harness that renders
 * `SalesView` alone holds it here instead, so a row click still opens the detail and
 * its close still closes it. The URL mechanics themselves are pinned by
 * `sale-deep-link.test.tsx`, which renders the real `SalesOpsApp` inside a router.
 */
export function ControlledSalesView({
  initialDetailSaleId = null,
  ...props
}: Omit<SalesViewProps, 'detailSaleId' | 'onOpenDetail' | 'onCloseDetail'> & {
  initialDetailSaleId?: string | null;
}) {
  const [detailSaleId, setDetailSaleId] = React.useState<string | null>(initialDetailSaleId);
  return (
    <SalesView
      {...props}
      detailSaleId={detailSaleId}
      onCloseDetail={() => setDetailSaleId(null)}
      onOpenDetail={setDetailSaleId}
    />
  );
}
