Implemented items 8 through 11, backend only:

- ClickUp status writes and monitor reads.
- Default sample inbox with labelled drafts and simulated sending.
- Six authenticated demo controls with audit records.
- Six hour cleanup with recorded resource ownership and partial failure retries.

Added 16 tests. Final gate: **EXIT=0**, all **645 tests**, lint, typecheck and build passed.

[Report with files per item and verification limits](/workspace/soldline/docs/P14a.md).

Migration 0012 still needs deployment. No live calls, commits or pushes were made.