import { useAccessToken } from '@/auth/react';
import { NO_CACHE_EFFECT, useAppMutation } from '@/lib/app-mutation';
import { queryKeys } from '@/lib/query-keys';
import { requireToken } from '@/lib/require-token';
import { importApi } from './api';
import type { ImportCommitBody, ImportPreviewBody } from './types';

/** Same body as `useDownloadPayoutCsv`: object URL plus a temporary `<a download>`. */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function useDownloadImportTemplate() {
  const { getToken } = useAccessToken();
  // NO_CACHE_EFFECT: a blob download writes no row the query cache holds.
  return useAppMutation<void, unknown, boolean>({
    mutationFn: async (example) => {
      const { blob, filename } = await importApi.downloadTemplate(
        example,
        await requireToken(getToken),
      );
      saveBlob(blob, filename);
    },
    invalidates: NO_CACHE_EFFECT,
  });
}

export function usePreviewImport() {
  const { getToken } = useAccessToken();
  // NO_CACHE_EFFECT: the dry run is a read-only server verification.
  return useAppMutation<ImportPreviewBody, unknown, File>({
    mutationFn: async (file) => importApi.preview(file, await requireToken(getToken)),
    invalidates: NO_CACHE_EFFECT,
  });
}

export function useCommitImport() {
  const { getToken } = useAccessToken();
  // Leads are a SEPARATE query root (query-keys.ts) and an import creates leads and
  // etapas, so both roots are listed.
  return useAppMutation<ImportCommitBody, unknown, File>({
    mutationFn: async (file) => importApi.commit(file, await requireToken(getToken)),
    invalidates: [queryKeys.salesOps.all, queryKeys.leads.all],
  });
}
