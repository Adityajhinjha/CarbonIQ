# CarbonIQ API and routing integration

This document is the frontend/backend handoff contract for the CarbonIQ academic MVP. It describes the routes the current frontend actually calls, the DTO shapes it consumes, the application navigation model, and the steps required to switch from the synthetic demonstration to a live FastAPI service.

The implementation sources are:

- `apps/web/src/carboniq/api.ts` — the only live HTTP adapter;
- `apps/web/src/carboniq/domain.ts` — shared frontend DTOs and service interface;
- `apps/web/src/carboniq/demo.ts` — explicit synthetic implementation;
- `apps/web/src/carboniq/CarbonIQ.tsx` — views, hash router, and integration states;
- `apps/web/.env.example` — public runtime configuration.

> Contract status: the provided `PROJECT_DOCUMENTATION.md` refers to `api/API_SPECIFICATION.md`, but that API specification and the backend Pydantic/OpenAPI schemas were not included. The endpoint and DTO contract below is therefore the frontend's explicit integration contract and must be compared with the backend OpenAPI document before production use.

## 1. Connection modes

CarbonIQ has two intentionally separate data modes:

| Mode | Purpose | Data source | API failure behavior |
| --- | --- | --- | --- |
| `demo` | Visual demonstration and frontend review | 30 clearly labelled synthetic projects | No network request |
| `api` | Live backend integration | `NEXT_PUBLIC_CARBONIQ_API_URL` | Displays the connection/API error; never falls back to demo data |

Create `apps/web/.env.local` from `apps/web/.env.example`:

```dotenv
NEXT_PUBLIC_CARBONIQ_MODE=api
NEXT_PUBLIC_CARBONIQ_API_URL=http://localhost:8000/api/v1
```

Then restart the frontend:

```bash
npm run dev
```

The base URL should include the API version and should not include an endpoint path. A trailing slash is accepted and removed by the adapter.

Only public browser configuration belongs in `NEXT_PUBLIC_*` variables. Database credentials, registry keys, signing secrets, and service tokens must remain on the backend.

## 2. Runtime request flow

```text
CarbonIQ view
    -> CarbonIQService interface (domain.ts)
        -> live createApiService() adapter (api.ts)
            -> FastAPI /api/v1 endpoint
                -> validated JSON or PDF response
        -> normalized DTO returned to the view
```

UI components do not call `fetch` directly. Backend route or response changes should be isolated to `domain.ts` and `api.ts` so the design remains independent of transport details.

The live adapter currently applies:

- a 20-second timeout;
- `Accept: application/json` for data and `Accept: application/pdf` for reports;
- `Content-Type: application/json` for JSON bodies;
- `Authorization: Bearer <access_token>` after login;
- browser-managed multipart boundaries for project import uploads;
- structured error normalization;
- automatic in-memory token removal after a `401`;
- no silent demo-data fallback.

## 3. Frontend application routes

The Next.js application is a single root page with a client-side hash router. This makes the complete workspace portable into Framer without requiring server rewrites. All views are served from `/`; the fragment after `#/` selects the view.

| Browser location | View | Backend activity |
| --- | --- | --- |
| `/` or `#/home` | Marketing landing page | Loads featured projects |
| `#/catalogue` | Searchable project catalogue | `GET /projects` |
| `#/catalogue?<filters>` | Catalogue with URL-preserved filters | `GET /projects` with query parameters |
| `#/project/{project_id}` | Project evidence, score, risks, documents, and assistant | Project, score, and risk routes; assistant on submit |
| `#/comparison` | Compare two to four selected projects | `POST /projects/compare` |
| `#/preferences` | Buyer constraints and goals | Preference create/update on submit |
| `#/recommendations` | Ranked matches with reasons and trade-offs | `POST /recommendations` |
| `#/portfolio` | Diversified allocation builder | `POST /portfolios/optimize`; portfolio update when saved |
| `#/saved` | Saved portfolio list | `GET /portfolios` |
| `#/methodology` | Versioned scoring method and glossary | None |
| `#/curator` | Curator CSV import and processing status | Import create and status routes |

Catalogue URL parameters use the same names as `ProjectFilters`:

```text
query
category
country
project_type
registry
verification_status
vintage
max_price
max_risk
sdg
sort
page
page_size
```

Example:

```text
/#/catalogue?country=IN&category=removal&max_risk=30&sort=score_desc&page=1&page_size=9
```

Comparison selections, the active recommendation run, an unsaved portfolio, the simulated order modal, and the bearer token are intentionally held in memory. They are not written to local storage. A full browser refresh therefore clears that temporary state; saved preferences and portfolios must be reloaded from the API.

## 4. Backend endpoint contract

All routes below are relative to the configured base URL, normally `/api/v1`.

### 4.1 Authentication

| Method | Route | Request | Expected response |
| --- | --- | --- | --- |
| `POST` | `/auth/register` | `{ "name", "email", "password" }` | Any `2xx`; frontend immediately logs in |
| `POST` | `/auth/login` | `{ "email", "password" }` | `{ "access_token": "..." }` |
| `GET` | `/auth/me` | Bearer token | `User` |

`User`:

```json
{
  "id": "user_123",
  "name": "Srijan Sahu",
  "email": "user@example.com",
  "role": "buyer"
}
```

Allowed roles are `visitor`, `buyer`, `curator`, and `administrator`. The current frontend keeps the access token only in memory and sends it as a bearer token. `logout()` is client-side token removal; no logout endpoint is required by the current contract.

### 4.2 Project catalogue and evidence

| Method | Route | Request | Expected response |
| --- | --- | --- | --- |
| `GET` | `/projects` | `ProjectFilters` as query parameters | `PageResult<Project>` |
| `GET` | `/projects/{project_id}` | Path parameter | `Project` |
| `GET` | `/projects/{project_id}/score` | Path parameter | `ProjectScore` or `null` |
| `GET` | `/projects/{project_id}/risk-signals` | Path parameter | `RiskSignal[]` |
| `POST` | `/projects/compare` | `{ "project_ids": ["...", "..."] }` | `Project[]` in requested order |

Pagination response:

```json
{
  "items": [],
  "total": 30,
  "page": 1,
  "page_size": 9
}
```

Comparison requires two to four unique project IDs. If order matters in the response, preserve the request order.

The catalogue treats these project properties as filterable or sortable: category, country, project type, registry, verification status, vintage, unit price, risk score, SDG, and CarbonIQ score.

### 4.3 Buyer preferences

| Method | Route | Request | Expected response |
| --- | --- | --- | --- |
| `GET` | `/preferences` | Bearer token | `BuyerPreference[]` |
| `POST` | `/preferences` | `BuyerPreference` without `id` | Created `BuyerPreference` with `id` |
| `PATCH` | `/preferences/{preference_id}` | Updated `BuyerPreference` | Updated `BuyerPreference` |

Representative request:

```json
{
  "name": "My climate strategy",
  "currency": "INR",
  "budget": "1000000",
  "required_credits": 1000,
  "risk_tolerance": "low",
  "countries": ["IN"],
  "categories": ["removal"],
  "project_types": [],
  "sdgs": [13, 15],
  "minimum_quality": 65,
  "delivery_period": "2026",
  "min_projects": 3,
  "max_projects": 5,
  "concentration_limit": 40
}
```

Money values such as `budget` are decimal strings to avoid binary floating-point errors. Scores and percentages are numeric values from 0 to 100.

### 4.4 Recommendations

| Method | Route | Request | Expected response |
| --- | --- | --- | --- |
| `POST` | `/recommendations` | `{ "preference_id": "..." }` | `RecommendationRun` |

Each recommendation item must contain the complete project, a `match_score`, human-readable `reasons`, and human-readable `trade_offs`. The run also includes `engine_version`, `data_snapshot`, `created_at`, and `stale` so the UI can explain reproducibility and prevent portfolio generation from stale results.

### 4.5 Portfolio optimization and saved portfolios

| Method | Route | Request | Expected response |
| --- | --- | --- | --- |
| `POST` | `/portfolios/optimize` | Optimization request below | `Portfolio` |
| `GET` | `/portfolios` | Bearer token | `Portfolio[]` |
| `PATCH` | `/portfolios/{portfolio_id}` | `{ "name": "..." }` | Updated `Portfolio` |

Optimization request:

```json
{
  "preference_id": "pref_123",
  "budget": "1000000",
  "currency": "INR",
  "required_credits": 1000,
  "min_projects": 3,
  "max_projects": 5,
  "concentration_limit": 40,
  "locked_allocations": [
    {
      "credit_id": "credit_123",
      "quantity": 250
    }
  ]
}
```

The optimizer must respect budget, available inventory, currency, required quantity, project-count limits, concentration limits, eligibility rules, and locked quantities. An impossible combination should return a structured error with code `NO_FEASIBLE_PORTFOLIO` and actionable details instead of a partial allocation represented as success.

Portfolio items are evidence snapshots. They preserve the unit price, score, risk warnings, and provenance used when the allocation was generated.

### 4.6 Project document assistant

| Method | Route | Request | Expected response |
| --- | --- | --- | --- |
| `POST` | `/projects/{project_id}/assistant/ask` | `{ "question": "..." }` | `AssistantAnswer` |

The `status` must be one of `supported`, `insufficient_evidence`, `conflicting_evidence`, or `unavailable`. Answers include citations and limitations:

```json
{
  "answer": "The monitoring report states ...",
  "status": "supported",
  "citations": [
    {
      "document_id": "doc_123",
      "title": "Monitoring report",
      "page": 18,
      "excerpt": "Short supporting excerpt",
      "url": "https://example.com/report.pdf"
    }
  ],
  "limitations": []
}
```

The assistant must remain grounded in project documents. Missing or contradictory evidence should be represented by the status and limitations rather than invented content.

### 4.7 Simulated order and PDF report

| Method | Route | Request | Expected response |
| --- | --- | --- | --- |
| `POST` | `/orders/simulate` | `{ "portfolio_id": "..." }` | `SimulatedOrder` |
| `GET` | `/orders/{order_id}/report` | Bearer token | PDF bytes |

The report route must return `Content-Type: application/pdf`. A simulated order is not a purchase, transfer, or retirement. Preserve the exact disclaimer and `disclaimer_version` in the immutable response snapshot.

### 4.8 Curator project import

| Method | Route | Request | Expected response |
| --- | --- | --- | --- |
| `POST` | `/imports/projects` | `multipart/form-data`, field name `file` | `ImportBatch` |
| `GET` | `/imports/{import_id}` | Bearer token | `ImportBatch` |

`ImportBatch` contains `id`, `status`, `accepted_rows`, `rejected_rows`, and row-level errors with `row`, `field`, and `message`. Do not require callers to set the multipart `Content-Type`; the browser adds the correct boundary.

## 5. Core DTO rules

The complete TypeScript definitions live in `domain.ts`. These are the integration rules most likely to cause frontend/backend mismatches:

- IDs are strings and must be safe to use as URL path parameters after encoding.
- Currency amounts and unit prices are decimal strings.
- Dates and timestamps are ISO 8601 strings.
- Nullable data remains `null`; do not replace unavailable evidence with zero.
- Category is `avoidance`, `reduction`, `removal`, or `mixed`.
- Risk severity is `informational`, `low`, `medium`, `high`, or `critical`.
- `risk_score` uses lower-is-better semantics; the other displayed scores use higher-is-better semantics.
- `confidence` is a decimal from 0 to 1, not a percentage from 0 to 100.
- `ProjectScore.status` is `scored` or `insufficient_evidence`.
- `is_synthetic` and provenance `classification` must remain explicit in every relevant response.
- `data_as_of`, `retrieved_at`, scoring versions, optimizer versions, and rule versions are part of the evidence trail, not optional display decoration.

The seven deterministic score components and weights are:

| Key | Display name | Weight |
| --- | --- | ---: |
| `integrity` | Climate integrity and additionality | 25% |
| `permanence` | Permanence and reversal protection | 15% |
| `verification` | Verification and methodology quality | 15% |
| `co_benefits` | Social and biodiversity co-benefits | 15% |
| `value` | Price and buyer value | 10% |
| `delivery` | Delivery and developer reliability | 10% |
| `compatibility` | Regulatory and claims compatibility | 10% |

## 6. Error contract

Preferred error envelope:

```json
{
  "error": {
    "code": "NO_FEASIBLE_PORTFOLIO",
    "message": "No portfolio satisfies all active constraints.",
    "details": {
      "constraints": ["concentration_limit", "min_projects"]
    },
    "request_id": "req_123"
  }
}
```

The adapter also accepts FastAPI's standard string or object `detail` response. It checks `error.request_id` and then the `X-Request-ID` response header. Recommended statuses:

| Status | Meaning |
| --- | --- |
| `400` | Invalid business operation |
| `401` | Missing, invalid, or expired access token |
| `403` | Authenticated user lacks the required role |
| `404` | Project, preference, portfolio, order, or import not found |
| `409` | Stale data, conflicting update, or infeasible state |
| `413` | Import file is too large |
| `422` | Field-level validation failure |
| `429` | Rate limit exceeded |
| `500` | Unexpected backend failure |
| `503` | Required upstream data source is unavailable |

Never return a successful `200` with an embedded error object.

## 7. CORS and browser access

For local FastAPI development, allow both common Next.js origins. Add the final Framer domain when API mode is used from a deployed Framer page.

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "https://your-carboniq-site.framer.website",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["X-Request-ID"],
)
```

Use the exact deployed origin rather than `*`. A published HTTPS Framer site must call an HTTPS API; browsers normally block an HTTPS page from requesting an insecure HTTP API.

## 8. Framer connection

The connected Framer `CarbonIQCanvas` component exposes these controls:

| Control | Use |
| --- | --- |
| Data mode | Select `Synthetic demo` or `Live FastAPI` |
| API base URL | Set the public HTTPS `/api/v1` base URL |
| Workspace URL | Optional URL of the complete Next.js workspace |
| Signal color | Visual accent only |

In live mode the Framer landing component calls:

```text
GET /projects?page=1&page_size=3&sort=score_desc
```

It expects the same `PageResult<Project>` response and shows an explicit API connection error if the request fails. When `Workspace URL` is set, Framer calls-to-action navigate into the full application, for example `https://app.example.com/#/catalogue`.

## 9. Backend connection checklist

Before changing `NEXT_PUBLIC_CARBONIQ_MODE` to `api`:

1. Obtain the backend OpenAPI document, normally `http://localhost:8000/openapi.json`.
2. Compare every schema with `domain.ts`, especially nullability, decimal strings, timestamps, score confidence, pagination, and error envelopes.
3. Confirm every route and HTTP method in section 4.
4. Confirm all protected routes accept the bearer token returned by `/auth/login`.
5. Configure exact CORS origins for local Next.js, the deployed Next.js app, and Framer if Framer calls the API directly.
6. Verify the API returns `application/pdf` for reports and accepts multipart uploads under the `file` field.
7. Run the frontend in `api` mode and exercise login, catalogue, project detail, comparison, preferences, recommendations, optimization, saved portfolios, assistant, simulation/report, and curator import.
8. Test unavailable evidence, expired authentication, validation errors, infeasible portfolios, upstream failure, and request timeout states.
9. Run `npm run typecheck`, `npm test`, and `npm run build`.
10. Keep demo and live data visually distinguishable and preserve all provenance and non-transaction disclaimers.

If the backend contract differs, normalize it in `api.ts` or update the DTO in `domain.ts`. Do not spread backend-specific field translations across React components.
