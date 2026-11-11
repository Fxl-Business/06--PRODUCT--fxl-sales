import { apiFetchBlob, apiUpload } from '@/lib/api-client';
import {
  IMPORT_EXAMPLE_FILENAME,
  IMPORT_EXPORT_FILENAME,
  IMPORT_TEMPLATE_FILENAME,
  type ImportCommitBody,
  type ImportPreviewBody,
  type StageMap,
} from './types';

const BASE = '/api/v1/sales-ops/import';

function fileForm(file: File, stageMap?: StageMap): FormData {
  const form = new FormData();
  form.append('file', file, file.name);
  if (stageMap !== undefined && Object.keys(stageMap).length > 0) {
    form.append('stageMap', JSON.stringify(stageMap));
  }
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
  exportLeads: async (token: string) => {
    const { blob, filename } = await apiFetchBlob(`${BASE}/export/leads`, {
      method: 'GET',
      token,
    });
    return { blob, filename: filename ?? IMPORT_EXPORT_FILENAME };
  },
  preview: (file: File, token: string, stageMap?: StageMap) =>
    apiUpload<ImportPreviewBody>(`${BASE}/preview`, { token, form: fileForm(file, stageMap) }),
  commit: (file: File, token: string, stageMap?: StageMap) =>
    apiUpload<ImportCommitBody>(`${BASE}/commit`, { token, form: fileForm(file, stageMap) }),
};
