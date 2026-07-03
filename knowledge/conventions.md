# Conventions — Naming, Git, Database, API, Code Quality

Stack-independent conventions that apply to every project. Stack-specific naming tables and rules live in `stacks/<stack>/conventions.md` — read the overlay for each folder you touch.

---

## Variable Naming — Strictly Enforced

**Forbidden — these are rejected without exception:**
- Single letters: `$a`, `$b`, `$e` (except `$i`, `$j`, `$k` in simple loops)
- Two-letter abbreviations: `$ft`, `$sm`, `$dt`, `$rp`, `$mg`, `$cb`
- Unclear context: `$data`, `$result`, `$item`, `$obj`, `$temp`
- Frontend: `data`, `res`, `err`, `cb`, `fn`, `val`

**Required — always use full, self-documenting names:**
```php
// PHP
$user                    // not $u
$userRepository          // not $repo or $ur
$createUserDTO           // not $dto or $d
$orderService            // not $svc or $s
$totalAmount             // not $total or $amt
$createdAt               // not $date or $dt
$userNotFoundException   // not $e or $ex
```

```typescript
// TypeScript
const currentUser        // not u
const userService        // not svc
const isLoading          // not loading (too vague in complex components)
const fetchUser          // not fetch
const caughtError        // not e or err
```

---

## Git Workflow

### Branch Naming
```
feature/{short-description}    # feature/user-authentication
bugfix/{short-description}     # bugfix/login-redirect-loop
hotfix/{short-description}     # hotfix/payment-crash
refactor/{short-description}   # refactor/user-service-cleanup
chore/{short-description}      # chore/update-dependencies
```

### Commit Messages — Conventional Commits
```
feat: add two-factor authentication for users
fix: resolve session expiry redirect loop
refactor: extract payment logic into PaymentService
test: add unit tests for OrderService
chore: update Laravel to 11.x
docs: add API authentication documentation
```

Rules:
- Present tense, imperative mood ("add", not "added" or "adding")
- Max 72 characters in the subject line
- Reference ticket/issue in commit body if applicable

### Workflow
1. Always branch from `main` (or `develop` if the project uses it)
2. One logical change per commit — keep commits atomic
3. Only commit code where tests pass
4. Never commit `.env`, secrets, or compiled assets (`public/build/`, `node_modules/`)

---

## Database Standards

- **Table names:** plural `snake_case` — `user_profiles`, `order_items`, `payment_transactions`
- **Primary key:** `id` (auto-increment) unless UUID is specified for the project
- **Foreign keys:** `{singular_table_name}_id` — `user_id`, `order_id`, `payment_id`
- **Timestamps:** `created_at` + `updated_at` on every table (no exceptions)
- **Soft deletes:** only when explicitly required — not by default
- **Indexes:**
  - All foreign keys
  - All columns in `WHERE` clauses (frequently queried)
  - All unique constraints
- **Migrations:**
  - One logical change per migration
  - Always implement `down()` for rollback
  - Never modify existing migrations — always create new ones

---

## API Standards (when applicable)

- **RESTful:** `GET /users`, `POST /users`, `PUT /users/{id}`, `DELETE /users/{id}`
- **Versioning:** `/api/v1/...`
- **JSON envelope:**
  ```json
  {
    "data": {},
    "message": "Success",
    "errors": {}
  }
  ```
- **Never return raw ORM models** — always transform through a resource/serializer layer
- **Paginate** all collection endpoints
- **Route groups:**
  - Public API: `/api/v1/...`
  - Admin panel: `/admin/...`

---

## Code Quality Rules

1. **No magic numbers** — extract to named constants or config
2. **Early returns** — avoid deep nesting with guard clauses
3. **Small methods** — if a method exceeds ~20 lines, extract it
4. **Single Responsibility** — one class, one reason to change
5. **Type hints everywhere** — PHP typed properties + return types; TS interfaces on everything
6. **Cache always has TTL** — `Cache::forever()` only with a comment explaining why
7. **No commented-out code** — delete it, Git has history
8. **No `var_dump`, `dd`, `dump`, `console.log`** left in committed code

---

## Self-Review Checklist

Before every commit:
- [ ] No logic in controllers, routes, views, or middlewares
- [ ] Mutations go through Actions — Services are read-only
- [ ] All new classes follow the naming conventions of their stack (`stacks/<stack>/conventions.md`)
- [ ] DTOs used for all data passing between layers
- [ ] Domain exceptions thrown — no generic `Exception` for business logic
- [ ] Every cache call has a TTL — no raw numbers, use constants
- [ ] No short or cryptic variable/method names anywhere
- [ ] TypeScript strict — no `any`, interfaces defined for all shapes
- [ ] Components are single-responsibility
- [ ] Commit message follows Conventional Commits
- [ ] No debug statements left (`dd`, `var_dump`, `console.log`)
