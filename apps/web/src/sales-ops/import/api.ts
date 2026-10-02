import { apiFetchBlob, apiUpload } from '@/lib/api-client';
import {
  IMPORT_EXAMPLE_FILENAME,
  IMPORT_TEMPLATE_FILENAME,
  type ImportCommitBody,
  type ImportPreviewBody,
} from './types';

const BASE = '/api/v1/sales-ops/import';

function fileForm(file: File): FormData {
  const form = new FormData();
  form.append('file', file, file.name);
  return form;
}

export const importApi = {
  downloadTemplate: async (example: boolean, token: string) => {
    const { blob, filename } = await apiFetchBlob(
      `${BASE}/template?example=${example ? '1' : '0'}`,
      { method: 'GET', token },
    );
    return {
      blob,
      filename: filename ?? (example ? IMPORT_EXAMPLE_FILENAME : IMPORT_TEMPLATE_FILENAME),
    };
  },
  preview: (file: File, token: string) =>
    apiUpload<ImportPreviewBody>(`${BASE}/preview`, { token, form: fileForm(file) }),
  commit: (file: File, token: string) =>
    apiUpload<ImportCommitBody>(`${BASE}/commit`, { token, form: fileForm(file) }),
};
