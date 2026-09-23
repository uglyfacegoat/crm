# File writers and deletion paths

Verified against the recovered source on 2026-09-23. This inventory supports
FS-01 in the [production plan](../PEREDVIDEOPOKAZOM/END_PRODUCTION_PLAN.md).
It is a code-path map, not evidence that the FS-02/03 writer drain exists.

All nine interactive flows call `writeDocumentFile` in
`src/server/documents/storage.ts`. That adapter writes exclusively to the
configured local root (`wx`, generated tenant key) or to S3. A file can be
written before its database reference commits, so a storage migration must
coordinate the entire action through confirmed commit, rollback, and cleanup.

| Flow | Writer | Cleanup/deletion path |
|---|---|---|
| New document | `src/app/(workspace)/documents/actions.ts`: `uploadDocumentAction` | Same action, owned uncommitted file |
| Document version | `src/app/(workspace)/documents/actions.ts`: `uploadDocumentVersionAction` | Same action, owned uncommitted file |
| Payment receipt | `src/app/(workspace)/finance/actions.ts`: `createPaymentAction` via `storeReceipt` | `removeUncommittedReceipt`, only owned file |
| Payout receipt | `src/app/(workspace)/finance/actions.ts`: `createPayoutAction` via `storeReceipt` | `removeUncommittedReceipt`, only owned file |
| Closing act | `src/app/(workspace)/calendar/actions.ts`: `completeVisitAction` | Same action, owned uncommitted file |
| Visit evidence | `src/app/(workspace)/calendar/actions.ts`: `uploadAssignedVisitEvidenceAction` | Same action, owned uncommitted file |
| Document template | `src/app/(workspace)/settings/template-actions.ts`: `uploadDocumentTemplateAction` | Same action, owned uncommitted file |
| Chat attachment | `src/app/(workspace)/chat/actions.ts`: `sendChatMessageAction` | Same action, owned uncommitted file |
| Channel avatar | `src/app/(workspace)/chat/actions.ts`: `updateChatChannelSettingsAction` | Same action; old avatar may be removed after replacement |

Outside interactive actions, `scripts/seed-local-example-data.mjs` writes
local example files and can unlink them on a known rollback. It rejects S3
and invalid backends. `scripts/backup-snapshot.mjs` writes a private staging
copy; `scripts/backup-worker.mjs` writes archives and removes expired backup
archives, not business files. `scripts/backup-restore.mjs` extracts files into
an isolated temporary directory for verification. Read-only
`scripts/storage-audit.mjs` reports references and orphans without deleting.

The filesystem/S3 adapter's `removeDocumentFile` is reached from the nine
interactive flows above. A [global writer lease and durable drain candidate](FILE_WRITE_DRAIN.md)
now wraps those flows and the local example seed in source, but it is not installed or fully accepted.
FS-02/03 require the remaining
operator reconciliation and runtime/browser tests before any live storage switch.
