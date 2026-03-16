# Memory

## Project
- Monorepo: open-mercato (Next.js, MikroORM, PostgreSQL, Redis, Meilisearch)
- Main app: `apps/mercato`
- Current feature branch: `feat/handling-purchasing`

## Infrastructure — VPS (Hostinger KVM2)
- IP: `187.124.0.124`
- SSH: `root@187.124.0.124`
- OS: Linux, Docker zainstalowany
- Dokploy v0.28.6 zainstalowany i działa na `https://dokploy.omdevs.net`
- Traefik network: `dokploy-network` (overlay swarm)

## Domeny
- Domena: `omdevs.net` (kupiona, nie .com)
- DNS: Cloudflare (nameservery: micah + clarissa.ns.cloudflare.com)
- Cloudflare API Token: `omdevs.net DNS:Edit` — zapisany w Dokploy Traefik env jako `CF_DNS_API_TOKEN`
- Rekordy DNS: `A @ 187.124.0.124`, `A * 187.124.0.124`, `A dokploy 187.124.0.124` — wszystkie DNS only (TTL 300)

## Obecny stan VPS
- Stary stack (`docker-compose.fullapp.yml`) zatrzymany przez `docker compose down`
- Stary stack był w `/root/.openclaw/workspace/open-mercato/` (openclaw workspace)
- Backup bazy: `/root/backup_20260314.sql` (18MB — są prawdziwe dane!)
- Sekrety wygenerowane przez openssl (zapisane przez usera lokalnie)

## Dokploy — produkcja w trakcie konfiguracji
- Projekt: `omdevs`
- Serwis Compose: `omdevs-dev` (nazwa app w Dokploy)
- Compose file: `docker-compose.prod.yml` (w repo) — wklejony jako Raw
- Obraz app: `open-mercato/app:local` (już zbudowany na VPS)
- **TODO**: Uzupełnić Environment Variables w Dokploy, uruchomić deploy, przywrócić backup DB

## Environment Variables do ustawienia w Dokploy
```
TENANT_DATA_ENCRYPTION_FALLBACK_KEY=<wygenerowany>
DATABASE_URL=postgres://postgres:<POSTGRES_PASSWORD>@mercato-postgres-prod:5432/open-mercato
JWT_SECRET=<wygenerowany>
POSTGRES_PASSWORD=<wygenerowany>
MEILISEARCH_MASTER_KEY=<wygenerowany>
ADMIN_EMAIL=dawidposala@gmail.com
OM_INIT_SUPERADMIN_EMAIL=dawidposala@gmail.com
OM_INIT_SUPERADMIN_PASSWORD=<wybrane haslo>
```

## Po deployu — przywróć dane
```bash
# Znajdź nowy kontener postgres
docker ps | grep postgres-prod
# Przywróć backup
docker exec -i mercato-postgres-prod psql -U postgres open-mercato < /root/backup_20260314.sql
```

## CI/CD — preview environments (w trakcie projektowania)
- Workflow `preview-deploy.yml` — auto deploy per PR z labelem `preview-env` do `develop`
- Workflow `preview-cleanup.yml` — cleanup na PR close
- Compose: `docker-compose.preview-env.yaml` — full stack per PR
- GitHub secrets potrzebne: `DOKPLOY_URL`, `DOKPLOY_API_KEY`, `DOKPLOY_PROJECT_ID`, `PREVIEW_BASE_DOMAIN=preview.omdevs.net`, `PREVIEW_JWT_SECRET`, `PREVIEW_POSTGRES_PASSWORD`

## Pliki dodane do repo
- `docker-compose.prod.yml` — produkcja dla Dokploy
- `docker-compose.preview-env.yaml` — preview per PR
- `.github/workflows/preview-deploy.yml`
- `.github/workflows/preview-cleanup.yml`

## Ważne uwagi
- Stary kod miał workaroundy dla HTTP: `COOKIE_SECURE=false`, `APP_URL=http://IP:3000` — teraz ustawiamy `COOKIE_SECURE=true` i HTTPS
- JWT_SECRET był domyślnie "JWT" — zmieniony na bezpieczny
- Backup DB jest na VPS — NIE uruchamiać `yarn mercato init` jeśli chcemy zachować dane, tylko przywrócić backup po pierwszym starcie postgres
