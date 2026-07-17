# Milestone v2.2.0

Released as `v2.2.0` on 2026-07-16.
The release commit is `db8df37d8c420bd800cf15a2c228aa85ff7fac66`.

## Accomplishments

- Corrected Hub JWT claim decoding so multibyte UTF-8 workspace and user data render without mojibake.
- Replaced the prototype viewing-level switcher with workspace visibility derived from authenticated Hub roles.
- Added the `Meus dados` workspace for seller and finder personal views.
- Added combined-role navigation behavior so team users with personal roles can access both operational and personal workspaces.
- Moved account actions into the sidebar footer with access to user data, settings, and logout.

## Key decisions

- [Workspace visibility follows the Hub role set](../../knowledge/decisions/2026-07-16-workspace-visibility-follows-hub-roles.md).

## Verification and promotion

Independent release verification passed lint, type-check, 256 unit and contract tests, 27 database integration tests, the production build, the legacy-auth security guard, and production plus full dependency audits.
The tagged commit was promoted through `staging` and then `production` without a staging validation pause under the explicit production-ready approval.
