# Git Conventions

Stack-agnostic Git workflow — applies to every project regardless of stack.

## Branch Naming

```
feature/{short-description}    # feature/user-authentication
bugfix/{short-description}     # bugfix/login-redirect-loop
hotfix/{short-description}     # hotfix/payment-crash
refactor/{short-description}   # refactor/user-service-cleanup
chore/{short-description}      # chore/update-dependencies
```

## Commit Messages — Conventional Commits

```
feat: add two-factor authentication for users
fix: resolve session expiry redirect loop
refactor: extract payment logic into PaymentService
test: add unit tests for OrderService
chore: update Laravel to 11.x
docs: add API authentication documentation
```

Rules:
- Present tense, imperative mood ("add", not "added" or "adding").
- Max 72 characters in the subject line.
- Reference the ticket/issue in the commit body if applicable.

## Workflow

1. Always branch from `main` (or `develop` if the project uses it).
2. One logical change per commit — keep commits atomic.
3. Only commit code where tests pass.
4. Never commit `.env`, secrets, or compiled assets (`public/build/`, `node_modules/`).
