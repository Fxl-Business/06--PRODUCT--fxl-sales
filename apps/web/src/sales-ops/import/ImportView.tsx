import { CheckCircle2, Download, Loader2, Upload, X } from 'lucide-react';
import { useRef, useState, type ChangeEvent } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MUTATION_ERROR_COPY } from '../mutation-error-copy';
import { IMPORT_COPY, importErrorMessage } from './import-copy';
import { ImportCountsTable } from './ImportCountsTable';
import { ImportIssueList } from './ImportIssueList';
import { groupImportIssues, recognizedClientCount, totalCount } from './issues';
import {
  isImportPreviewBody,
  MAX_IMPORT_UPLOAD_BYTES,
  XLSX_ACCEPT,
  type ImportCommitBody,
  type ImportPreviewBody,
} from './types';

/*
  Intentional local copies of the `SalesOpsApp.tsx` style constants: that module
  imports this one, so importing them back would be a cycle (same convention as
  `CadastroHistoryPanel.tsx`).
*/
const panelClass = 'rounded-[18px] border border-[#e8e8ec] bg-white';
const primaryButtonClass =
  'inline-flex items-center gap-2 rounded-[11px] bg-[#201f24] px-[22px] py-[11px] text-sm font-bold text-white transition hover:bg-[#33333a] disabled:cursor-not-allowed disabled:opacity-60';
const secondaryButtonClass =
  'inline-flex cursor-pointer items-center gap-2 rounded-[11px] border border-[#dcdce2] bg-white px-5 py-[11px] text-sm font-semibold text-[#57575f] transition hover:bg-[#f2f2f4] disabled:cursor-not-allowed disabled:opacity-60';
const errorBannerClass =
  'flex items-start gap-3 rounded-[10px] border border-[#f1c9c4] bg-[#fdf2f1] px-4 py-3 text-[13.5px] font-semibold text-[#c93d32]';

type Busy = 'download-blank' | 'download-example' | 'preview' | 'commit' | null;

type ImportViewProps = {
  onDownload: (example: boolean) => Promise<void>;
  onPreview: (file: File) => Promise<ImportPreviewBody>;
  onCommit: (file: File) => Promise<ImportCommitBody>;
};

function StepPanel({
  children,
  step,
  text,
  title,
}: {
  children: React.ReactNode;
  step: string;
  text?: string;
  title: string;
}) {
  return (
    <section className={panelClass} data-import-step={step}>
      <div className="border-b border-[#e8e8ec] px-[22px] py-4">
        <h2 className="text-[15px] font-bold text-[#201f24]">{title}</h2>
        {text ? <p className="mt-1 text-[13.5px] text-[#8b8b92]">{text}</p> : null}
      </div>
      <div className="flex flex-col gap-4 px-[22px] py-4">{children}</div>
    </section>
  );
}

export function ImportView({ onCommit, onDownload, onPreview }: ImportViewProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewBody | null>(null);
  const [result, setResult] = useState<ImportCommitBody | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function clearErrors() {
    setError(null);
    setLocalError(null);
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    clearErrors();
    setConfirmOpen(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function runDownload(example: boolean) {
    setBusy(example ? 'download-example' : 'download-blank');
    clearErrors();
    try {
      await onDownload(example);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null;
    // Any new selection discards the previous preview, so a commit can never send a
    // file other than the one the preview validated.
    setPreview(null);
    clearErrors();
    if (next && !next.name.toLowerCase().endsWith('.xlsx')) {
      setLocalError(IMPORT_COPY.notXlsxLocal);
      setFile(null);
    } else if (next && next.size > MAX_IMPORT_UPLOAD_BYTES) {
      setLocalError(IMPORT_COPY.tooLargeLocal);
      setFile(null);
    } else {
      setFile(next);
    }
  }

  async function validate() {
    if (!file) return;
    setBusy('preview');
    clearErrors();
    try {
      setPreview(await onPreview(file));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  async function confirmCommit() {
    if (!file) return;
    setConfirmOpen(false);
    setBusy('commit');
    clearErrors();
    try {
      setResult(await onCommit(file));
      setPreview(null);
    } catch (e) {
      setError(e);
      const body = (e as { body?: unknown } | null)?.body;
      if ((e as { status?: unknown } | null)?.status === 422 && isImportPreviewBody(body)) {
        setPreview(body);
      }
    } finally {
      setBusy(null);
    }
  }

  const hasError = error !== null || localError !== null;
  const canImport =
    preview !== null && preview.ok && totalCount(preview.counts) > 0 && file !== null;
  const previewRecognized = preview !== null ? recognizedClientCount(preview) : 0;
  const resultRecognized = result !== null ? recognizedClientCount(result) : 0;

  return (
    <div className="flex flex-col gap-[14px]" data-import-view>
      {hasError ? (
        <div className={errorBannerClass} data-import-error role="alert">
          <span className="min-w-0 flex-1 leading-[1.4]">
            {localError ?? importErrorMessage(error)}
          </span>
          <button
            aria-label={MUTATION_ERROR_COPY.dismiss}
            className="shrink-0"
            onClick={clearErrors}
            type="button"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      ) : null}

      {result !== null ? (
        <section className={panelClass} data-import-success>
          <div className="flex items-center gap-3 border-b border-[#e8e8ec] px-[22px] py-4">
            <CheckCircle2 aria-hidden className="size-5 text-[#1f7d43]" />
            <div>
              <h2 className="text-[15px] font-bold text-[#201f24]">{IMPORT_COPY.successTitle}</h2>
              <p className="mt-1 text-[13.5px] text-[#8b8b92]">{IMPORT_COPY.successText}</p>
            </div>
          </div>
          <div className="flex flex-col gap-4 px-[22px] py-4">
            <ImportCountsTable counts={result.counts} heading={IMPORT_COPY.countsCreated} />
            {resultRecognized > 0 ? (
              <p className="text-[13.5px] text-[#57575f]" data-import-recognized>
                {IMPORT_COPY.recognizedClientsDone(resultRecognized)}
              </p>
            ) : null}
            <div>
              <button className={secondaryButtonClass} onClick={reset} type="button">
                {IMPORT_COPY.another}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <>
          <p className="text-[13.5px] text-[#8b8b92]">{IMPORT_COPY.intro}</p>
          <StepPanel step="1" text={IMPORT_COPY.step1Text} title={IMPORT_COPY.step1Title}>
            <div className="flex flex-wrap gap-3">
              <button
                className={secondaryButtonClass}
                disabled={busy !== null}
                onClick={() => void runDownload(false)}
                type="button"
              >
                <Download aria-hidden className="size-4" />
                {IMPORT_COPY.downloadBlank}
              </button>
              <button
                className={secondaryButtonClass}
                disabled={busy !== null}
                onClick={() => void runDownload(true)}
                type="button"
              >
                <Download aria-hidden className="size-4" />
                {IMPORT_COPY.downloadExample}
              </button>
            </div>
          </StepPanel>

          <StepPanel step="2" text={IMPORT_COPY.step2Text} title={IMPORT_COPY.step2Title}>
            <div className="flex flex-wrap items-center gap-3">
              <label className={secondaryButtonClass}>
                <Upload aria-hidden className="size-4" />
                {IMPORT_COPY.chooseFile}
                <input
                  accept={XLSX_ACCEPT}
                  className="sr-only"
                  data-import-file
                  onChange={onFileChange}
                  ref={inputRef}
                  type="file"
                />
              </label>
              <span className="min-w-0 break-all text-[13.5px] text-[#8b8b92]">
                {file ? file.name : IMPORT_COPY.noFile}
              </span>
            </div>
            <div>
              <button
                className={primaryButtonClass}
                data-import-validate
                disabled={file === null || busy !== null}
                onClick={() => void validate()}
                type="button"
              >
                {busy === 'preview' ? (
                  <>
                    <Loader2 aria-hidden className="size-4 animate-spin" />
                    {IMPORT_COPY.validating}
                  </>
                ) : (
                  IMPORT_COPY.validate
                )}
              </button>
            </div>
          </StepPanel>

          {preview !== null ? (
            <StepPanel step="3" title={IMPORT_COPY.step3Title}>
              <ImportCountsTable
                counts={preview.counts}
                emptyText={previewRecognized > 0 ? IMPORT_COPY.nothingNew : undefined}
                heading={IMPORT_COPY.countsToCreate}
              />
              {previewRecognized > 0 ? (
                <p className="text-[13.5px] text-[#57575f]" data-import-recognized>
                  {IMPORT_COPY.recognizedClients(previewRecognized)}
                </p>
              ) : null}
              <ImportIssueList issues={preview.issues} truncated={preview.truncated} />
              <p className="text-[13.5px] font-semibold text-[#57575f]">
                {!preview.ok
                  ? IMPORT_COPY.errorsBlock
                  : groupImportIssues(preview.issues).warningCount > 0
                    ? IMPORT_COPY.readyOk
                    : IMPORT_COPY.readyClean}
              </p>
              <p className="text-[13px] text-[#8b8b92]">{IMPORT_COPY.allOrNothing}</p>
              <div>
                <button
                  className={primaryButtonClass}
                  data-import-commit
                  disabled={!canImport || busy !== null}
                  onClick={() => setConfirmOpen(true)}
                  type="button"
                >
                  {busy === 'commit' ? (
                    <>
                      <Loader2 aria-hidden className="size-4 animate-spin" />
                      {IMPORT_COPY.importing}
                    </>
                  ) : (
                    IMPORT_COPY.import
                  )}
                </button>
              </div>
            </StepPanel>
          ) : null}
        </>
      )}

      <AlertDialog onOpenChange={setConfirmOpen} open={confirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{IMPORT_COPY.confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {IMPORT_COPY.confirmText(preview ? totalCount(preview.counts) : 0)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{IMPORT_COPY.confirmCancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmCommit()}>
              {IMPORT_COPY.confirmAction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
