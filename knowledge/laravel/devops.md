# DevOps: Docker + CI/CD + GCP Server Deployment

Полный чеклист для деплоя Laravel проекта на Google Cloud с Docker и GitHub CI/CD.
Референс: video-ai, marketing-ai — идентичная архитектура.

---

## Phase 1: Docker Production Config

Создать `docker/prod/` с файлами:

- [ ] `Dockerfile` — multi-stage build (php_builder → node_builder → final)
  - php_builder: PHP extensions, composer install
  - node_builder: FROM php_builder (нужен если проект использует Wayfinder — artisan вызывается при vite build)
  - final: alpine + runtime deps + nginx + supervisor
  - **Важно**: создать dummy `.env` с APP_KEY в node_builder для artisan
  - **Важно**: COPY path для build assets должен совпадать с WORKDIR node_builder стейджа
- [ ] `docker-compose.yml` — app (nginx+php-fpm), db (mysql:8.0), redis, queue-worker
  - Образы из GHCR: `ghcr.io/niksib/PROJECT_NAME/app:latest`
  - Volumes: .env, google-keys json, app-storage, nginx config, certbot
  - Порты DB/Redis НЕ пробрасывать наружу (только внутри docker network)
- [ ] `docker-entrypoint.sh` — создаёт Laravel директории, фиксит права, запускает nginx + php-fpm
- [ ] `php-custom.ini` — production PHP настройки + `expose_php=Off`
- [ ] `nginx/default.conf` — начать с HTTP-only, SSL добавить когда будет домен
  - **Gotcha**: не использовать `${DOMAIN}` переменную — nginx не резолвит, использовать реальный домен
- [ ] `supervisor/laravel-worker.conf` — queue workers по очередям проекта + scheduler
- [ ] `.dockerignore` — .git, node_modules, vendor, docker/dev, .env и т.д.

---

## Phase 2: GitHub CI/CD

Создать `.github/workflows/deploy.yml` с 3 jobs:

- [ ] **build** — checkout, buildx, login GHCR, build+push image (:latest и :sha)
- [ ] **test** — `php artisan test` в собранном образе с MySQL + Redis services
- [ ] **deploy** — auth GCP, SSH через IAP, pull image, docker compose up, artisan migrate/cache

Версии actions (актуальны на 2026-03):
- `actions/checkout@v5`
- `docker/setup-buildx-action@v4`
- `docker/login-action@v4`
- `docker/build-push-action@v6`
- `google-github-actions/auth@v3`
- `google-github-actions/ssh-compute@v2`

**Gotcha**: использовать `docker image prune -f` вместо `docker system prune -a -f` чтобы не удалять кешированные базовые образы.

---

## Phase 3: GCP Server Setup

- [ ] Создать VM (Compute Engine) — Ubuntu 24.04 LTS, **x86/64 (amd64)**
- [ ] Включить HTTP + HTTPS firewall (network tags: `http-server`, `https-server`)
- [ ] Зарезервировать **статический внешний IP** (Ephemeral может измениться)
- [ ] Установить Docker через официальный репозиторий (НЕ `docker.io` из apt):
  ```bash
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt update
  sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin git
  ```
- [ ] Склонировать репо через SSH (сгенерировать deploy key, добавить в GitHub Deploy Keys)
  - **Gotcha**: `sudo git clone` использует root SSH ключи. Клонировать без sudo, потом `sudo mv`
- [ ] Создать GCP Service Account (IAM → Service Accounts) с ролями:
  - Compute Instance Admin
  - Service Account User
  - IAP-Secured Tunnel User
  - Скачать JSON ключ

---

## Phase 4: GitHub Secrets

Repository → Settings → Secrets and Variables → Actions:

- [ ] `GOOGLE_API_JSON` — service account JSON
- [ ] `SSH_PRIVATE_KEY` — сгенерированный SSH ключ для IAP tunnel
- [ ] `PROD_ENV` — полный production .env
- [ ] `GCE_INSTANCE_NAME` — имя VM инстанса
- [ ] `GCE_ZONE` — зона VM (напр. europe-west1-b)

Создать Environment "production" (Settings → Environments).

---

## Phase 5: Первый Deploy

CI/CD может упасть по таймауту при первом деплое (скачивание MySQL/Redis образов). Сделать вручную:

- [ ] Залогиниться в GHCR на сервере: `echo "PAT" | sudo docker login ghcr.io -u niksib --password-stdin`
- [ ] Pull образы: `sudo docker pull mysql:8.0 && sudo docker pull redis:alpine`
- [ ] Pull app image и тегнуть как latest
- [ ] `sudo docker compose -f docker/prod/docker-compose.yml up -d`
- [ ] Создать `.env` в `docker/prod/` (то же содержимое что в PROD_ENV секрете)
- [ ] Запустить artisan: migrate, config:cache, route:cache, view:cache, storage:link
- [ ] Проверить: `sudo docker compose -f docker/prod/docker-compose.yml ps`
- [ ] После первого ручного деплоя, последующие CI/CD деплои будут работать

---

## Phase 6: Security Checklist

- [ ] Отключить SSH пароль:
  ```bash
  sudo sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
  sudo systemctl restart ssh  # Ubuntu 24.04 — 'ssh', не 'sshd'
  ```
- [ ] fail2ban: `sudo apt install -y fail2ban && sudo systemctl enable fail2ban`
- [ ] Автообновления: `sudo apt install -y unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades`
- [ ] `expose_php=Off` в php-custom.ini (скрывает X-Powered-By)
- [ ] Nginx блокирует dotfiles: `location ~ /\.(?!well-known).* { deny all; }`
- [ ] MySQL/Redis порты НЕ проброшены наружу
- [ ] Environment protection rules на GitHub (опционально: required reviewers)

### Проверка безопасности

```bash
# SSH пароль отключён?
ssh -o PasswordAuthentication=yes user@IP  # Должно: Permission denied (publickey)

# Открытые порты
nmap -p 22,80,443 IP  # Должно: только 22, 80 (443 когда SSL)

# Скрытые файлы заблокированы?
curl http://IP/.env        # Должно: 403
curl http://IP/.git/config # Должно: 403

# PHP версия скрыта?
curl -I http://IP  # НЕ должно быть X-Powered-By

# fail2ban работает?
sudo fail2ban-client status sshd
```

---

## Phase 7: Домен + SSL

- [ ] Добавить A запись: домен → внешний IP
- [ ] Установить certbot: `sudo apt install -y certbot`
- [ ] Получить сертификат: `sudo certbot certonly --standalone -d DOMAIN`
- [ ] Обновить nginx/default.conf с SSL блоком (использовать реальный домен, не переменные)
- [ ] Добавить certbot volumes в docker-compose.yml
- [ ] Настроить auto-renewal cron

---

## Локальный доступ к серверу

```bash
brew install google-cloud-sdk
gcloud auth login
gcloud config set project PROJECT_ID
gcloud compute ssh INSTANCE_NAME --zone=ZONE
```

Несколько GCP аккаунтов — использовать конфигурации:
```bash
gcloud config configurations create project-name
gcloud auth login
gcloud config set project PROJECT_ID
# Переключение: gcloud config configurations activate project-name
```

---

## UI Verification in Worktree Mode

Multiple tasks may run `ui_verification` concurrently in separate worktrees. To avoid port conflicts and data collisions:

- **Pick a free port dynamically** — never hardcode the app's default port. Use a helper such as `php -r "echo (int)shell_exec('comm -23 <(seq 8000 9000 | sort) <(ss -Htan | awk \"{print \$4}\" | cut -d: -f2 | sort) | head -1');"` or any OS-level free-port finder.
- **Use an isolated data directory** — point `APP_STORAGE_PATH` (or equivalent) at a path scoped to the worktree (e.g. the worktree root's `storage/`), not a shared location.
- **Stop only the server you started** — record the PID when you start the dev server and kill that PID when verification finishes. Never run `pkill php`, `pkill artisan`, or any broad process kill that would terminate other tasks' servers.
