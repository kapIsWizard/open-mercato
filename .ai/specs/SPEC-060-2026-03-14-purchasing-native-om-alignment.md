# TLDR

Druga iteracja modułu `purchasing` odchodzi od własnego, równoległego modelu produktów i firm. Moduł zostaje przepięty na natywne mechanizmy Open Mercato:
- produkty z `catalog`, w tym produkty importowane przez Akeneo PIM,
- firmy z `customers.companies`,
- attachmenty z modułu `attachments`,
- powiadomienia z modułu `notifications`,
- operacje masowe i listy przez `DataTable`,
- historię aktywności jako osobny, audytowalny timeline.

Najważniejsze decyzje:
- usuwamy custom importer CSV z `purchasing`,
- request item wskazuje na `catalog_product` albo `catalog_product_variant`,
- request wskazuje na natywną firmę OM,
- detail requestu przechodzi na taby zamiast długiego scrolla,
- dodajemy osobny tab `Activity history`,
- request automatycznie przechodzi na `completed`, gdy wszystkie itemy są `in_stock`,
- statusy itemów zapisują się bez ręcznego, łatwego do pominięcia `Save item`,
- komentarze pokazują autora i wspierają attachmenty,
- dodajemy powiadomienia przy utworzeniu requestu oraz przy kluczowych zmianach statusu.

# Overview

## Business Context

Pierwsza iteracja POC potwierdziła sens procesu zakupowego, ale też ujawniła główną wadę architektury: moduł `purchasing` zbudował zbyt dużo własnych, równoległych funkcji zamiast wykorzystać natywne funkcjonalności Open Mercato.

Największe problemy:
- produkty w requestach nie są osadzone w natywnym katalogu OM,
- firmy nie są spięte z natywnymi firmami OM,
- detail requestu jest zbyt ciężki i mało czytelny,
- brakuje pełnej historii aktywności,
- statusy i zapisy pozycji są zbyt manualne,
- komentarze i attachmenty nie wykorzystują w pełni istniejących wzorców platformy.

## Product Intent

Po tej iteracji `purchasing` ma stać się cienką warstwą workflow nad natywnym OM:
- intake i operacyjny workflow zakupowy pozostają w `purchasing`,
- produkt, firma, attachment, powiadomienie i timeline są budowane przez istniejące platformowe mechanizmy,
- Akeneo PIM jest docelowym źródłem katalogu dla klienta.

# Problem Statement

Aktualny moduł ma trzy fundamentalne problemy:

1. **Rozjazd modelu danych**
- własny import CSV i własna lista produktów w `purchasing`,
- brak pełnego powiązania z katalogiem OM i z firmami OM.

2. **Niepełny workflow operacyjny**
- brak historii aktywności,
- brak attachmentów do komentarzy,
- brak masowej edycji,
- ręczny zapis itemów prowadzi do błędów użytkownika.

3. **Niespójny UX**
- detail requestu wymaga nadmiernego scrollowania,
- create form ma pola zbędne dla POC,
- picker produktów nie łączy wyboru produktu i ilości w jednym komponencie,
- panel zakupowca nie wykorzystuje czytelnego podziału na listę i filtr/statystyki.

# Goals

- Przepiąć `purchasing` na natywne modele Open Mercato.
- Używać katalogu OM jako jedynego źródła produktów dla requestów.
- Powiązać requesty z natywnymi firmami.
- Uprościć create/detail UX zgodnie z feedbackiem.
- Dodać historię aktywności, attachmenty w komentarzach i powiadomienia.
- Wprowadzić masową edycję pozycji produktowych.
- Zachować zgodność z architekturą `integrations`, `data_sync`, `catalog`, `customers`, `attachments`, `notifications`.

# Non-Goals

- Nie budujemy nowego, osobnego importera CSV do `purchasing`.
- Nie budujemy osobnego modułu dostawców i porównywarki ofert w tej iteracji.
- Nie implementujemy jeszcze transkrypcji głosowej.
- Nie rozwiązujemy jeszcze docelowego systemu numeracji requestów, jeśli klient nie poda finalnego formatu.

# Source References

Projekt opiera się na aktualnych wzorcach i dokumentacji Open Mercato:
- [apps/docs/docs/user-guide/akeneo-pim.mdx](/Users/dawid/Projects/rekru/open-mercato/apps/docs/docs/user-guide/akeneo-pim.mdx)
- [apps/docs/docs/framework/modules/integrations-data-sync.mdx](/Users/dawid/Projects/rekru/open-mercato/apps/docs/docs/framework/modules/integrations-data-sync.mdx)
- [apps/docs/docs/user-guide/customers/companies.mdx](/Users/dawid/Projects/rekru/open-mercato/apps/docs/docs/user-guide/customers/companies.mdx)
- [apps/docs/docs/framework/modules/notifications.mdx](/Users/dawid/Projects/rekru/open-mercato/apps/docs/docs/framework/modules/notifications.mdx)
- [apps/docs/src/framework/admin-ui/widget-injection.mdx](/Users/dawid/Projects/rekru/open-mercato/apps/docs/src/framework/admin-ui/widget-injection.mdx)
- [packages/core/AGENTS.md](/Users/dawid/Projects/rekru/open-mercato/packages/core/AGENTS.md)
- [packages/ui/AGENTS.md](/Users/dawid/Projects/rekru/open-mercato/packages/ui/AGENTS.md)
- [ANALYSIS-007-akeneo-pim-integration.md](/Users/dawid/Projects/rekru/open-mercato/.ai/specs/analysis/ANALYSIS-007-akeneo-pim-integration.md)

# Scope

## In Scope

### 1. Native product alignment
- usunięcie custom importera CSV z `purchasing`,
- przepięcie wyboru produktów na natywne `catalog_products`,
- wsparcie dla `catalog_product_variant`,
- wykorzystanie produktów importowanych przez `sync-akeneo`.

### 2. Native company alignment
- dodanie/upewnienie się istnienia pola NIP na poziomie firmy,
- powiązanie requestu z `customers.company`,
- wykorzystanie natywnego wyszukiwania firmy zamiast tylko tekstowego `customer_name` + `customer_nip`.

### 3. Request workflow
- automatyczny request status `completed`, gdy wszystkie itemy są `in_stock`,
- poprawa zapisu statusów itemów,
- uproszczenie workflow requestu i owner assignment.

### 4. Comments, attachments, activity
- komentarze z imieniem i nazwiskiem autora,
- attachmenty na poziomie komentarza,
- osobny tab `Activity history`,
- audyt zmian statusów requestu i itemów.

### 5. Notifications
- powiadomienie przy utworzeniu nowego requestu,
- powiadomienie dla zgłaszającego przy kluczowych zmianach statusu itemów,
- powiadomienie przy zmianie statusu requestu.

### 6. Bulk operations
- masowa edycja pozycji produktowych w panelu zakupowca.

### 7. UI/UX cleanup
- create form bez assignment/source/variant,
- picker produktu z ilością w jednym komponencie,
- detail requestu na tabach,
- layout zakupowca `4/5 + 1/5`,
- czytelniejsze, kolorowe statusy.

## Out Of Scope

- ranking i porównywarka ofert dostawców,
- zamówienia do dostawców jako osobny bounded context,
- integracja z ERP/Subiektem jako źródło automatycznej finalizacji,
- zaawansowane SLA/reporting.

# Functional Requirements

## R1. Products must come from native catalog

- Request item MUST store `catalogProductId` or `catalogProductVariantId`.
- UI create/edit MUST search native catalog entities only.
- Legacy custom product import path in `purchasing` MUST be removed from active flow.
- If no native catalog product is found, user MAY still create a temporary descriptive item only if explicitly preserved by business decision; default target is catalog-backed items.

## R2. Requests must be linked to native companies

- Request MUST support `customerCompanyId`.
- Request create flow MUST support selecting an existing OM company.
- Company NIP MUST be available and searchable at company level.
- Existing `customer_name` / `customer_nip` fields remain only as compatibility/storage helpers or are derived from linked company where possible.

## R3. Item status updates must persist without fragile manual save

- Item status changes MUST persist immediately or through explicit autosave batching.
- UX MUST NOT depend on per-row `Save item` as the only reliable persistence mechanism.
- Bulk updates MUST support status changes for many rows.

## R4. Request status auto-completion

- When every non-deleted request item has status `in_stock`, request status MUST automatically become `completed`.
- This transition MUST be idempotent and auditable.

## R5. Comments

- Each comment MUST display:
  - author full name,
  - created date/time,
  - content.
- Comments MUST support attachment upload and listing.
- Comment attachment removal MUST respect `attachments.manage`.

## R6. Activity history

- Detail requestu MUST contain tab `Activity history`.
- Timeline MUST include at minimum:
  - request created,
  - request assigned/unassigned,
  - request status changed,
  - request item status changed,
  - relevant comment/attachment actions if feasible in phase 1.
- Each event MUST show:
  - timestamp,
  - actor,
  - action summary,
  - previous/new status if applicable.

## R7. Notifications

- On request creation, notify purchasing audience.
- On request/item status change, notify request submitter where business-relevant.
- On item statuses `cancelled`, `in_stock`, `purchase_price_changed`, notify submitter.

## R8. Purchasing layout

- Main purchasing list view MUST use two columns:
  - left `4/5`: request list,
  - right `1/5`: filters + dashboard stats.
- List MUST begin at top of page, not below large spacer sections.

## R9. Detail layout

- Under top summary cards, detail content MUST render as tabs:
  - `Items`
  - `Comments`
  - `Attachments`
  - `Activity history`
- Infinite vertical stacking of all sections is no longer acceptable for the main detail page.

# UX / UI Requirements

## Create Form

Remove from POC create form:
- assignment panel,
- source field,
- simple/advanced switch.

Keep:
- company,
- NIP,
- customer order number,
- request text,
- request attachments,
- product picker.

## Product Picker

Each product card/row MUST contain:
- product selection CTA,
- quantity input in the same UI component.

Additional rules:
- selected product can be deselected,
- newly added selected items appear at the top,
- selected state is obvious without requiring scroll to another section.

### Product Picker Detailed Behavior

The product selection flow MUST optimize for the smallest possible number of clicks in both create request and request edit contexts.

#### Default state

- The selected products list MUST be empty when user starts a new request.
- The UI MUST NOT render placeholder rows or prefilled draft items before first explicit product selection.
- The first selected product becomes the first row in the selected list.

#### Product card interaction

Each product card MUST contain, in one visible interaction area:
- product name,
- key identifiers useful in purchasing lookup:
  - SKU,
  - reference number,
  - supplier when available,
- availability summary when available,
- quantity input,
- primary select/add CTA.

The quantity input MUST be visible directly on the product card after search result is rendered.
The user MUST NOT need to:
- open a second modal,
- expand a separate drawer,
- scroll to another section,
- select the product first and only then set quantity elsewhere.

#### Select + quantity workflow

The core workflow MUST be:
1. user searches product,
2. user sees result card,
3. user enters quantity directly on that card,
4. user clicks one CTA to add/select the product.

Selecting a product MUST immediately create or update the request item with the quantity currently visible on the card.

If the same product is selected again:
- the system SHOULD increase existing quantity instead of creating a duplicate row,
- the updated product row MUST move to the top of the selected list,
- the interaction SHOULD preserve the feeling of fast repeated entry for large requests.

#### Selected list ordering

The selected products list MUST behave as a recency-ordered working list:
- newest added product appears at the top,
- repeated update of an already selected product also moves it to the top,
- the user MUST NOT need to scroll to the bottom to find the product just added.

This rule applies to:
- new request creation,
- further editing of request items when adding products from catalog.

#### Inline deselection and removal

The selected state on product card MUST be reversible.
The user MUST be able to:
- deselect/remove a product from the request,
- do it without manually clearing unrelated fields,
- do it with one obvious action from either:
  - the card,
  - or the selected list row.

The flow where product can be selected but cannot be unselected is explicitly forbidden.

#### Quantity visibility after selection

After product is selected:
- the selected list row MUST immediately show ordered quantity,
- quantity MUST remain editable without navigating away from the selected row,
- the quantity field in selected row SHOULD be treated as the source of truth for subsequent quick adjustments.

For mobile:
- quantity and remove actions MUST remain reachable without horizontal scrolling,
- selected row layout MUST stack vertically when needed instead of overflowing.

#### Mass editing inside request

When request already contains multiple items, the UI MUST support low-friction bulk operations.

Minimum required bulk behavior:
- user can select multiple request items,
- user can apply one status change to all selected items,
- user does not need to open each item one by one for repetitive operational changes.

Future-friendly extension point:
- the same bulk action surface SHOULD be able to support other fields later, such as supplier order number or operational note, without redesigning the whole list.

#### Mobile friendliness

The product adding experience MUST remain usable on phone-sized screens.

Required constraints:
- no mandatory side-by-side layout that causes horizontal scrolling,
- tab-based navigation is preferred over long vertical stacks,
- product browser and selected products SHOULD remain separate tabs on small screens,
- card CTA and quantity input MUST remain visible in the first viewport block of each result card.

#### Anti-patterns explicitly rejected

The implementation MUST NOT require this workflow:
1. select product,
2. scroll down to a separate selected section,
3. find the new row at the bottom,
4. set quantity there,
5. save manually per row.

This pattern is considered too click-heavy and too error-prone for the intended business usage.

## Purchasing Detail

Statuses MUST use color coding:
- green: final positive,
- red: negative/blocking,
- amber/orange: pending/risk,
- blue/neutral: assigned/in-progress informational.

## Read-only detail for sales/BOK

Sales and BOK SHOULD have:
- read-only request and item detail,
- ability to read status/history,
- ability to add comments,
- no ability to modify purchasing workflow.

# Architecture

## A1. Native catalog integration

`purchasing` stops owning a separate product source and becomes a consumer of:
- `catalog_products`,
- `catalog_product_variants`,
- `attachments`,
- `sync_external_id_mappings` indirectly through imported Akeneo catalog.

Expected implementation shape:
- replace purchasing-specific product lookup APIs with catalog-backed lookup endpoints or thin filtered wrappers,
- keep purchasing-specific filters only if they are projections of catalog data, not a separate model.

## A2. Native company integration

`purchasing` request links to `customers.company` via foreign-key-by-id pattern.

No ORM cross-module relation should be introduced directly. Store:
- `customerCompanyId`
- optionally denormalized `customerNameSnapshot`
- optionally denormalized `customerNipSnapshot`

This follows OM’s cross-module FK-by-id rule while keeping stable read performance and historical correctness.

## A3. Activity history model

Preferred implementation:
- introduce event-driven activity records for purchasing domain actions,
- or reuse a generic note/activity timeline pattern if an existing OM-compatible timeline surface fits without distortion.

Minimum event types:
- `purchasing.request.created`
- `purchasing.request.assigned`
- `purchasing.request.status_changed`
- `purchasing.item.status_changed`
- `purchasing.comment.created`

These events must be additive and backward compatible.

## A4. Tab host on request detail

The detail page should either:
- render native tabs directly, or
- expose widget injection/tab spots for future extension.

Recommended spot ids:
- `purchasing.request.detail:tabs`
- `purchasing.request.detail:details`

This mirrors OM’s documented tab injection pattern and avoids reworking the host again later.

## A5. Notifications architecture

Use standard OM notification flow:
- domain event subscriber,
- `notifications.ts`,
- optional `notifications.client.ts`,
- queue-backed delivery.

Do not create ad hoc polling or custom notification stores for purchasing.

# Data Model Changes

## PurchasingRequest

Add / refactor fields:
- `customerCompanyId` nullable string FK-by-id to company
- `requestSubmitterUserId` string
- `salesOwnerUserId` remains or is clarified as submitter/owner snapshot depending on business semantics

Potential compatibility fields:
- `customerNameSnapshot`
- `customerNipSnapshot`

## PurchasingRequestItem

Add / refactor fields:
- `catalogProductId` nullable
- `catalogProductVariantId` nullable
- keep `sku`, `referenceNumber`, `productName` as snapshot/search fields

Rules:
- if linked to catalog product or variant, snapshots are derived from source at selection time,
- later catalog changes do not silently rewrite purchasing history snapshots.

## Company

If missing or incomplete in current app setup:
- ensure company entity stores validated NIP,
- add validation and API/form exposure.

## Purchasing Activity

New entity if needed:
- `id`
- `tenant_id`
- `organization_id`
- `request_id`
- `request_item_id` nullable
- `event_type`
- `actor_user_id`
- `payload_json`
- `created_at`

Payload examples:
- previous/new status
- owner before/after
- summary text

# API Contracts

## Purchasing Requests API

Changes expected:
- create/update request accepts `customerCompanyId`
- request responses enrich company summary
- text search expands or keeps compatibility over:
  - request number,
  - company name,
  - NIP,
  - request text,
  - linked item product snapshots.

## Purchasing Items API

Changes expected:
- create/update item accepts `catalogProductId` / `catalogProductVariantId`
- status updates can be single or bulk
- bulk endpoint or bulk mutation contract required

## Comments API

Changes expected:
- comment response includes author display name
- comment attachments endpoint or attachment linkage flow is available

## Activity API

New read endpoint expected:
- `GET /api/purchasing/activity?requestId=<id>`

Optional:
- item-level filtering via `requestItemId`

# Permissions

Existing purchasing features remain, but semantics tighten:
- `purchasing.requests.view`
- `purchasing.requests.create`
- `purchasing.requests.update`
- `purchasing.requests.assign`
- `purchasing.items.view`
- `purchasing.items.update`
- `purchasing.comments.view`
- `purchasing.comments.manage`

Additional requirements through native modules:
- `customers.companies.view`
- `attachments.view`
- `attachments.manage`
- `notifications` uses existing module features, not purchasing-specific ACL for delivery.

# Migration Strategy

## M1. Remove custom CSV import from active flow

- CLI and UI importer path for purchasing-specific catalog bootstrap should be removed or deprecated.
- Historical commit availability is sufficient; runtime path should no longer be primary.

## M2. Data migration for request items

Where possible:
- backfill `catalogProductId` from existing snapshots (`sku`, reference, handle),
- preserve existing snapshot text even if no link can be resolved.

## M3. Data migration for requests

Where possible:
- backfill `customerCompanyId` based on NIP or exact company name match,
- preserve request snapshots when no deterministic match exists.

## M4. Compatibility

- Existing requests/items/comments remain readable.
- Existing statuses remain mapped to canonical status set if aliases still exist in DB.
- API responses remain additive where possible.

# Implementation Phases

## Phase 1 — Domain alignment
- remove purchasing CSV import from active product workflow,
- add native catalog link fields,
- add native company link fields,
- update validators and commands.

## Phase 2 — Create flow redesign
- remove assignment/source/variant from create UI,
- replace picker with catalog-backed product+quantity component,
- support deselect and top-insert behavior.

## Phase 3 — Detail workflow redesign
- tabbed detail view,
- autosave or save-on-change for item statuses,
- request auto-complete to `completed`,
- colorized statuses.

## Phase 4 — Comments, attachments, history
- comment author names,
- comment attachments,
- activity history tab,
- event subscribers and persistence.

## Phase 5 — Notifications and bulk actions
- notifications on create/status changes,
- bulk item status editing,
- role-aware read-only vs purchasing edit mode.

# Testing Strategy

Integration coverage MUST include:

## Request creation
- create request linked to native company
- create request with native catalog products
- create request without deprecated create-form fields

## Product picker
- search native catalog product
- select with quantity in one interaction
- deselect selected product
- newest selected item appears at top

## Detail tabs
- render `Items`, `Comments`, `Attachments`, `Activity history`
- tabs switch without losing state

## Status persistence
- single item status change persists
- request auto-completes when all items reach `in_stock`
- request does not auto-complete when at least one item is not `in_stock`

## Comments and attachments
- comment shows author full name + timestamp
- add attachment to comment
- request-level attachments remain separate

## Activity history
- request creation visible in history
- assignment visible in history
- item status transition visible with before/after values

## Notifications
- new request emits notification
- `in_stock` item emits notification to submitter
- `cancelled` item emits notification to submitter

## Bulk editing
- multi-select items
- bulk status change applies to all selected rows

## Permissions
- purchasing user gets full workflow edit
- sales/BOK gets read-only detail plus comments

# Risks & Impact Review

## Risk 1 — Data migration cannot resolve all legacy links

- Severity: High
- Impact: Existing requests may remain partially unlinked to native products/companies.
- Mitigation: keep snapshot fields, make links nullable, migrate best-effort only.
- Residual risk: Some historical records stay snapshot-only.

## Risk 2 — Over-coupling to catalog detail structure

- Severity: Medium
- Impact: Purchasing UI becomes brittle if catalog response shape changes.
- Mitigation: use explicit API contracts and enrichers, not deep client assumptions.
- Residual risk: Minor refactors still needed when catalog evolves.

## Risk 3 — Activity history duplicates existing comments/events

- Severity: Medium
- Impact: noisy timeline or inconsistent audit story.
- Mitigation: define canonical event types and rendering rules early.
- Residual risk: some non-critical duplication may remain in early rollout.

## Risk 4 — Autosave can introduce accidental writes

- Severity: Medium
- Impact: status edits persist before user intends them.
- Mitigation: optimistic UI with clear saving feedback and idempotent command handlers.
- Residual risk: users may still need a short habituation period.

## Risk 5 — ACL drift across purchasing/customers/attachments

- Severity: High
- Impact: users see unexpected `feature denied` states.
- Mitigation: update `setup.ts`, default role features, and integration tests to cover role matrices.
- Residual risk: tenant-level manual ACL overrides can still break environments.

# Open Questions

- Should request creation always require linking to an existing company, or can it create a lightweight company draft?
- Should request submitter always equal sales owner, or do these remain separate concepts?
- Do we want a temporary fallback “manual line item without catalog product” for edge cases, or do we require catalog-only selection from this iteration onward?
- What exact status colors does business want for each request/item status?
- What final request numbering format does the client want?

# Final Compliance Report

- Uses native OM modules instead of extending purchasing with duplicate product infrastructure.
- Preserves backward compatibility by favoring additive fields and best-effort migration.
- Follows OM guidance for integrations, data sync, notifications, attachments, and widget/tab patterns.
- Defines concrete API/UI/test scope for a multi-module refactor.
- Removes the purchasing-specific CSV import path from the target architecture.

# Changelog

- 2026-03-14: Created second-iteration purchasing spec aligned to native Open Mercato catalog, companies, notifications, attachments, tabbed detail view, and activity history.
