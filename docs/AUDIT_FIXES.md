# Nook 1.3.1 audit fixes

## Plan and implementation

1. Isolate cached data by authenticated user ID, restore that user's cloud profile, and fetch discovery when the city becomes available.
2. Enforce QR possession, bilateral blocks, trust, and capacity in PostgreSQL; make account deletion compatible with retained moderation evidence.
3. Add the connection inbox and reconcile reminder cancellation; verify database and mobile logic before release.

All three source changes are implemented. Live rollout is pending project access and physical-device acceptance.

| Finding | Resolution |
| --- | --- |
| Shared local profile | Each auth user gets `nook-<user-id>.db`; auth changes remount the provider. Cloud profile restores on another phone. Unattributed legacy `nook.db` is never copied into a signed-in account. |
| Empty discovery | Initial profile load precedes city fetch; city changes reload activities. Failures show an error instead of presenting local demo plans as cloud activities. |
| QR row visibility | A private authenticated function verifies an opaque live token and its expected owner; QR rows remain owner-only. Direct client connection inserts are revoked. |
| Account deletion | A transactional auth deletion trigger removes owned activities/groups. Report targets become tombstones. Token deletion cascades connection rows. Storage failures are surfaced. Successful deletion clears the current account cache and reminders. |
| One-way blocking | Internal block lookup checks both directions without exposing private block lists. Approval rechecks block state. |
| Overbooking | Request decisions and capacity edits lock the same parent activity; PostgreSQL checks approved attendance. Discovery uses aggregate remaining places, without exposing attendee identities. |
| Trusted update bypass | Create/update policies use server trust and restriction checks. Group approvals also recheck eligibility. |
| Budget overflow | Per-person budget uses integer with the existing 0–100000 constraint. |
| Stale reminders | Reconciliation cancels rejected/deleted plans; serialized logout cleanup wins over in-flight syncs. Account owner tracking preserves reminders across same-account restarts. Reconciliation runs across tabs, on Realtime updates and on foreground resume. An offline or terminated app cannot learn about a remote cancellation until its next server sync. |
| Incomplete connections | Profile inbox shows incoming/outgoing requests, with accept/decline and refresh. Scanner errors unlock retry. |
| Recursive rate-limit policies | Private trigger checks serialize per-account daily budgets and set server timestamps; users cannot forge old timestamps to evade limits. |
| Writable identities | Column grants prevent rewriting request/connection identities, login usernames, or notification contents. |

## Deployment order

The connected Supabase tool returned `You do not have permission to perform this action` for project `wjuwshaexqigxlzmtnkz`. No hosted schema or Edge Function changes were made.

1. Review and apply `supabase/patches/audit_fixes.sql` to that existing Nook project. It is transactional and rerunnable. Fresh installations use the complete `supabase/schema.sql` instead. Do not re-run the whole baseline schema on an existing project.
2. Deploy `supabase/functions/delete-account/index.ts` after the SQL patch. Its account-content cleanup now relies on the database trigger.
3. Build and distribute app 1.3.1, build 14. New RPCs must be installed before this app is distributed. Existing older clients require updating for the new QR flow and profile permissions.
4. Confirm two-account signup/recovery, profile restore, discovery, QR accept/decline, blocking, full capacity, rejection reminder cancellation, and deletion on physical Android/iOS devices.

A patch rollback should restore the predeployment database backup and preceding app/Edge Function versions together. Do not remove the new guards while retaining the new client assumptions. Unattributed legacy local caches stay untouched on disk and are not used by the new app.

## Validation

- `npm run check`: strict TypeScript.
- `npm test`: 15 PostgreSQL/PGlite regression scenarios plus real SQLite account isolation/cache deletion and mocked native notification reconciliation.
- The database harness executes the complete schema and reruns the upgrade patch, with actual PostgreSQL RLS/grants/triggers. Auth/storage service scaffolding is local. PGlite uses one connection; it does not verify concurrent transactions across separate server connections.
- `npx expo export --platform android --platform ios`: JavaScript/Hermes bundle compilation, not a signed native build or device test.
- `EXPO_OFFLINE=1 npx expo install --check`: local compatibility metadata only; online compatibility check previously timed out at the proxy.

Physical devices, hosted schema parity, email delivery, storage service behavior, native binaries and store submission remain unverified. CI now runs the regression suite on pull requests and before the main-branch APK build.
