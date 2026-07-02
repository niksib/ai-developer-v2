# Conventions — Naming, Git, Database, API, Code Quality

---

## Naming Conventions

### PHP / Laravel

| Type                 | Pattern                        | Example                              |
|----------------------|--------------------------------|--------------------------------------|
| DTO                  | `{Verb}{Entity}DTO`            | `CreateUserDTO`, `UpdateOrderDTO`    |
| Service              | `{Entity}Service`              | `UserService`, `PaymentService`      |
| Repository Interface | `{Entity}RepositoryInterface`  | `UserRepositoryInterface`            |
| Repository           | `Eloquent{Entity}Repository`   | `EloquentUserRepository`             |
| Event                | `{Entity}{PastTense}`          | `UserCreated`, `OrderPlaced`         |
| Listener             | `{Verb}{Entity}Listener`       | `SendWelcomeEmailListener`           |
| Job                  | `{Verb}{Entity}Job`            | `ProcessPaymentJob`, `SendEmailJob`  |
| Exception            | `{Entity}{Reason}Exception`    | `UserNotFoundException`              |
| Form Request         | `{Verb}{Entity}Request`        | `CreateUserRequest`                  |
| Action               | `{Verb}{Entity}Action`         | `PublishPostAction`                  |
| Controller           | `{Entity}Controller`           | `UserController`                     |
| Resource             | `{Entity}Resource`             | `UserResource`                       |

### TypeScript / Vue (FSD)

| Type              | Pattern              | Example                                        |
|-------------------|----------------------|------------------------------------------------|
| Interface         | `{Entity}`           | `User`, `Order`, `Pagination`                  |
| DTO type          | `{Verb}{Entity}DTO`  | `CreateUserDTO`, `UpdateOrderDTO`              |
| Model composable  | `use{Entity}`        | `useUser`, `useAuth`, `useOrderList`           |
| Feature composable| `use{Verb}{Entity}`  | `useCreateOrder`, `useLoginForm`               |
| Store             | `use{Entity}Store`   | `useAuthStore`, `useCartStore`                 |
| Page file         | kebab-case           | `user-profile.vue`, `order-list.vue`           |
| Component         | PascalCase           | `UserCard.vue`, `OrderTable.vue`               |

### FSD Folder Naming

| Layer / Element      | Pattern        | Example                                      |
|----------------------|----------------|----------------------------------------------|
| Feature slice folder | `kebab-case`   | `auth-login/`, `create-order/`, `add-to-cart/` |
| Entity slice folder  | `kebab-case`   | `user/`, `order/`, `video-post/`             |
| Widget slice folder  | `kebab-case`   | `header/`, `order-feed/`, `user-sidebar/`    |
| Shared UI folder     | `kebab-case`   | `shared/ui/`, `shared/lib/`, `shared/api/`   |
| Public API file      | `index.ts`     | every slice has `index.ts` — only this is imported from outside |
| Internal folders     | fixed names    | `ui/`, `model/`, `api/` inside every slice   |

### Variable Naming — Strictly Enforced

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
- **Always use API Resources** — never return raw Eloquent models
- **Paginate** all collection endpoints
- **Route groups:**
  - Public API: `/api/v1/...`
  - Admin panel: `/admin/...`

---

## Code Quality Rules

1. **PSR-12** — all PHP code follows PSR-12 style (enforced by Laravel Pint)
2. **No magic numbers** — extract to named constants or `config()`
3. **Early returns** — avoid deep nesting with guard clauses
4. **Small methods** — if a method exceeds ~20 lines, extract it
5. **Single Responsibility** — one class, one reason to change
6. **Type hints everywhere** — PHP typed properties + return types; TS interfaces on everything
7. **Cache always has TTL** — `Cache::forever()` only with a comment explaining why
8. **No commented-out code** — delete it, Git has history
9. **No `var_dump`, `dd`, `dump`, `console.log`** left in committed code

---

## Self-Review Checklist

Before every commit:
- [ ] No logic in controllers, routes, views, or middlewares
- [ ] Mutations go through Actions — Services are read-only
- [ ] All new classes follow naming conventions from this file
- [ ] DTOs used for all data passing between layers
- [ ] Repository interface exists and is bound in a ServiceProvider
- [ ] Domain exceptions thrown — no generic `Exception` for business logic
- [ ] Every cache call has a TTL — no raw numbers, use constants
- [ ] No short or cryptic variable/method names anywhere
- [ ] TypeScript strict — no `any`, interfaces defined for all shapes
- [ ] Components are single-responsibility
- [ ] Commit message follows Conventional Commits
- [ ] No debug statements left (`dd`, `var_dump`, `console.log`)
