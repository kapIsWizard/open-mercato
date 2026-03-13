# TLDR

Wprowadzamy nowy moduł aplikacyjny `purchasing`, którego celem jest obsługa zapytań handlowych kierowanych do działu zakupów. Moduł ma pokryć cały proces od szybkiego zgłoszenia zapytania przez handlowca/BOK, przez rozbicie na pozycje produktowe, po operacyjną obsługę statusów, przypisanie zakupowca, komentarze i podstawowe wyszukiwanie.

Wersja wdrażana w tym branchu to POC. Obejmuje: formularz zapytania, listę zapytań, pozycje zapytania, statusy requestu i pozycji, przypisanie właściciela zakupowego, komentarze oraz podstawowe filtrowanie/wyszukiwanie. Poza POC pozostają oferty dostawców, ranking ofert, zamówienia do dostawców, automatyczna integracja z Subiektem i zaawansowana analityka.

Po analizie rozmowy z handlowcem z dnia 13 marca 2026 doprecyzowano, że w POC krytyczne są:
- szybkie zgłoszenie mobilne,
- wiele pozycji w jednym zgłoszeniu,
- załączniki do requestu i komentarzy,
- statusowanie per pozycja,
- pełna widoczność postępu dla handlowca,
- jawne pole na numer referencyjny produktu.

Wejście głosowe pozostaje wysoko na backlogu, ale poza minimalnym zakresem aktualnego POC.

# Overview

## Business Context

Handlowcy i BOK otrzymują nieustrukturyzowane zapytania klientów dotyczące produktów niedostępnych w magazynie. Obecnie proces jest rozproszony i trudny do monitorowania. Dział zakupów potrzebuje jednego miejsca do przyjmowania spraw, rozbijania ich na pozycje, nadawania statusów i komunikacji z resztą organizacji.

## Product Intent

Docelowy produkt ma obsługiwać:
- rejestrację zapytania klienta,
- rozbicie na niezależne pozycje produktowe,
- obsługę statusów na poziomie requestu i pozycji,
- przypisanie odpowiedzialnej osoby po stronie zakupów,
- komentarze i załączniki,
- wyszukiwanie i raportowanie,
- w kolejnych etapach: oferty dostawców, scoring, integrację z ERP i automatyzacje.

# Problem Statement

Obecny proces nie zapewnia:
- szybkiego mobilnego zgłoszenia zapytania,
- ustrukturyzowanego modelu danych dla zakupów,
- spójnego statusowania requestów i pozycji,
- jednego źródła prawdy dla handlowców, BOK i zakupów,
- podstaw do porównywania ofert i integracji z Subiektem.

Skutkiem są opóźnienia, utrata kontekstu, brak audytu procesu i słaba widoczność statusu dla klienta wewnętrznego.

# Goals

- Utworzyć moduł zgodny z konwencjami Open Mercato.
- Dostarczyć operacyjny POC możliwy do użycia przez handlowców, BOK i dział zakupów.
- Zachować prosty model domenowy, który można rozszerzyć bez łamania kontraktów.
- Oprzeć POC na istniejących mechanizmach platformy: CRUD factory, ACL, search, comments, attachments, i18n, setup.

# Non-Goals For This Branch

- Moduł dostawców jako osobny bounded context.
- Porównywarka ofert i automatyczny ranking.
- Automatyczne zamówienia do dostawców z Open Mercato.
- Dwukierunkowa synchronizacja z Subiektem.
- Transkrypcja głosówek, scrapowanie e-maili, deduplikacja, reklamacje, merge pozycji.
- Rozbudowane KPI i SLA reporting.

# Scope

## Full Target Scope

### 1. Intake
- formularz prosty dla handlowca,
- formularz rozszerzony dla BOK,
- wklejanie tabeli z Excela,
- zdjęcia i pliki,
- opcjonalne pobieranie danych produktu po SKU,
- jawne pole numeru referencyjnego / numeru producenta,
- powiązanie z klientem po NIP.

### 2. Request Management
- lista zapytań,
- detail requestu,
- przypisywanie zakupowca,
- status requestu,
- historia zmian,
- wyszukiwarka i filtry.

### 3. Request Items
- osobny rekord dla każdej pozycji,
- numer referencyjny jako first-class field,
- status pozycji,
- ETA / termin dostawy,
- notatka zakupowa,
- powiązanie z przyszłym zamówieniem do dostawcy,
- masowa edycja.

### 4. Supplier Offers
- rejestr ofert,
- porównanie po cenie, ETA i MOQ,
- rekomendacja wyboru.

### 5. Integrations
- lookup firmy po NIP,
- Subiekt: firma, stany, dostępność, zamówienia, statusy.

### 6. Notifications And Reporting
- powiadomienia o zmianach statusu,
- podstawowe raporty operacyjne,
- później dashboardy i SLA.

## POC Scope Implemented In This Branch

- nowy moduł `apps/mercato/src/modules/purchasing/`,
- encje `PurchasingRequest`, `PurchasingRequestItem`, `PurchasingComment`,
- CRUD API dla requestów, pozycji i komentarzy,
- backend pages: lista, create, detail/edit,
- statusy requestu i pozycji jako pola kontrolowane aplikacyjnie,
- przypisanie zakupowca,
- podstawowe wyszukiwanie i filtrowanie,
- numer referencyjny jako jawne pole wejściowe i filtr wyszukiwania,
- lookup produktów z istniejącego `catalog` przez dedykowane API `purchasing`,
- browser produktów importowanych do POC z filtrami po dostawcy, grupie i dostępności zakupowej,
- wsparcie importu przykładowych produktów klienta z CSV do `catalog` przez CLI modułu `purchasing`,
- powiązanie pozycji requestu z `catalog_product_id`,
- minimalny model komentarzy,
- załączniki request-level i comment-level oparte o istniejący moduł `attachments`,
- cleanup załączników przy usuwaniu komentarza lub requestu.

# Users And Permissions

## Roles

### Sales Representative
- create request,
- view own requests,
- add comments,
- update limited intake fields before assignment.

### Customer Service (BOK)
- create request,
- use extended form,
- search requests,
- view statuses,
- add comments.

### Purchasing
- view all requests,
- assign request to self / other purchaser,
- update request status,
- update item statuses,
- set delivery term,
- maintain purchasing notes,
- perform bulk item operations in later phases.

### Administrator
- manage ACL,
- manage dictionaries/configuration when introduced,
- full access.

## ACL Features

POC introduces additive feature IDs:
- `purchasing.requests.view`
- `purchasing.requests.create`
- `purchasing.requests.update`
- `purchasing.requests.assign`
- `purchasing.items.view`
- `purchasing.items.update`
- `purchasing.comments.view`
- `purchasing.comments.manage`
- `purchasing.admin`

Default roles:
- `superadmin`: `purchasing.*`
- `admin`: `purchasing.*`
- `employee`: narrow subset configured for sales/BOK visibility

# Domain Model

## Entity: PurchasingRequest

Represents one customer request scoped to exactly one customer/company context.

Fields:
- `id`
- `tenant_id`
- `organization_id`
- `request_number`
- `customer_nip`
- `customer_name`
- `customer_company_id` nullable FK-by-id to customers module record
- `source_channel` enum-like string: `phone | email | meeting | chat | other`
- `form_variant` enum-like string: `simple | extended`
- `request_status` string
- `sales_owner_user_id`
- `purchasing_owner_user_id` nullable
- `customer_order_number` nullable
- `request_text` nullable
- `attachments_count` integer default 0
- `created_at`
- `updated_at`
- `deleted_at`

Rules:
- one request belongs to one organization and tenant,
- one request may contain many items,
- request status is derived operationally but stored explicitly for query simplicity in POC,
- `customer_nip` or `customer_name` must be present on create.

## Entity: PurchasingRequestItem

Represents one product line from a request.

Fields:
- `id`
- `tenant_id`
- `organization_id`
- `request_id`
- `line_no`
- `sku` nullable
- `reference_number` nullable
- `product_name`
- `quantity`
- `item_status`
- `delivery_due_at` nullable
- `supplier_order_number` nullable
- `purchasing_note` nullable
- `catalog_product_id` nullable
- `subiekt_document_id` nullable
- `created_at`
- `updated_at`
- `deleted_at`

Rules:
- every request must have at least one item,
- `quantity > 0`,
- `reference_number` is optional but treated as a first-class identifier in UI and search because handlowcy often work on reference codes rather than product names,
- item status is managed independently from request status,
- future supplier/order/integration links are additive columns.

## Entity: PurchasingComment

POC comment timeline entry attached to request or item.

Fields:
- `id`
- `tenant_id`
- `organization_id`
- `request_id`
- `request_item_id` nullable
- `body`
- `author_user_id`
- `created_at`
- `updated_at`
- `deleted_at`

Rules:
- comment must belong to request,
- item-level comment may additionally point to one request item.

# Status Model

## Request Statuses

POC canonical values, zgodne z dokumentacją funkcjonalno-procesową:
- `unassigned`
- `assigned`
- `in_progress`
- `partially_ordered`
- `completed`
- `cancelled`

Mapowanie etykiet biznesowych:
- `unassigned` → `Nieprzydzielone`
- `assigned` → `Przydzielone`
- `in_progress` → `W trakcie`
- `partially_ordered` → `Częściowo zamówione`
- `completed` → `Zrealizowane`
- `cancelled` → `Anulowane`

Rules:
- new request starts as `unassigned`,
- assigning `purchasing_owner_user_id` may move request to `assigned`,
- request may become `in_progress` podczas operacyjnej obsługi zapytania,
- request may become `completed` only when all active items are terminal,
- request may become `partially_ordered` when at least one item is ordered/in transit and at least one remains open.

## Item Statuses

POC canonical values, zgodne z dokumentacją funkcjonalno-procesową:
- `to_order`
- `ordered`
- `in_transit`
- `in_stock`
- `cancelled`
- `purchase_price_changed`

Mapowanie etykiet biznesowych:
- `to_order` → `Do zamówienia`
- `ordered` → `Zamówione u dostawcy`
- `in_transit` → `W dostawie`
- `in_stock` → `Na magazynie`
- `cancelled` → `Anulowane`
- `purchase_price_changed` → `Zmiana ceny zakupu`

Rules:
- new item starts as `to_order`,
- `purchase_price_changed` is a non-terminal exception state,
- `in_stock` and `cancelled` are terminal for POC workflow.

# UX And Screens

## 1. Request Create

Path:
- `/backend/purchasing/requests/create`

Behavior:
- responsive page, low field count,
- simple and extended mode toggle,
- company identification by NIP + customer name,
- editable lines table,
- textarea for raw request text,
- later-compatible with attachments,
- submit via `Cmd/Ctrl+Enter`, cancel via `Escape`.

## 2. Requests List

Path:
- `/backend/purchasing/requests`

Behavior:
- DataTable list,
- quick search,
- filters: request status, item status, customer, owner, purchaser, created date, SKU,
- row navigation to detail.

## 3. Request Detail

Path:
- `/backend/purchasing/requests/[id]`

Behavior:
- header with request identity and status,
- editable request metadata,
- item list with inline operational fields,
- comments section,
- future slots for attachments and supplier offers.

# API Contracts

## `GET /api/purchasing/requests`

Purpose:
- list requests with filters and pagination.

Query:
- `page`, `pageSize`
- `search`
- `requestStatus`
- `itemStatus`
- `salesOwnerUserId`
- `purchasingOwnerUserId`
- `customerNip`
- `sku`
- `createdFrom`, `createdTo`

Response:
- paged list with request fields,
- may include lightweight aggregates: `itemsCount`, `openItemsCount`.

## `POST /api/purchasing/requests`

Purpose:
- create request with nested items from intake form.

Payload:
- request header fields,
- `items[]` containing `sku`, `productName`, `quantity`.

Response:
- created request id and normalized item count.

## `PUT /api/purchasing/requests`

Purpose:
- update request-level metadata and assignment.

## `DELETE /api/purchasing/requests`

Purpose:
- soft delete request.

## `GET /api/purchasing/request-items`

Purpose:
- list items independently for operational filtering.

Query:
- `requestId`
- `itemStatus`
- `sku`
- `search`
- `page`, `pageSize`

## `POST /api/purchasing/request-items`

Purpose:
- add item to existing request.

## `PUT /api/purchasing/request-items`

Purpose:
- update item status and operational fields.

## `DELETE /api/purchasing/request-items`

Purpose:
- soft delete item.

## `GET /api/purchasing/comments`

Purpose:
- list comments for request or item.

## `POST /api/purchasing/comments`

Purpose:
- add comment.

## `PUT /api/purchasing/comments`

Purpose:
- update comment.

## `DELETE /api/purchasing/comments`

Purpose:
- delete comment.

# Architecture

## Module Placement

POC is implemented as an app module:
- `apps/mercato/src/modules/purchasing/`

Reasoning:
- feature is product-specific and being delivered as POC,
- minimizes blast radius in core packages,
- allows iterative hardening before considering promotion into `packages/core`.

## Files Expected In POC

- `index.ts`
- `acl.ts`
- `setup.ts`
- `events.ts`
- `search.ts`
- `di.ts`
- `api/openapi.ts`
- `api/requests/route.ts`
- `api/request-items/route.ts`
- `api/comments/route.ts`
- `backend/purchasing/requests/page.tsx`
- `backend/purchasing/requests/create/page.tsx`
- `backend/purchasing/requests/[id]/page.tsx`
- `data/entities.ts`
- `data/validators.ts`
- `i18n/pl.json`
- `i18n/en.json`

## Technical Decisions

### CRUD
- use `makeCrudRoute`,
- use command pattern for writes,
- include `indexer: { entityType }`,
- keep response shapes additive and simple.

### Relationships
- no direct ORM relations across modules,
- customer link stored as id-only (`customer_company_id`),
- user references stored as `*_user_id`.

### Search
- POC supports API-level filtering and module `search.ts` for request/item search indexing,
- request and item searchable by request number, customer, SKU, product name, status.

### Comments
- dedicated `PurchasingComment` entity instead of reusing customers comments,
- avoids mixing timelines across bounded contexts,
- keeps future attachment binding local to purchasing.

### Attachments
- not fully implemented in POC detail workflow unless low-friction wiring is possible,
- model and UI leave extension point for integration with attachments module.

# Events And Notifications

## Events

POC adds typed events:
- `purchasing.request.created`
- `purchasing.request.updated`
- `purchasing.request.assigned`
- `purchasing.request_item.created`
- `purchasing.request_item.updated`
- `purchasing.request_item.status_changed`
- `purchasing.comment.created`

## Notifications

POC target:
- internal event scaffolding only,
- optional notification delivery may be deferred if it materially slows delivery.

Future notifications:
- notify sales owner when item status moves to `cancelled`, `completed/in_stock`, `purchase_price_changed`.

# Workflow

## POC Workflow

1. Sales/BOK creates request.
2. System creates request and child items.
3. Request starts as `unassigned`.
4. Purchasing assigns owner and starts processing.
5. Purchasing updates item statuses and notes.
6. Teams communicate through comments.
7. Request is completed or cancelled.

## Full Workflow Later

1. Intake
2. Assignment
3. Supplier offer collection
4. Offer comparison
5. Supplier order placement
6. Delivery tracking
7. ERP synchronization
8. Reporting and optimization

# Validation Rules

- `pageSize <= 100`
- `quantity > 0`
- at least one item on create
- request create requires actor auth and feature
- non-purchasing users cannot update operational purchasing fields
- comments require non-empty body
- all routes must scope by `organization_id` and `tenant_id`

# Integration Coverage Plan

## API Paths

Integration tests must cover:
- create request with multiple items,
- list requests with search and status filters,
- assign purchasing owner,
- update item status,
- add comment to request,
- list imported purchasing products with supplier/group/availability filters,
- persist `catalog_product_id` on request item create when selected from imported product set,
- upload request attachment,
- upload comment attachment,
- cleanup request/comment attachments on delete,
- access control for sales vs purchasing roles,
- tenant/organization scoping,
- soft delete behavior.

## UI Paths

Integration tests must cover:
- request create form submit,
- imported products browser filtering,
- request create with attachment upload before submit,
- requests list search/filter,
- request detail item status change,
- comment add flow,
- request attachment visibility on detail page,
- role-based visibility of operational controls.

# Migration And Backward Compatibility

- This is an additive new module with new routes, entities, ACL features and events.
- No existing API route, entity, feature id or import path is renamed or removed.
- Future evolution must keep route URLs, event IDs, ACL IDs and generated contracts stable once released beyond POC.

# Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual Risk |
|------|----------|------|------------|---------------|
| Module scope grows into supplier/order domain too early | Medium | Architecture | Keep POC bounded to request + item + comments | Medium |
| Cross-module coupling to customers/users causes brittle ORM model | High | Data model | Store foreign ids only, enrich separately | Low |
| Status logic drifts between request and items | Medium | Workflow | Store explicit canonical statuses and centralize recompute helpers | Medium |
| Search on request header only misses line-level intent | Medium | UX | Include item fields in filters and search config | Low |
| Attachments deferred create expectation gap | Medium | UX | Mark as phased capability in spec and leave extension point in detail page | Medium |
| Role rules are too permissive in POC | High | Security | Define dedicated ACL features and gate write routes/page metadata | Low |

# Implementation Plan For This Branch

1. Scaffold app module `purchasing` and enable it in `apps/mercato/src/modules.ts`.
2. Add entities, validators, ACL, setup, events, search and i18n.
3. Implement CRUD APIs for requests, items and comments.
4. Build backend pages for list, create and detail.
5. Run `npm run modules:prepare` and project verification.
6. Add or scaffold integration coverage for critical POC flows.

# Final Compliance Report

- Task Router checked: root `AGENTS.md`, `packages/core/AGENTS.md`, `packages/core/src/modules/customers/AGENTS.md`, `packages/core/src/modules/sales/AGENTS.md`.
- Spec created before non-trivial implementation.
- Design keeps changes additive and contract-safe.
- Module remains app-local for POC to limit risk.
- All tenant-scoped entities require `organization_id` and `tenant_id`.

# Changelog

## 2026-03-13

- Created initial full feature specification for purchasing request handling.
- Defined bounded POC scope for current branch.
