```
 _____ ___  ____   ____ _____
|  ___/ _ \|  _ \ / ___| ____|
| |_ | | | | |_) | |  _|  _|
|  _|| |_| |  _ <| |_| | |___
|_|   \___/|_| \_\\____|_____|

 Federal Contract Lifecycle Management
```

# Forge CLM

**Full-stack monorepo for managing the entire lifecycle of federal government contracts** — from opportunity identification through closeout, with AI-powered document analysis, semantic search, compliance monitoring, and automated workflows.

---

## Table of Contents

- [Architecture](#architecture)
- [Packages](#packages)
- [Quick Start](#quick-start)
- [Development](#development)
- [API Reference](#api-reference)
- [Database Schema](#database-schema)
- [State Machines](#state-machines)
- [AI & NLP](#ai--nlp)
- [Agent Framework](#agent-framework)
- [Frontend](#frontend)
- [Testing](#testing)
- [Infrastructure](#infrastructure)
- [Environment Variables](#environment-variables)

---

## Architecture

```
                    +-------------------+
                    |   SvelteKit Web   |  :5173
                    |  (TailwindCSS +   |
                    |   Skeleton UI)    |
                    +--------+----------+
                             |
                    +--------v----------+
                    |   Fastify API     |  :3000
                    |  JWT Auth, CRUD,  |
                    |  FSM, Search, RAG |
                    +--+-----+------+---+
                       |     |      |
            +----------+  +--+--+  ++----------+
            |             |     |              |
   +--------v---+  +------v-+  +v--------+  +-v-----------+
   | PostgreSQL  |  | Redis  |  |LocalStack|  | NLP Service |
   | + pgvector  |  |        |  |  (S3)   |  | (FastAPI)   |
   | 4 schemas   |  |        |  |         |  | Embeddings  |
   +-------------+  +--------+  +---------+  | NER, Chunks |
       :5432          :6379       :4566       +-------------+
                                                  :8000
```

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | SvelteKit, TailwindCSS, Skeleton UI | Dashboard, contract views, search, compliance |
| **API** | Fastify, Drizzle ORM, Zod | REST endpoints, JWT auth, FSM transitions |
| **Database** | PostgreSQL 16, pgvector | 4 schemas, 20+ tables, HNSW vector index |
| **NLP** | Python FastAPI, legal-bert, spaCy | Embeddings (768-dim), NER, document chunking |
| **Agents** | TypeScript agent framework | 8 AI agents for ingestion, analysis, compliance |
| **Infra** | Docker Compose, AWS CDK | Local dev stack, cloud deployment |

---

## Packages

```
forge-clm/
  packages/
    api/          @forge/api       Fastify REST API server
    web/          @forge/web       SvelteKit frontend
    shared/       @forge/shared    FSM engine, types, constants
    agents/       @forge/agents    AI agent framework & agents
    nlp/          @forge/nlp       Python NLP microservice
  infra/          @forge/infra     AWS CDK infrastructure
  tests/          @forge/tests     Integration & E2E test suites
  scripts/                         Validation & utility scripts
```

---

## Quick Start

### Prerequisites

- Node.js >= 20
- Docker & Docker Compose
- Python 3.11+ (for NLP service, optional for local dev)

### 1. Clone & Install

```bash
git clone git@github.com:shanedynamo/forge-clm.git
cd forge-clm
npm install
```

### 2. Environment Setup

```bash
cp .env.example .env
```

### 3. Start the Dev Stack

```bash
# Start all services (Postgres, Redis, LocalStack, API, NLP, Web)
npm run dev

# Or start individual services
npm run dev:api   # Fastify API on :3000
npm run dev:web   # SvelteKit on :5173
```

### 4. Run Migrations

```bash
npm run db:migrate
npm run db:seed     # Optional: seed with sample data
```

### 5. Open the App

Navigate to [http://localhost:5173](http://localhost:5173)

---

## Development

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start full Docker stack |
| `npm run dev:api` | API dev server with hot reload |
| `npm run dev:web` | SvelteKit dev server |
| `npm run build` | Build all packages (shared -> api -> web) |
| `npm run test` | Run unit tests (API + Web) |
| `npm run test:integration` | Run integration tests against Docker |
| `npm run test:e2e` | Run Playwright E2E tests |
| `npm run lint` | Lint API and Web packages |
| `npm run db:migrate` | Run Drizzle migrations |
| `npm run db:seed` | Seed database with sample data |

### Full Validation

Run the complete validation suite (Docker, unit, integration, performance, E2E):

```bash
./scripts/validate-local.sh
```

Options:
- `--no-docker` — Skip Docker lifecycle (if stack is already running)
- `--keep-up` — Don't tear down Docker after tests

---

## API Reference

All routes are prefixed with `/api/v1` and require JWT authentication (except `/health`).

### Authentication

| Endpoint | Description |
|----------|-------------|
| `/health` | Health check (unauthenticated) |

Attach JWT via `Authorization: Bearer <token>` header. Roles: `admin`, `contracts_manager`, `contracts_team`, `viewer`.

### Contracts

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/contracts` | team+ | Create contract |
| `GET` | `/contracts` | any | List with pagination, sort, filter |
| `GET` | `/contracts/:id` | any | Get contract details |
| `PATCH` | `/contracts/:id` | team+ | Update contract |
| `POST` | `/contracts/:id/transition` | team+ | FSM state transition |
| `GET` | `/contracts/:id/history` | any | State change history |
| `GET` | `/contracts/:id/clauses` | any | List clauses |
| `GET` | `/contracts/:id/mods` | any | List modifications |
| `GET` | `/contracts/:id/options` | any | List options |
| `GET` | `/contracts/:id/deliverables` | any | List deliverables |
| `GET` | `/contracts/:id/compliance` | any | List compliance milestones |

### Modifications

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/modifications` | team+ | Create modification |
| `GET` | `/modifications/:id` | any | Get modification |
| `PATCH` | `/modifications/:id` | team+ | Update modification |
| `POST` | `/modifications/:id/transition` | team+ | FSM transition |

### NDAs

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/ndas` | team+ | Create NDA |
| `GET` | `/ndas` | any | List NDAs |
| `GET` | `/ndas/:id` | any | Get NDA |
| `PATCH` | `/ndas/:id` | team+ | Update NDA |
| `POST` | `/ndas/:id/transition` | team+ | FSM transition |

### MOUs

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/mous` | team+ | Create MOU with parties |
| `GET` | `/mous` | any | List MOUs |
| `GET` | `/mous/:id` | any | Get MOU |
| `PATCH` | `/mous/:id` | team+ | Update MOU |
| `POST` | `/mous/:id/transition` | team+ | FSM transition |

### Requests

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/requests` | team+ | Create contract request |
| `GET` | `/requests` | any | List with pagination/filter |
| `GET` | `/requests/:id` | any | Get request |
| `PATCH` | `/requests/:id` | team+ | Update request |

### Search & RAG

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/search` | any | Semantic vector search over document chunks |
| `POST` | `/ask` | any | RAG-powered Q&A with citations |

**POST /search** body:
```json
{
  "query": "intellectual property rights",
  "filters": { "contractId": "uuid", "sectionType": "SECTION_I", "clauseType": "252.227" },
  "limit": 10
}
```

**POST /ask** body:
```json
{
  "question": "What are the IP rights on the SOCOM contract?",
  "contract_id": "uuid"
}
```

### Compliance

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/compliance/upcoming?days=30` | any | Milestones due within N days |
| `GET` | `/compliance/overdue` | any | Past-due milestones |

### Pagination & Filtering

List endpoints support query parameters:
- `page` — Page number (default: 1)
- `limit` — Items per page (default: 20, max: 100)
- `sort` — Sort column, prefix `-` for descending (e.g. `-ceilingValue`)
- `filter` — Key:value pairs (e.g. `status:ACTIVE,contractType:FFP`)

---

## Database Schema

PostgreSQL 16 with pgvector extension. Four schemas:

### `contracts` — Core Business Data

| Table | Description |
|-------|-------------|
| `contracts` | Prime contracts with status, type, values, PoP, CO info |
| `modifications` | Contract mods (funding, scope, admin, option exercise) |
| `contract_clauses` | FAR/DFARS clauses attached to contracts |
| `clause_library` | Master clause reference with full text |
| `clins` | Contract Line Item Numbers |
| `contract_options` | Option periods with exercise status |
| `deliverables` | CDRLs and other deliverables |
| `compliance_milestones` | Recurring and one-time compliance deadlines |
| `contract_requests` | NDA, MOU, new contract, mod requests |
| `ndas` | Non-Disclosure Agreements |
| `mous` | Memoranda of Understanding |
| `mou_parties` | MOU party junction table |
| `parties` | External organizations |
| `subcontracts` | Subcontract relationships |
| `flowdown_requirements` | Clause flowdown tracking |
| `government_property` | GFP/GFE/GFI tracking |
| `small_business_plans` | SB plan compliance |
| `communications_log` | Correspondence tracking |
| `approval_queue` | Multi-step approval workflows |

### `vectors` — Semantic Search

| Table | Description |
|-------|-------------|
| `document_chunks` | Chunked document text with 768-dim vector embeddings (HNSW index) |
| `entity_annotations` | NER-extracted entities linked to chunks |
| `clause_embeddings` | Clause library embeddings for similarity matching |

### `audit` — Compliance Trail

| Table | Description |
|-------|-------------|
| `audit_log` | Append-only change log (trigger-driven) |
| `agent_execution_log` | AI agent run history with token usage |
| `approval_audit` | Approval decision trail |
| `document_access_log` | Document access tracking |

### `agents` — AI Orchestration

| Table | Description |
|-------|-------------|
| `agent_registry` | Registered agent types and configs |
| `agent_tasks` | Task queue with priority and status |
| `agent_context` | Per-agent persistent context |
| `playbook_rules` | Configurable rules for agent behavior |

---

## State Machines

Forge uses finite state machines (FSM) to enforce valid lifecycle transitions with role-based authorization.

### Prime Contract Lifecycle

```
OPPORTUNITY_IDENTIFIED
        |
        v  [contracts_team]
PROPOSAL_IN_PROGRESS <----+
        |                  |
        v  [contracts_mgr] |
PROPOSAL_SUBMITTED         |
       / \                 |
      v   v                |
AWARD_    NOT_AWARDED       |
PENDING   (terminal)       |
      |                    |
      v  [contracts_mgr]  |
   AWARDED                 |
      |                    |
      v  [contracts_mgr]  |
   ACTIVE -----------------+
   / | | \
  v  v  v  v
OPTION  MOD_IN  STOP   CLOSEOUT   TERMINATED
PENDING PROGRESS WORK  PENDING        |
  |       |       |       |           v
  +---+---+   +---+       v        CLOSED
      |        |        CLOSED
      v        v
   ACTIVE   TERMINATED
```

### Additional FSMs

- **Modification**: MOD_IDENTIFIED -> MOD_ANALYSIS -> MOD_DRAFTED -> MOD_UNDER_REVIEW -> MOD_SUBMITTED -> MOD_NEGOTIATION -> MOD_EXECUTED
- **NDA**: REQUESTED -> DRAFTED -> INTERNAL_REVIEW -> SENT_TO_COUNTERPARTY -> NEGOTIATION -> EXECUTED -> EXPIRED/RENEWED/TERMINATED
- **MOU**: REQUESTED -> DRAFTED -> INTERNAL_REVIEW -> SENT_TO_COUNTERPARTY -> NEGOTIATION -> EXECUTED -> EXPIRED/RENEWED/TERMINATED

All transitions are role-gated (`contracts_manager`, `contracts_team`, or `system`) with audit logging.

---

## AI & NLP

### NLP Microservice (Python FastAPI — port 8000)

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Service health with model status |
| `POST /embed` | Generate 768-dim embeddings from text |
| `POST /embed-chunks` | Batch embed contract chunks |
| `POST /ner/extract` | Named entity recognition (single text) |
| `POST /ner/extract-batch` | Batch NER extraction |
| `POST /pipeline/ingest` | Full document ingestion pipeline |

### Embedding Model

- **Model**: `nlpaueb/legal-bert-base-uncased` (legal domain fine-tuned)
- **Dimensions**: 768
- **Batch size**: 32
- **Index**: HNSW with cosine similarity (`vector_cosine_ops`)

### Document Ingestion Pipeline (9 steps)

1. Fetch document from S3
2. Extract text (DOCX/PDF)
3. Detect UCF sections (A through M)
4. Chunk text (target: 500 tokens, max: 600, overlap: 50)
5. Named entity recognition
6. Generate embeddings
7. Map contract metadata
8. Quality check (human review flagging)
9. Store chunks + annotations in DB

### NER Entity Types

| Entity | Example |
|--------|---------|
| FAR Clause | 52.204-21 |
| DFARS Clause | 252.227-7013 |
| Contract Number | FA8726-24-C-0042 |
| NAICS Code | 541330 |
| Dollar Amount | $5,000,000.00 |
| Date | January 1, 2025 |
| Agency | US Air Force |
| CAGE Code | 1ABC2 |
| Period of Performance | 12 months |

### Vector Search

Semantic search using pgvector cosine similarity:
- Query text is embedded via the NLP `/embed` endpoint
- Cosine similarity computed against `document_chunks.embedding`
- Results ranked by similarity score with optional filters (contract, section, clause type)

### RAG (Retrieval-Augmented Generation)

- Retrieves relevant chunks via vector search
- Fetches structurally adjacent chunks for context continuity
- Builds prompt with source citations
- Calls LLM (Mock for dev, Bedrock for production)
- Returns answer with confidence score and source citations

---

## Agent Framework

Eight AI agents automate contract management workflows:

| Agent | Trigger | Description |
|-------|---------|-------------|
| **Contract Ingestion** | New S3 upload | Fetches, chunks, embeds, extracts entities from contract documents |
| **Intake Classifier** | New request | Classifies incoming requests by type, priority, and routing |
| **Clause Analysis** | New/modified clause | Reviews clauses against playbook rules, scores risk, generates redlines |
| **Contract Intelligence** | User query | RAG-powered Q&A interface for contract questions |
| **Compliance Monitor** | Scheduled | Tracks deadlines, sends reminders, flags overdue milestones |
| **Document Generation** | Request | Generates NDAs, MOUs, option letters, funding requests from templates |
| **Flowdown Generator** | New subcontract | Identifies required flowdown clauses for subcontracts |
| **Mod Communication** | Mod status change | Drafts and routes modification-related communications |

### Agent Architecture

```typescript
// All agents extend BaseAgent<TInput, TOutput>
abstract class BaseAgent<TInput, TOutput> {
  abstract execute(task: AgentTask): Promise<TOutput>;
}

// Agents are registered in AgentRegistry and executed by AgentRunner
// with retry logic, audit logging, and error handling
```

### Agent Dependencies (Dependency Injection)

- `LLMProvider` — Mock (dev) or Bedrock (prod)
- `VectorSearchProvider` — Semantic search over document corpus
- `DatabaseProvider` — SQL query execution and contract context
- `AuditProvider` — Execution logging
- `FsmProvider` — State machine transitions

---

## Frontend

### SvelteKit Pages

| Route | Description |
|-------|-------------|
| `/login` | Authentication with role selection |
| `/` | Dashboard with metrics, compliance, activity feed |
| `/contracts` | Sortable/filterable contract table with pagination |
| `/contracts/[id]` | Contract detail with tabs: Overview, Clauses, Modifications, Options, Deliverables, Compliance, Documents, Communications |
| `/search` | Semantic search + Ask AI mode with citations |
| `/compliance` | Summary cards, calendar, overdue table, funding bars |
| `/requests` | Kanban board with request cards, new request modal |
| `/agents` | Agent monitoring and task management |
| `/playbook` | Rules editor for agent behavior |
| `/reports` | Analytics and reporting |

### Design System

- **TailwindCSS** with custom color palettes:
  - `navy-50` through `navy-950` — Primary dark blue theme
  - `accent-50` through `accent-900` — Action/link blue
- **Skeleton UI** plugin for component primitives
- **Dark mode** support (class-based)
- Responsive layout with collapsible sidebar

---

## Testing

**145 tests** across 5 layers, all passing:

| Suite | Tests | Tool | Description |
|-------|-------|------|-------------|
| Shared unit | 84 | Vitest | FSM engine: transitions, roles, hooks, lifecycles |
| API unit | 19 | Vitest | Auth, CRUD, FSM routes, health |
| Performance | 8 | Vitest | API latency, DB throughput, vector search benchmarks |
| Docker validation | 12 | Vitest | Full stack: PG, Redis, S3, migrations, CRUD, search, RAG, auth |
| E2E | 22 | Playwright | Login, dashboard, contracts, search, compliance, requests |

### Running Tests

```bash
# Unit tests
npm test

# Integration tests (requires Docker test stack)
docker compose -f docker-compose.test.yml -p forge-test up -d --wait
DATABASE_URL="postgresql://forge:forge@localhost:5433/forge_test" npm run test:integration

# E2E tests (starts mock API + SvelteKit automatically)
npm run test:e2e

# Full validation (everything)
./scripts/validate-local.sh
```

### Performance Benchmarks

| Benchmark | Threshold | Description |
|-----------|-----------|-------------|
| GET /health | < 50ms | Health check latency |
| GET /contracts (50 rows) | < 200ms | Paginated list query |
| GET /contracts/:id | < 300ms | Detail with relations |
| POST /search (1K chunks) | < 500ms | Vector similarity search |
| POST /ask (RAG) | < 1000ms | Full RAG pipeline with mock LLM |
| Bulk insert (100 contracts) | < 2s | Transaction throughput |
| Vector search (10K chunks) | < 200ms | HNSW index performance |
| Complex join (4 tables) | < 100ms | Aggregation query |

---

## Infrastructure

### Docker Compose — Development

```bash
docker compose up
```

| Service | Image | Port | Description |
|---------|-------|------|-------------|
| postgres | pgvector/pgvector:pg16 | 5432 | Primary database |
| redis | redis:7-alpine | 6379 | Cache & message broker |
| localstack | localstack/localstack | 4566 | S3, SQS, SNS emulation |
| api | Node 20 Alpine | 3000 | Fastify API server |
| nlp | Python 3.11 | 8000 | NLP microservice |
| web | Node 20 Alpine | 5173 | SvelteKit frontend |

### Docker Compose — Test

```bash
docker compose -f docker-compose.test.yml -p forge-test up -d --wait
```

| Service | Port | Description |
|---------|------|-------------|
| postgres-test | 5433 | Test database (tmpfs — ephemeral) |
| redis-test | 6380 | Test Redis |
| localstack-test | 4567 | Test S3/SQS |

### AWS CDK (Production)

Infrastructure-as-code in `infra/` for deploying to AWS:
- RDS PostgreSQL with pgvector
- ElastiCache Redis
- ECS Fargate for API, NLP, and Web services
- S3 for document storage
- SQS for task queues
- CloudWatch for monitoring

---

## Environment Variables

```bash
# Database
DATABASE_URL=postgresql://forge:forge@localhost:5432/forge
DATABASE_URL_TEST=postgresql://forge:forge@localhost:5433/forge_test

# Redis
REDIS_URL=redis://localhost:6379

# AWS / LocalStack
AWS_ENDPOINT=http://localhost:4566
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
S3_BUCKET=forge-documents
SQS_QUEUE_URL=http://localhost:4566/000000000000/forge-tasks
SNS_TOPIC_ARN=arn:aws:sns:us-east-1:000000000000:forge-notifications

# AI / Bedrock
BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0
BEDROCK_REGION=us-east-1

# NLP Service
NLP_SERVICE_URL=http://localhost:8000

# Integrations
JIRA_API_TOKEN=
JIRA_BASE_URL=https://your-org.atlassian.net
MS_GRAPH_CLIENT_ID=
MS_GRAPH_CLIENT_SECRET=
MS_GRAPH_TENANT_ID=

# Auth
JWT_SECRET=change-me-in-production
SESSION_SECRET=change-me-in-production

# App
NODE_ENV=development
API_PORT=3000
WEB_PORT=5173
LOG_LEVEL=debug
```

---

## License

Proprietary. All rights reserved.
