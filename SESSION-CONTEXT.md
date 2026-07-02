# Session context — 2026-07-02: рождение ai-developer-v2

Этот файл — конспект сессии, в которой родился этот репозиторий. Прочитай его целиком,
и ты в курсе всего: зачем продукт существует, какие решения приняты и почему, что уже
сделано и что дальше. Технические детали дизайна — в `HARNESS.md`, `GATES.md`, `README.md`;
здесь — контекст и мотивация, которых в них нет.

---

## 1. Откуда всё пришло

Исходно существовал **agent-command-center** (`~/Projects/agent-command-center`) — «Jira-доска
для AI-агентов»: NestJS-бэкенд + Nuxt-фронт, задачи в UI, агент (этот самый ai-developer)
запускался бэкендом headless (`claude -p`), общался с UI через task-orchestrator MCP,
работал в git worktree. Боль: даже маленькая задача шла очень долго и сжирала огромную
долю 5-часового usage-лимита подписки.

Сессия началась с запроса «свежий взгляд на проект как идею и технически».

## 2. Оценка рынка (июль 2026) — почему НЕ облачный SaaS

- Категория «тикет → агент в фоне → PR» стала мейнстримом: GitHub Copilot coding agent,
  OpenAI Codex Cloud, Cursor Background Agents, Google Jules (бесплатно до 15 задач/день),
  Claude Code Remote Tasks (март 2026).
- **Linear сам стал доской для агентов** (Cursor/Copilot/Codex/Devin — нативные ассайни).
  Вторая доска никому не нужна; конкурировать с трекерами на их поле — проигрыш.
- **Cyrus** (github.com/cyrusagents/cyrus) — open-source «Claude Code как Linear-агент,
  worktree на issue» — уже существует и бесплатен.
- **Биллинг Anthropic с 2026-06-15**: headless/`claude -p`/Agent-SDK выведены из flat
  Max-подписки в metered-пул. Арбитраж «подписка → перепродажа фоновых агентов» мёртв.
  НО: **интерактивный Claude Code на Max остался flat** — это фундамент нового продукта.

## 3. Продуктовое решение (главный вывод сессии)

**Продаём агента + харнесс как сетап для нативного Claude Code.** Клиент сидит на своей
Max-подписке ($100–200, интерактив = flat), открывает чат, даёт задачу — агент делает.
Никакого нашего UI/MCP/сервера.

Модель против «его же скопируют» (промпты — плейнтекст, DRM невозможен и не нужен):
- **Продаётся поток, не артефакт**: подписка = актуальность под свежие модели/Claude Code,
  растущий реестр гейтов (ratchet как сетевой эффект: дефект у одного клиента → гейт у всех),
  stack-паки, эвалы под каждый релиз модели.
- Прецеденты: Tailwind Plus, Laravel Nova, ShipFast, JetBrains perpetual-fallback.
  Пиратство — налог, не смерть; платят профессионалы и компании (комплаенс).
- **Канал**: Claude Code plugin + приватный marketplace-git-репо. Подписка = доступ к репо;
  отмена = остаёшься с последней версией (perpetual fallback), поток обновлений прекращается.
- **Moat** = харнесс (детерминированные гейты, verdict-маркеры, ratchet, измеренные
  context-levers) + скорость обновлений + эвалы. НЕ секретность.
- Позже для защитимости: маленький hosted-«фид» (реестр гейтов + результаты эвалов по
  свежим моделям) — единственное некопируемое. Не UI, не рантайм.
- Sales-ассет: эвалы «одна задача: vanilla Claude Code vs с харнессом — escaped defects».

**Выброшено сознательно**: command-center (UI/бэкенд), gemini-developer (двойной maintenance
навсегда — Claude-only для v1), task-orchestrator MCP, pipeline.json.

## 4. Решение боли «мелочь жрёт подписку»

Диагноз: пайплайн не масштабировался вниз — 6 фаз + обязательный Opus-review + полный
прогон сьюта на каждый Stop-attempt + полное ре-ревью после любого коммита. Для S-задачи
харнесс-оверхед был 80–90% стоимости.

Формула v2: **свободный маршрут + дешёвые проверки + жёсткая граница.**
- **Роутер S/M/L** в lifecycle-скилле — агент сам выбирает маршрут (это заменило жёсткий
  пайплайн), но гейты на выходе общие. Анти-читинг: заявка `tier: S` валидируется чекером
  против фактического диффа (≤2 prod-файлов / ≤40 строк) — ошибка триажа стоит один
  bounced stop, не пропущенный дефект. Эскалация только вверх.
- **Кэш зелёного прохода** по хэшу рабочего дерева (throwaway git index → write-tree):
  Stop-retry без правок = мгновенный exit 0. Doctor-baseline ходит через тот же кэш.
- **Дельта-ревью**: протухший вердикт чинится ревью `git diff <verdict-head>..HEAD` +
  прошлый отчёт (carry-forward нетронутых PASS), не с нуля.
- **Fast lane для S**: `make check-fast` / `testAffected` (по умолчанию null — fail-safe,
  включать когда доверяешь change-detection).
- **Не тронуто**: принцип «выход только зелёный», fail-closed чекер, attempt cap +
  эскалация, PreCompact guard, Lever B. Это и есть продукт.

## 5. Судьба read-budget (важное ritual-решение)

PreToolUse-хук read-budget.mjs **retired** (см. GATES.md, строка с RETIRED 2026-07-02):
пользователь делал его, чтобы видеть/ограничить токены под headless `claude -p`; нативно
видимость даёт `/context`, доказанный ~2× выигрыш дал Lever B (компакция 281k→139k,
CONTEXT-BUDGET.md B2), а роутер убрал full-pipeline прогоны мелочи. Плюс хук был хрупким
(парсинг транскриптов) и его отказы видимы пользователю — плохо для клиентского продукта.
Принцип «dispatcher, not a reader» остался инструкцией в скилле. Если на L-маршрутах
раздувание вернётся — реинстейт из git-истории как осознанный ratchet.

## 6. Что физически сделано (все коммиты этого репо)

```
12efec7 chore: import ai-developer agent from agent-command-center
28426a4 feat: native standalone mode with S/M/L triage router
a5ef141 feat(gate): tier-aware checker with green tree-hash cache and delta re-review
64ebf1e chore(gates): retire read-budget deliberately; fix precompact guard for native mode
4a42f53 docs: update HARNESS.md for v2 and add README
5a12afd docs(evals): rewrite README for the native runner and brain-model strategies
```

Проверено: `node scripts/checker.test.mjs` (10 pass), `node scripts/precompact-guard.test.mjs`
(10 pass), сквозной смоук tier-гейта и кэша на scratch-репо (6 сценариев: S-over-caps
bounce, M-без-тестов bounce, M-с-тестом pass, cached pass, cache-invalidation, S-в-капах
pass без тестов).

Попутно найденные и закрытые баги:
- **precompact-guard был молча выключен в нативном режиме** (no-op без
  AI_DEV_TASK_ARTIFACTS_DIR, который ставил только оркестратор) → дефолт `./.agent-task`,
  no-op пока директории нет (нет задачи в полёте).
- **`npx tsc` в stacks/nestjs** — класс «registry decoy» (npx без локального typescript
  тянет пакет-самозванца из реестра; уже кусало в command-center) → `npx --no-install`,
  зарегистрировано гейтом в GATES.md.

## 7. Следующие шаги (в порядке ценности)

1. **Упаковка в Claude Code plugin** (skills+hooks+agents+marketplace.json) — это и
   дистрибуция, и механика подписки (приватный marketplace-репо). Открытый вопрос:
   личность из CLAUDE.md переупаковать в agent-определение/скилл (плагин не подменяет
   CLAUDE.md пользователя).
2. **Per-tier эвал-фикстуры** (S-копейка / M-фича / L-рефактор), чтобы мерить сам роутер
   и капы; затем `sonnet-brain` vs `opus-brain` на S/M — какой самый дешёвый мозг держит
   качество.
3. **A/B «vanilla vs harness»** — headline-число для продаж (escaped-defect delta).
4. Включить `testAffected` в стеках после проверки change-detection; doctor-скаффолд
   `check-fast`.
5. Лицензия (source-available, запрет редистрибуции), тиры (individual / team / enterprise).
6. Позже: hosted-фид гейтов/эвалов; Linear/GitHub-интеграция как канал дистрибуции
   (вариант B из обсуждения) — НЕ своя доска.

## 8. Мелкие факты, чтобы не спотыкаться

- Исходный репо: `~/Projects/agent-command-center`, папка `agents/ai-developer` — там v1
  нетронута (импорт был копией рабочего дерева). В git-истории ТОГО репо живут удалённые
  здесь read-budget.mjs / context-report.mjs / pipeline.json / backend-раннер эвалов.
- `CONTEXT-BUDGET.md` здесь — исторический лаб-журнал v1, оставлен как есть (обоснование
  Lever B); упоминания task_report_progress/read-budget в нём — история, не актуальность.
- Env-ручки чекера: AI_DEV_TIER_S_MAX_FILES/LINES, AI_DEV_GATE_CACHE=off,
  AI_DEV_CHECK_FAST_CMD — полный список в шапке `scripts/checker.mjs`.
- Пользователь: Mykola (kolyasub124@gmail.com), общение на русском; код/доки — на
  английском. Стеки клиентской базы: Laravel + Nuxt + NestJS.
