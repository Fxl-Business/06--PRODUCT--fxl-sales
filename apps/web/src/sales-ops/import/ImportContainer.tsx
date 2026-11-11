import {
  useCommitImport,
  useDownloadImportTemplate,
  useExportLeads,
  usePreviewImport,
} from './hooks';
import { ImportView } from './ImportView';

/**
 * The `cadastros/importacao` mounting point (the `LeadStagesContainer` convention):
 * no state, no logic. Every callback is `mutateAsync`, because `ImportView` keys its
 * error and 422-preview handling on the REJECTION.
 */
export function ImportContainer() {
  const download = useDownloadImportTemplate();
  const exportLeads = useExportLeads();
  const preview = usePreviewImport();
  const commit = useCommitImport();
  return (
    <ImportView
      onCommit={(file, stageMap) => commit.mutateAsync({ file, stageMap })}
      onExportLeads={() => exportLeads.mutateAsync()}
      onDownload={(example) => download.mutateAsync(example)}
      onPreview={(file, stageMap) => preview.mutateAsync({ file, stageMap })}
    />
  );
}
