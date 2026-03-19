# Copilot Bot — Personal AI Assistant on Telegram

Bot Telegram personnel connecte a Claude AI et Supabase. Il organise tes taches, tes clients, ta memoire, et te pousse a avancer avec des notifications intelligentes.

## Fonctionnalites

- **Orchestrateur IA** : envoie un message libre, le bot comprend et agit (cree des taches, des clients, prend des notes)
- **Plan du jour** : `/plan` genere un plan AI priorise
- **Taches** : `/tasks`, `/next`, `/done`, `/add`, `/skip`
- **Clients** : `/clients`, `/newclient`, `/client [nom]`
- **Notifications intelligentes** : planification AI + dispatch automatique (`/notifs`, `/replan`)
- **Memoire 3 tiers** : le bot apprend et se souvient (core/working/archival)
- **Agent de recherche** : recherche approfondie sur un sujet via conversation
- **Crons** : consolidation memoire, nettoyage zombies, plan quotidien, dispatch notifications

## Prerequis

- [Node.js 20+](https://nodejs.org)
- Un compte [Supabase](https://supabase.com) (free tier suffit)
- Une cle API [Anthropic](https://console.anthropic.com) (Claude)
- Un bot Telegram (via [@BotFather](https://t.me/BotFather))

## Installation

### 1. Cloner et installer

```bash
git clone <url-du-repo>
cd copilot-bot
npm install
```

### 2. Configurer Supabase

1. Cree un projet sur [supabase.com](https://supabase.com)
2. Va dans **SQL Editor**
3. Colle le contenu de `schema.sql` et execute

### 3. Creer le bot Telegram

1. Ouvre Telegram et cherche [@BotFather](https://t.me/BotFather)
2. Envoie `/newbot` et suis les instructions
3. Copie le token
4. Pour obtenir ton chat ID, envoie `/start` a [@userinfobot](https://t.me/userinfobot)

### 4. Variables d'environnement

```bash
cp .env.example .env
```

Remplis les valeurs dans `.env` :

| Variable | Description |
|---|---|
| `SUPABASE_URL` | URL de ton projet Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Cle service role (Settings > API) |
| `ANTHROPIC_API_KEY` | Cle API Claude |
| `TELEGRAM_BOT_TOKEN` | Token du bot (@BotFather) |
| `TELEGRAM_ADMIN_CHAT_ID` | Ton chat ID Telegram |
| `OWNER_NAME` | Ton prenom (utilise dans les prompts AI) |

### 5. Lancer

```bash
# Dev (avec hot reload)
npm run dev

# Production
npm run build
npm start
```

## Deploiement (Railway)

1. Pousse ton code sur GitHub
2. Cree un projet sur [railway.app](https://railway.app)
3. Connecte ton repo GitHub
4. Ajoute les variables d'environnement (Settings > Variables)
5. Railway detecte automatiquement le Dockerfile

Cout : ~5 EUR/mois.

## Deploiement (Docker)

```bash
docker build -t copilot-bot .
docker run --env-file .env copilot-bot
```

## Cout mensuel estime

| Service | Cout |
|---|---|
| Supabase (free tier) | 0 EUR |
| Railway / Render / Fly.io | ~5 EUR |
| Claude API (selon usage) | ~5-20 EUR |
| **Total** | **~10-25 EUR** |

## Architecture

```
src/
  index.ts              <- entry point (grammy polling)
  config.ts             <- owner name, bot name, timezone
  logger.ts             <- pino logger
  types/                <- TypeScript types
  db/                   <- Supabase queries (tasks, clients, memory, reminders)
  ai/                   <- Claude API (orchestrator, planner, memory, research)
  scheduler/            <- node-cron job manager
  commands/             <- /plan, /tasks, /clients, /notifs
  handlers/             <- free-text message handler
  cron/                 <- notification dispatch, daily plan
  utils/                <- auth, format, conversation history
```
