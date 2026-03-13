# TLDR

Ten dokument opisuje, jak przenieść i uruchomić moduł `purchasing` z brancha `feat/handling-purchasing` na innym repo lub innym środowisku Open Mercato.

Aktualny commit referencyjny:

- `d1e2ad6d` — `Add purchasing POC module and UX flow`

Najprostsza ścieżka:

1. przenieś commit `d1e2ad6d`,
2. uruchom build/generatory/migracje,
3. uruchom seed tenantu,
4. opcjonalnie zaimportuj produkty klienta z CSV,
5. uruchom app i wykonaj sanity check.

# Cel dokumentu

Ten runbook ma umożliwić szybkie odpalenie `purchasing` na innym Open Mercato bez szukania wiedzy po commitach, specach i rozmowach roboczych.

Dokument obejmuje:

- przeniesienie zmian,
- wymagane komendy,
- seed użytkowników i uprawnień,
- import produktów klienta,
- ręczną weryfikację UI/API,
- najczęstsze problemy lokalne.

Nie obejmuje:

- rolloutów produkcyjnych z blue/green,
- CI/CD,
- integracji ERP,
- polityk backupu i disaster recovery.

# Zakres zmiany

Commit `d1e2ad6d` zawiera:

- pełny moduł `apps/mercato/src/modules/purchasing`
- migracje modułu
- API requestów, itemów, komentarzy, produktów i assignee
- backend pages:
  - lista requestów
  - create request
  - detail/edit request
  - operational items view
  - products browser
- ACL i setup seed dla `purchasing`
- importer CSV produktów klienta
- wyszukiwanie i notyfikacje statusowe
- testy integracyjne modułu
- niezbędne poprawki toolingu i runtime:
  - `packages/cli`
  - `packages/core/src/modules/auth/frontend/login.tsx`
  - `packages/core/src/modules/auth/services/rbacService.ts`
  - `packages/shared/src/lib/db/mikro.ts`

Poza commitem zostały świadomie lokalne pliki niezwiązane z featurem:

- `apps/mercato/src/modules/example/migrations/.snapshot-open-mercato.json`
- `data/cache.db`

# Wymagania wstępne

Zakładamy, że docelowy Open Mercato ma:

- działający Node/Yarn zgodny z repo
- dostępny Postgres
- działający Redis, jeśli dany setup go wymaga
- poprawny `.env`
- możliwość uruchomienia:
  - `yarn build:packages`
  - `yarn generate`
  - `yarn db:migrate`
  - `yarn dev:app`

Jeśli to świeże środowisko developerskie, najpierw wykonaj standardowy setup repo.

# Szybka ścieżka przeniesienia

## Opcja A — cherry-pick jednego commita

Jeśli pracujesz w innym klonie tego samego repo:

```bash
git fetch origin
git cherry-pick d1e2ad6d
```

Użyj tej opcji, jeśli chcesz przenieść dokładnie stan feature’a bez merge całego brancha.

## Opcja B — merge / rebase brancha

Jeśli pracujesz bezpośrednio na branchu feature:

```bash
git fetch origin
git checkout feat/handling-purchasing
git pull --ff-only
```

Jeśli chcesz przenieść całość do innego brancha:

```bash
git checkout <target-branch>
git merge feat/handling-purchasing
```

## Opcja C — patch/export

Jeśli nie możesz użyć bezpośrednio zdalnego brancha:

```bash
git format-patch -1 d1e2ad6d
git am 0001-Add-purchasing-POC-module-and-UX-flow.patch
```

# Pliki, które muszą trafić razem

Jeśli z jakiegoś powodu przenosisz zmiany ręcznie, zakres minimalny to:

- [apps/mercato/src/modules.ts](/Users/dawid/Projects/rekru/open-mercato/apps/mercato/src/modules.ts)
- [apps/mercato/src/modules/purchasing](/Users/dawid/Projects/rekru/open-mercato/apps/mercato/src/modules/purchasing)
- [packages/cli/build.mjs](/Users/dawid/Projects/rekru/open-mercato/packages/cli/build.mjs)
- [packages/cli/package.json](/Users/dawid/Projects/rekru/open-mercato/packages/cli/package.json)
- [packages/cli/src/lib/db/commands.ts](/Users/dawid/Projects/rekru/open-mercato/packages/cli/src/lib/db/commands.ts)
- [packages/core/src/modules/auth/frontend/login.tsx](/Users/dawid/Projects/rekru/open-mercato/packages/core/src/modules/auth/frontend/login.tsx)
- [packages/core/src/modules/auth/services/rbacService.ts](/Users/dawid/Projects/rekru/open-mercato/packages/core/src/modules/auth/services/rbacService.ts)
- [packages/shared/src/lib/db/mikro.ts](/Users/dawid/Projects/rekru/open-mercato/packages/shared/src/lib/db/mikro.ts)
- [packages/shared/src/lib/db/__tests__/mikro.test.ts](/Users/dawid/Projects/rekru/open-mercato/packages/shared/src/lib/db/__tests__/mikro.test.ts)
- [apps/mercato/.env.example](/Users/dawid/Projects/rekru/open-mercato/apps/mercato/.env.example)
- [SPEC-058-2026-03-13-purchasing-requests-poc.md](/Users/dawid/Projects/rekru/open-mercato/.ai/specs/SPEC-058-2026-03-13-purchasing-requests-poc.md)

Przenoszenie tylko folderu `purchasing` bez tych zmian pomocniczych może skończyć się:

- problemem z migracjami `@app` modules,
- problemem z generated imports,
- problemem z login redirectem,
- problemem z poolowaniem połączeń DB i `too many clients already`.

# Komendy po przeniesieniu

Po wdrożeniu commita uruchom dokładnie tę sekwencję:

```bash
yarn install
yarn build:packages
yarn generate
yarn db:migrate
yarn workspace @open-mercato/app typecheck
```

Jeśli środowisko jest świeże albo baza nie była inicjalizowana:

```bash
yarn initialize
```

Uwaga:

- `yarn initialize` może nadpisać lub dosiać lokalne dane demo, więc nie używaj go bezrefleksyjnie na środowisku współdzielonym.

# Co dokładnie robi każdy krok

## 1. `yarn build:packages`

Buduje paczki, w tym poprawiony `cli`. Ten krok jest ważny, bo wcześniejszy problem z generatorami wynikał z rozjazdu między kodem źródłowym a zbudowanym CLI.

## 2. `yarn generate`

Rejestruje:

- moduł `purchasing`
- strony backendowe
- API routes
- encje i registry
- generated files używane przez app bootstrap

## 3. `yarn db:migrate`

Wykonuje migracje modułu `purchasing`, w tym:

- tworzenie tabel requestów
- tworzenie tabel itemów
- tworzenie tabel komentarzy
- snapshot migracyjny modułu

## 4. `yarn workspace @open-mercato/app typecheck`

Weryfikuje, że integracja modułu i wspierające poprawki nie łamią typu aplikacji.

# Seed użytkowników i uprawnień

Moduł ma `setup.ts`, który dosiewa przykładowych zakupowców i przypisuje im właściwe ACL.

Plik:

- [setup.ts](/Users/dawid/Projects/rekru/open-mercato/apps/mercato/src/modules/purchasing/setup.ts)

Seed tworzy użytkowników:

- `purchasing.anna@acme.com`
- `purchasing.marek@acme.com`
- `purchasing.julia@acme.com`

Hasło:

- `secret`

Setup nadaje im:

- rolę `employee`
- `attachments.view`
- `attachments.manage`
- `purchasing.requests.view`
- `purchasing.requests.create`
- `purchasing.requests.update`
- `purchasing.requests.assign`
- `purchasing.items.view`
- `purchasing.items.update`
- `purchasing.comments.view`
- `purchasing.comments.manage`

Domyślne role dostają:

- `superadmin`: `purchasing.*`
- `admin`: `purchasing.*`
- `employee`: pełny zestaw POC dla `purchasing`

## Kiedy seed zadziała

Seed działa przy tenant setup/initialize. Jeśli środowisko już istnieje, samo przeniesienie commita nie musi automatycznie przepchnąć nowych ACL do wcześniej istniejących `user_acls`.

W takim przypadku:

- zalecane jest ponowne uruchomienie odpowiedniego procesu inicjalizacji tenantu, albo
- ręczne sprawdzenie `role_acls` i `user_acls`

Jeśli po wdrożeniu dalej coś jest `disabled` mimo poprawnej roli, problemem zwykle jest:

- stary `user_acl` override,
- cache RBAC w procesie,
- aktywna sesja użytkownika z poprzedniego stanu.

Minimalna procedura odświeżenia:

1. restart `yarn dev:app`
2. wylogowanie
3. ponowne logowanie
4. otwarcie strony w nowej karcie

# Uruchomienie aplikacji

W najbezpieczniejszym wariancie developerskim:

```bash
AUTO_SPAWN_WORKERS=false AUTO_SPAWN_SCHEDULER=false yarn dev:app
```

To jest zalecane szczególnie wtedy, gdy docelowe środowisko ma niestabilny bootstrap workerów lub schedulerów.

Jeśli środowisko jest zdrowe, możesz użyć zwykłego:

```bash
yarn dev:app
```

# Import produktów klienta z CSV

Moduł ma własne CLI do importu przykładowych produktów klienta do katalogu.

Plik:

- [cli.ts](/Users/dawid/Projects/rekru/open-mercato/apps/mercato/src/modules/purchasing/cli.ts)

Komenda:

```bash
yarn mercato purchasing import-products-csv --file '/pełna/ścieżka/do/pliku.csv'
```

Jeśli środowisko ma więcej niż jeden `tenant` / `organization`, podaj scope jawnie:

```bash
yarn mercato purchasing import-products-csv \
  --file '/pełna/ścieżka/do/pliku.csv' \
  --tenant <tenantId> \
  --org <organizationId>
```

Aliasy wspierane przez parser:

- `--tenantId` lub `--tenant`
- `--organizationId`, `--org`, `--orgId`

Jeśli w bazie istnieje dokładnie jeden scope `tenant_id + organization_id`, komenda spróbuje ustalić scope automatycznie.

## Przykład z aktualnym plikiem klienta

Aktualny plik wejściowy używany lokalnie:

- `/Users/dawid/Projects/rekru/Przykładowe produkty.csv`

Przykład:

```bash
yarn mercato purchasing import-products-csv --file '/Users/dawid/Projects/rekru/Przykładowe produkty.csv'
```

# Główne ścieżki po uruchomieniu

Po starcie app moduł powinien być dostępny pod:

- `/backend/purchasing/requests`
- `/backend/purchasing/requests/create`
- `/backend/purchasing/request-items`
- `/backend/purchasing/products`

Najważniejsze API:

- `/api/purchasing/requests`
- `/api/purchasing/request-items`
- `/api/purchasing/comments`
- `/api/purchasing/assignees`
- `/api/purchasing/products`

# Minimalny sanity check po wdrożeniu

## 1. Sprawdzenie modułu i tras

Wejdź na:

- `/backend/purchasing/requests`
- `/backend/purchasing/requests/create`

Oczekiwany wynik:

- brak `404`
- brak `500`
- widoczny listing / formularz

## 2. Sprawdzenie tworzenia requestu

Na ekranie create:

1. wpisz `Customer name`
2. opcjonalnie wpisz `Customer NIP`
3. wybierz zakupowca
4. dodaj przynajmniej jeden produkt
5. zapisz request

Oczekiwany wynik:

- request zapisuje się bez `500`
- detail requestu otwiera się poprawnie
- wybrane produkty są widoczne w sekcji itemów

## 3. Sprawdzenie workflow requestu

Na detail page:

1. zmień `Request status`
2. zmień `Purchasing owner`
3. zapisz workflow

Oczekiwany wynik:

- selecty są aktywne
- zapis przechodzi
- status badge aktualizuje się

## 4. Sprawdzenie request items

Wejdź na:

- `/backend/purchasing/request-items`

Oczekiwany wynik:

- widoczna tabela pozycji
- działają filtry:
  - `search`
  - `status`
  - `SKU`
  - `reference number`

## 5. Sprawdzenie attachments

Na create lub detail:

1. otwórz sekcję request attachments
2. dodaj plik

Oczekiwany wynik:

- brak `403` dla `attachments.view`
- plik widoczny na poziomie requestu

## 6. Sprawdzenie komentarzy

Na detail:

1. dodaj komentarz

Oczekiwany wynik:

- komentarz zapisuje się
- sekcja comments nie pokazuje już attachments per comment

## 7. Sprawdzenie produktów

Wejdź na:

- `/backend/purchasing/products`

Oczekiwany wynik:

- działa search
- działają filtry po dostawcy, grupie i dostępności

# Typowe problemy i naprawa

## Problem: `relation "purchasing_requests" does not exist`

Przyczyna:

- migracje nie zostały wykonane

Naprawa:

```bash
yarn db:migrate
```

## Problem: `You don't have access to this feature (attachments.view)`

Przyczyna:

- stary `user_acl` override
- brak seedów ACL
- cache RBAC w procesie

Naprawa:

1. upewnij się, że użytkownik ma `attachments.view` i `attachments.manage`
2. zrestartuj app
3. wyloguj i zaloguj się ponownie

## Problem: `Request status` / `Purchasing owner` są disabled

Przyczyna:

- brak `purchasing.requests.update` albo `purchasing.requests.assign`
- override na `user_acls`

Naprawa:

upewnij się, że aktywny użytkownik ma:

- `purchasing.requests.update`
- `purchasing.requests.assign`

oraz odśwież sesję po restarcie procesu.

## Problem: `sorry, too many clients already`

Przyczyna:

- zbyt agresywne poolowanie połączeń DB
- zbyt wiele requestowych forków EM w RBAC path

Naprawa:

commit zawiera poprawki w:

- [rbacService.ts](/Users/dawid/Projects/rekru/open-mercato/packages/core/src/modules/auth/services/rbacService.ts)
- [mikro.ts](/Users/dawid/Projects/rekru/open-mercato/packages/shared/src/lib/db/mikro.ts)

Jeśli błąd pojawi się nadal:

1. upewnij się, że wdrożono również te pliki
2. zrestartuj proces app
3. sprawdź, czy lokalne `.env` nie ustawia absurdalnie dużego `DB_POOL_MAX`

## Problem: generator / migracje nie widzą modułu app-level

Przyczyna:

- brak poprawki CLI w `packages/cli`

Naprawa:

upewnij się, że wdrożono:

- [build.mjs](/Users/dawid/Projects/rekru/open-mercato/packages/cli/build.mjs)
- [package.json](/Users/dawid/Projects/rekru/open-mercato/packages/cli/package.json)
- [commands.ts](/Users/dawid/Projects/rekru/open-mercato/packages/cli/src/lib/db/commands.ts)

i że po tym wykonano:

```bash
yarn build:packages
yarn generate
```

# Kolejność rekomendowana na innym Open Mercato

## Wariant developerski

```bash
git cherry-pick d1e2ad6d
yarn install
yarn build:packages
yarn generate
yarn db:migrate
yarn initialize
yarn workspace @open-mercato/app typecheck
AUTO_SPAWN_WORKERS=false AUTO_SPAWN_SCHEDULER=false yarn dev:app
```

## Wariant ostrożny na istniejącym środowisku developerskim

```bash
git cherry-pick d1e2ad6d
yarn install
yarn build:packages
yarn generate
yarn db:migrate
yarn workspace @open-mercato/app typecheck
AUTO_SPAWN_WORKERS=false AUTO_SPAWN_SCHEDULER=false yarn dev:app
```

Potem:

1. zweryfikuj ACL aktywnego użytkownika,
2. opcjonalnie dosiej tenant/setup,
3. opcjonalnie zaimportuj produkty CSV.

# Checklista przekazania do innego zespołu

Przed oddaniem modułu dalej potwierdź:

- commit `d1e2ad6d` został przeniesiony
- `yarn build:packages` przeszło
- `yarn generate` przeszło
- `yarn db:migrate` przeszło
- `yarn workspace @open-mercato/app typecheck` przeszło
- działa `/backend/purchasing/requests`
- działa `/backend/purchasing/requests/create`
- działa `/backend/purchasing/request-items`
- działają attachments na poziomie requestu
- działa import CSV produktów
- seedowi zakupowcy są widoczni na liście assignee

# Powiązane dokumenty

- [SPEC-058-2026-03-13-purchasing-requests-poc.md](/Users/dawid/Projects/rekru/open-mercato/.ai/specs/SPEC-058-2026-03-13-purchasing-requests-poc.md)

# Changelog

## 2026-03-13

- dodano runbook wdrożeniowy i operacyjny dla modułu `purchasing`
- opisano commit referencyjny, kolejność komend, sanity check i typowe problemy
