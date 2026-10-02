import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { IMPORT_COPY } from './import-copy';
import { nonZeroCounts } from './issues';
import type { ImportCounts } from './types';

/* Local copies of the `SalesOpsApp.tsx` style constants (import cycle, see CadastroHistoryPanel). */
const tableHeadClass =
  'px-4 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-[#9b9ba3]';
const tableCellClass = 'px-4 py-3 text-[13.5px] text-[#57575f]';

export function ImportCountsTable({ counts, heading }: { counts: ImportCounts; heading: string }) {
  const rows = nonZeroCounts(counts);
  if (rows.length === 0) {
    return <p className="text-[13.5px] text-[#8b8b92]">{IMPORT_COPY.nothingToImport}</p>;
  }
  return (
    <div className="overflow-x-auto" data-import-counts>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className={tableHeadClass}>{IMPORT_COPY.countsSheet}</TableHead>
            <TableHead className={`${tableHeadClass} text-right`}>{heading}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow data-import-count={row.sheet} key={row.sheet}>
              <TableCell className={tableCellClass}>{row.label}</TableCell>
              <TableCell className={`${tableCellClass} sales-ops-num text-right`}>
                {row.count}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
