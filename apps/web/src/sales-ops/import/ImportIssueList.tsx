import { AlertTriangle, XCircle } from 'lucide-react';
import { IMPORT_COPY } from './import-copy';
import { groupImportIssues, issueLocation, type IssueGroup } from './issues';
import type { ImportIssue } from './types';

function Section({
  groups,
  severity,
  title,
}: {
  groups: IssueGroup[];
  severity: 'error' | 'warning';
  title: string;
}) {
  const Icon = severity === 'error' ? XCircle : AlertTriangle;
  const tone = severity === 'error' ? 'text-[#c93d32]' : 'text-[#9c7210]';
  return (
    <section className="flex flex-col gap-2" data-import-issues={severity}>
      <h3 className={`flex items-center gap-2 text-[14px] font-semibold ${tone}`}>
        <Icon aria-hidden className="size-4" />
        {title}
      </h3>
      {groups.map((group) => (
        <div className="flex flex-col gap-1" key={group.sheet ?? 'file'}>
          <h4
            className="text-[12px] font-bold uppercase tracking-[0.06em] text-[#9b9ba3]"
            data-import-issue-group={group.sheet ?? 'file'}
          >
            {group.label}
          </h4>
          <ul className="flex flex-col gap-1 text-[13.5px] text-[#57575f]">
            {group.issues.map((issue, index) => (
              <li data-import-issue key={`${issue.row ?? 'x'}-${index}`}>
                <span className="font-semibold">{issueLocation(issue)}</span>
                {' - '}
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

export function ImportIssueList({
  issues,
  truncated,
}: {
  issues: readonly ImportIssue[];
  truncated: boolean;
}) {
  const grouped = groupImportIssues(issues);
  if (grouped.errorCount === 0 && grouped.warningCount === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      {grouped.errorCount > 0 ? (
        <Section
          groups={grouped.errors}
          severity="error"
          title={IMPORT_COPY.errorsTitle(grouped.errorCount)}
        />
      ) : null}
      {grouped.warningCount > 0 ? (
        <Section
          groups={grouped.warnings}
          severity="warning"
          title={IMPORT_COPY.warningsTitle(grouped.warningCount)}
        />
      ) : null}
      {truncated ? (
        <p className="text-[13px] text-[#8b8b92]" data-import-truncated>
          {IMPORT_COPY.truncated}
        </p>
      ) : null}
    </div>
  );
}
