# Relational map — Vercel Unleashed (vercel-mcp)

A readable diagram of how the whole system connects: who calls whom, what
reads or writes what, and what depends on what. This is the map of the
**real, built system** — not the roadmap. When a feature is built or
changed, this map is refreshed in the same change (see `docs/RULES.md`).

- Pointer: `docs/MAP.md`
- Deep verified facts: `docs/ARCHITECTURE.md` · Tool list: `docs/TOOL-CATALOG.md`
- Current heads / live state: `docs/STATUS.md`

## The system in one picture

```mermaid
flowchart LR
  subgraph clients["AI clients"]
    C1["Claude / Muse / ChatGPT<br/>and other MCP clients"]
    C2["Robinson Toolkit Hub<br/>(RTC 1 consumer)"]
    B1["Browser user<br/>(front door, /connection)"]
  end

  subgraph entry["Entry — same handlers, two hosts"]
    RACK["rack-server.mjs<br/>standalone Node server (production)"]
    VJSON["vercel.json + api/ functions<br/>(Vercel-shaped contract)"]
    API["api/ handlers<br/>mcp · oauth · tools · contract<br/>whoami · results · webhooks · health"]
  end

  subgraph core["Core — src/core/"]
    OAUTH["OAuth issuer<br/>oauth.js · oauth-handlers.js<br/>mcp-auth.js · cimd.js"]
    MCPSRV["MCP server<br/>mcp-server.js (SDK)"]
    REG["Tool registry<br/>registry.js"]
    WRITE["Write guards<br/>write.js · write-preflight.js<br/>result-rules.js"]
    RTC["RTC 1 contract<br/>rtc-contract.js"]
  end

  subgraph tools["Tools — src/tools/ (108 modules)"]
    T["253 registered vercel_* tools<br/>index.js merges all families"]
  end

  subgraph prov["Provider layer — src/vercel/"]
    PC["client.js · provider.js<br/>operations.js"]
    POL["Read / write policy<br/>api-read-policy.js · api-write-policy.js"]
  end

  DB[("Postgres store<br/>src/db.js — 22 tables<br/>rack Postgres in production")]
  SEC["Secret box<br/>core/secret-box.js<br/>AES-256-GCM at rest"]
  VAPI["Vercel API<br/>teams · projects · deployments<br/>env · domains · DNS · …"]
  WH["Vercel deployment webhooks<br/>→ api/webhooks/deployments.js"]

  C1 -->|"HTTPS + OAuth bearer<br/>POST /api/mcp"| API
  C2 -->|"RTC 1 HTTPS<br/>/api/tools, /api/contract"| API
  B1 -->|"HTTPS"| API
  RACK --> API
  VJSON -.->|"same contract"| API
  API --> OAUTH
  API --> MCPSRV
  API --> RTC
  MCPSRV --> REG
  RTC --> REG
  REG --> T
  T --> WRITE
  T --> PC
  PC --> POL
  PC -->|"HTTPS, enrolled team token"| VAPI
  OAUTH --> DB
  T --> DB
  WRITE --> DB
  DB --> SEC
  WH -->|"HMAC-verified raw body"| API
```

## Area maps

| File | Area |
|---|---|
| [01-entry-and-clients.md](01-entry-and-clients.md) | Hosts, routes, and who connects |
| [02-auth-and-identity.md](02-auth-and-identity.md) | Sign in with Vercel, OAuth, enrollment, passes |
| [03-tools-and-gateway.md](03-tools-and-gateway.md) | Tool registry, dispatch, write guards |
| [04-vercel-provider.md](04-vercel-provider.md) | The wrapped Vercel API surface |
| [05-storage-and-secrets.md](05-storage-and-secrets.md) | Postgres tables, encryption, retention |
| [06-release-and-operations.md](06-release-and-operations.md) | CI, promotion to `live`, rack production, webhooks |

## Reading conventions

- **calls** — a runtime request from one part to another.
- **reads / writes** — data flow into or out of the store.
- **depends-on** — the part does not work without the other.
- A box named in backticks is a real file or route in this repo.
