# Testing — Pest, Feature & Unit Tests

## When to Write Tests
Tests are **mandatory for every task** — not optional, not on request. Follow TDD: write the test first (it should fail), then the implementation (it should pass). The post-impl checker fails a task with `no_tests` if production code changed without an accompanying test, so every change must ship with tests covering the new behavior.

---

## Stack
- **PHP:** [Pest](https://pestphp.com/) — preferred over PHPUnit
- **Frontend:** [Vitest](https://vitest.dev/) + [Vue Test Utils](https://test-utils.vuejs.org/)

---

## PHP Test Structure

```
tests/
├── Feature/          # HTTP-level tests: routes, responses, database state
│   └── {Domain}/     # e.g., tests/Feature/User/CreateUserTest.php
└── Unit/             # Isolated tests: Actions, Services, Repositories, DTOs
    └── {Domain}/     # e.g., tests/Unit/User/CreateUserActionTest.php
```

---

## Feature Test Pattern

Feature tests hit real HTTP endpoints and assert database state, responses, and events.

```php
// tests/Feature/User/CreateUserTest.php
use App\Domain\User\Events\UserCreated;
use Illuminate\Support\Facades\Event;

it('creates a user, returns 201, and dispatches UserCreated event', function () {
    Event::fake([UserCreated::class]);

    $response = $this->postJson('/api/v1/users', [
        'name'                  => 'Jane Doe',
        'email'                 => 'jane@example.com',
        'password'              => 'password123',
        'password_confirmation' => 'password123',
    ]);

    $response
        ->assertCreated()
        ->assertJsonPath('data.email', 'jane@example.com')
        ->assertJsonPath('data.name', 'Jane Doe');

    $this->assertDatabaseHas('users', ['email' => 'jane@example.com']);
    Event::assertDispatched(UserCreated::class);
});

it('returns 422 when email is already taken', function () {
    User::factory()->create(['email' => 'jane@example.com']);

    $response = $this->postJson('/api/v1/users', [
        'name'                  => 'Jane Doe',
        'email'                 => 'jane@example.com',
        'password'              => 'password123',
        'password_confirmation' => 'password123',
    ]);

    $response->assertUnprocessable()
             ->assertJsonValidationErrors(['email']);
});

it('returns 401 for unauthenticated requests to protected routes', function () {
    $this->getJson('/api/v1/users/1')->assertUnauthorized();
});
```

---

## Unit Test Pattern

Unit tests isolate a single class. Test **Actions** for mutations, **Services** for queries.

```php
// tests/Unit/User/CreateUserActionTest.php
use App\Domain\User\Actions\CreateUserAction;
use App\Domain\User\DTOs\CreateUserDTO;
use App\Domain\User\Events\UserCreated;
use App\Domain\User\Repositories\Contracts\UserRepositoryInterface;

it('creates a user and dispatches UserCreated event', function () {
    Event::fake([UserCreated::class]);

    $createUserDTO = new CreateUserDTO(
        name: 'John Doe',
        email: 'john@example.com',
        password: 'password123',
    );

    $createUserAction = app(CreateUserAction::class);
    $user = $createUserAction->execute($createUserDTO);

    expect($user->email)->toBe('john@example.com');
    Event::assertDispatched(UserCreated::class, fn ($event) => $event->user->id === $user->id);
});
```

```php
// tests/Unit/User/UserServiceTest.php — testing queries (Service)
use App\Domain\User\Exceptions\UserNotFoundException;
use App\Domain\User\Repositories\Contracts\UserRepositoryInterface;
use App\Domain\User\Services\UserService;

it('throws UserNotFoundException when user does not exist', function () {
    $userRepository = Mockery::mock(UserRepositoryInterface::class);
    $userRepository
        ->shouldReceive('findById')
        ->with(999)
        ->andReturn(null);

    $userService = new UserService($userRepository);

    expect(fn () => $userService->findById(999))
        ->toThrow(UserNotFoundException::class);
});
```

---

## Pest Helpers & Best Practices

```php
// Use dataset for multiple input scenarios
it('validates required fields', function (string $missingField) {
    $payload = [
        'name'     => 'Jane',
        'email'    => 'jane@example.com',
        'password' => 'password123',
        'password_confirmation' => 'password123',
    ];
    unset($payload[$missingField]);

    $this->postJson('/api/v1/users', $payload)
         ->assertUnprocessable()
         ->assertJsonValidationErrors([$missingField]);

})->with(['name', 'email', 'password']);

// Authentication helper
it('returns user profile for authenticated user', function () {
    $authenticatedUser = User::factory()->create();

    $this->actingAs($authenticatedUser)
         ->getJson('/api/v1/me')
         ->assertOk()
         ->assertJsonPath('data.email', $authenticatedUser->email);
});

// Database refresh between tests — in Pest.php
uses(RefreshDatabase::class)->in('Feature', 'Unit');
```

---

## Running Tests

```bash
# All tests
./vendor/bin/pest

# Specific file
./vendor/bin/pest tests/Feature/User/CreateUserTest.php

# Filter by test name
./vendor/bin/pest --filter="creates a user"

# With coverage
./vendor/bin/pest --coverage

# Only failed tests from last run
./vendor/bin/pest --retry
```

---

## Frontend Tests (Vitest + FSD)

Tests live **co-located** with the slice they test — not in a global `__tests__/` folder.

```
entities/user/
├── ui/UserCard.vue
├── model/useUser.ts
├── api/userApi.ts
├── __tests__/
│   ├── UserCard.test.ts     ← component test
│   └── useUser.test.ts      ← composable test
└── index.ts

features/auth-login/
├── ui/LoginForm.vue
├── model/useLoginForm.ts
├── __tests__/
│   └── useLoginForm.test.ts
└── index.ts
```

```typescript
// entities/user/__tests__/UserCard.test.ts
import { mount } from '@vue/test-utils'
import UserCard from '../ui/UserCard.vue'
import type { User } from '../types'          // internal import ok within same slice

const mockUser: User = {
  id: 1,
  name: 'Jane Doe',
  email: 'jane@example.com',
  createdAt: '2024-01-01T00:00:00Z',
}

describe('UserCard', () => {
  it('renders user name and email', () => {
    const wrapper = mount(UserCard, {
      props: { user: mockUser },
    })

    expect(wrapper.text()).toContain('Jane Doe')
    expect(wrapper.text()).toContain('jane@example.com')
  })

  it('emits delete event with userId when delete button clicked', async () => {
    const wrapper = mount(UserCard, {
      props: { user: mockUser },
    })

    await wrapper.find('[data-testid="delete-button"]').trigger('click')
    expect(wrapper.emitted('delete')).toEqual([[1]])
  })
})
```

```typescript
// entities/user/__tests__/useUser.test.ts — composable test
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useUser } from '../model/useUser'
import { userApi } from '../api/userApi'
import type { User } from '../types'

// Mock useAsyncData to control what it returns
const { useAsyncData } = mockNuxtImport('useAsyncData', () =>
  vi.fn(),
)

const mockUser: User = {
  id: 1,
  name: 'Jane Doe',
  email: 'jane@example.com',
  createdAt: '2024-01-01T00:00:00Z',
}

describe('useUser', () => {
  it('returns user data when fetch succeeds', async () => {
    useAsyncData.mockResolvedValue({
      data: ref(mockUser),
      status: ref('success'),
      error: ref(null),
      refresh: vi.fn(),
    })

    const { user, isLoading, error } = useUser(1)

    expect(user.value).toEqual(mockUser)
    expect(isLoading.value).toBe(false)
    expect(error.value).toBeNull()
  })

  it('exposes error when fetch fails', async () => {
    const fetchError = new Error('Network error')
    useAsyncData.mockResolvedValue({
      data: ref(null),
      status: ref('error'),
      error: ref(fetchError),
      refresh: vi.fn(),
    })

    const { user, error } = useUser(1)

    expect(user.value).toBeNull()
    expect(error.value).toBe(fetchError)
  })
})
```

```bash
# Run frontend tests
npm run test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

---

## Per-task test database (worktree mode)

When the orchestrator runs a task in an isolated worktree it provisions a dedicated, throwaway database and injects these env vars into the agent process:

```
TEST_DB_ENGINE   postgres | mysql
DB_HOST          hostname of the per-task DB
DB_PORT          port
DB_DATABASE      per-task database name
DB_USERNAME
DB_PASSWORD
```

**Detection:** check whether `TEST_DB_ENGINE` is set. If it is, you are in worktree mode; if absent, behave exactly as today (project default DB, legacy mode).

**Wiring the project:**

1. Write (or overwrite) `.env.testing` to point at the injected vars:
   ```bash
   # Laravel connection name: pgsql for postgres, mysql for mysql
   # (map it — do NOT use the raw TEST_DB_ENGINE value, which is `postgres`)
   DB_CONNECTION=pgsql   # or `mysql` when TEST_DB_ENGINE=mysql
   DB_HOST=${DB_HOST}
   DB_PORT=${DB_PORT}
   DB_DATABASE=${DB_DATABASE}
   DB_USERNAME=${DB_USERNAME}
   DB_PASSWORD=${DB_PASSWORD}
   ```
2. Confirm `phpunit.xml` (or `phpunit.xml.dist`) has `<env name="DB_*">` entries that `.env.testing` will override, or remove hardcoded values so the file picks up the env.
3. Run `php artisan migrate:fresh --env=testing` once before the suite. `RefreshDatabase` (already wired in `Pest.php`) handles per-test resets.

**Seeders:** run **only** reference/lookup seeders (e.g. `RolesSeeder`, `CountriesSeeder`). Never rely on demo or sample-data seeders — create all domain data per-test via factories.

```php
// bootstrap/helpers/testing.php — example worktree bootstrap
if (env('TEST_DB_ENGINE')) {
    Artisan::call('migrate:fresh', ['--env' => 'testing', '--force' => true]);
    Artisan::call('db:seed', ['--class' => 'RolesSeeder', '--env' => 'testing']);
}
```
