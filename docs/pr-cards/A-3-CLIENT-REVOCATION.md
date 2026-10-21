# A-3 client-owned OAuth revocation — universal identity directive

Frozen owner-authorized outcome (2026-10-21): native clients can disconnect their own OAuth
access/refresh grant through RFC7009 without knowing the administrator passphrase. Registration
is not account authority. Authenticate using the client's persisted public/confidential method;
never accept a request to downgrade another client or borrow a developer credential.

Implementation: generic core revocation handler; api/oauth/revoke; issuer metadata; atomic SQL
revokeOAuthToken conditional on client_id and connector kind. Revoke both access and refresh on
the selected row. Revoking an expired access token still stops refresh. Unknown, already-revoked,
foreign-client and RTC-pass values produce the same successful empty response and no foreign
mutation. No provider credential is revoked; this disconnects only the service's delegated grant.

Proof: actual handler lifecycle against fake and isolated PostgreSQL stores; public/confidential,
header/body ambiguity, unsupported method, wrong client, sibling grant, access/refresh, expired,
replay and kind isolation. Existing full checks/unit/DB/RTC or emulator CI at exact head required.
Real released client disconnect/refresh refusal remains OPEN until authorized deployed evidence.

No schema change, production migration, real token revocation, money movement, permission
widening or release. Existing provider setup and source-complete multi-user architecture gaps
remain open on existing CAP-2/CAP-3/CAP-5; this does not create new subsection or bundle credit.
Reference: https://www.rfc-editor.org/rfc/rfc7009 (client authentication, ownership, idempotent response).
