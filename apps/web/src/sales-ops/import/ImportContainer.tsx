import { useCommitImport, useDownloadImportTemplate, usePreviewImport } from './hooks';
import { ImportView } from './ImportView';

/**
 * The `cadastros/importacao` mounting point (the `LeadStagesContainer` convention):
 * no state, no logic. Every callback is `mutateAsync`, because `ImportView` keys its
 * error and 422-preview handling on the REJECTION.
 */
export function ImportContainer() {
  const download = useDownloadImportTemplate();
  const preview = usePreviewImport();
  const commit = useCommitImport();
  return (
    <ImportView
      onCommit={(file) => commit.mutateAsync(file)}
      onDownload={(example) => download.mutateAsync(example)}
      onPreview={(file) => preview.mutateAsync(file)}
    />
  );
}
