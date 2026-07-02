# Backend Architecture — Laravel DDD

## Core Rule
**Zero business logic in Controllers, Routes, Models, Views, or Middlewares.**
Mutations go through Actions. Queries go through Services. Data access in Repositories. Data shapes are DTOs.

### Actions vs Services — the rule

| | Action | Service |
|--|--------|---------|
| **Purpose** | One mutating operation | Read / query only |
| **Examples** | `CreateUserAction`, `PublishPostAction` | `UserService::findById()`, `UserService::paginate()` |
| **Method** | Single `execute(DTO): Model` | Multiple query methods |
| **Side effects** | Yes — events, jobs, cache invalidation | No |
| **Called from** | Controller (write endpoints) | Controller (read endpoints), other Actions |

---

## Directory Structure

```
app/
├── Domain/
│   └── {DomainName}/           # e.g., User, Order, Payment
│       ├── Actions/            # Mutating operations — one class per operation
│       ├── DTOs/               # Data Transfer Objects
│       ├── Events/             # Domain events (pure data)
│       ├── Exceptions/         # Domain-specific exceptions
│       ├── Jobs/               # Queued background jobs
│       ├── Listeners/          # Event listeners
│       ├── Models/             # Eloquent models (data + relations only)
│       ├── Repositories/
│       │   ├── Contracts/      # Interfaces
│       │   └── Eloquent/       # Implementations
│       └── Services/           # Read / query logic only
├── Http/
│   ├── Controllers/            # Thin: validate → DTO → service → resource
│   ├── Middleware/
│   ├── Requests/               # Form Requests (validation only)
│   └── Resources/              # API Resources (transformation only)
└── Providers/
```

---

## Controllers — Thin

Write endpoints use Actions. Read endpoints use Services.

```php
class UserController extends Controller
{
    // WRITE → Action
    public function store(CreateUserRequest $request, CreateUserAction $createUserAction): JsonResponse
    {
        $user = $createUserAction->execute(CreateUserDTO::fromRequest($request));
        return response()->json(new UserResource($user), 201);
    }

    // READ → Service
    public function show(int $id, UserService $userService): JsonResponse
    {
        return response()->json(new UserResource($userService->findById($id)));
    }

    public function index(UserService $userService): JsonResponse
    {
        return response()->json(UserResource::collection($userService->paginate()));
    }
}

// WRONG — never put logic here
class UserController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $user = User::create($request->all()); // NO
        Mail::to($user)->send(new WelcomeMail()); // NO
        return response()->json($user);
    }
}
```

---

## Actions — Mutations

One class, one operation, one `execute()` method. Handles all side effects: events, jobs, cache invalidation.

```php
// Actions/CreateUserAction.php
class CreateUserAction
{
    public function __construct(
        private readonly UserRepositoryInterface $userRepository,
        private readonly Dispatcher $eventDispatcher,
    ) {}

    public function execute(CreateUserDTO $createUserDTO): User
    {
        $user = $this->userRepository->create($createUserDTO);
        $this->eventDispatcher->dispatch(new UserCreated($user));
        return $user;
    }
}

// Actions/UpdateUserAction.php
class UpdateUserAction
{
    private const CACHE_TAG = 'users';

    public function __construct(
        private readonly UserRepositoryInterface $userRepository,
    ) {}

    public function execute(int $userId, UpdateUserDTO $updateUserDTO): User
    {
        $user = $this->userRepository->update($userId, $updateUserDTO);
        Cache::tags(self::CACHE_TAG)->flush(); // Invalidate after mutation — always in the Action, not Service
        return $user;
    }
}

// Actions/DeleteUserAction.php
class DeleteUserAction
{
    public function __construct(
        private readonly UserRepositoryInterface $userRepository,
        private readonly Dispatcher $eventDispatcher,
    ) {}

    public function execute(int $userId): void
    {
        $user = $this->userRepository->findById($userId)
            ?? throw UserNotFoundException::withId($userId);

        $this->userRepository->delete($userId);
        $this->eventDispatcher->dispatch(new UserDeleted($user));
    }
}
```

---

## Services — Queries Only

No mutations. No side effects. Only read operations.

```php
class UserService
{
    public function __construct(
        private readonly UserRepositoryInterface $userRepository,
    ) {}

    public function findById(int $userId): User
    {
        return $this->userRepository->findById($userId)
            ?? throw UserNotFoundException::withId($userId);
    }

    public function paginate(int $perPage = 20): LengthAwarePaginator
    {
        return $this->userRepository->paginate($perPage);
    }

    public function findByEmail(string $email): ?User
    {
        return $this->userRepository->findByEmail($email);
    }
}
```

---

## DTOs — Immutable Data Shapes

```php
readonly class CreateUserDTO
{
    public function __construct(
        public string $name,
        public string $email,
        public string $password,
    ) {}

    public static function fromRequest(CreateUserRequest $request): self
    {
        return new self(
            name: $request->validated('name'),
            email: $request->validated('email'),
            password: $request->validated('password'),
        );
    }
}
```

---

## Repositories — Data Access Only

```php
// Interface — in Contracts/
interface UserRepositoryInterface
{
    public function create(CreateUserDTO $createUserDTO): User;
    public function findById(int $userId): ?User;
    public function findByEmail(string $email): ?User;
    public function update(int $userId, UpdateUserDTO $updateUserDTO): User;
    public function delete(int $userId): void;
}

// Implementation — in Eloquent/
class EloquentUserRepository implements UserRepositoryInterface
{
    public function create(CreateUserDTO $createUserDTO): User
    {
        return User::create([
            'name'     => $createUserDTO->name,
            'email'    => $createUserDTO->email,
            'password' => Hash::make($createUserDTO->password),
        ]);
    }

    public function findById(int $userId): ?User
    {
        return User::find($userId);
    }

    public function findByEmail(string $email): ?User
    {
        return User::where('email', $email)->first();
    }
}
```

Always bind the interface in a ServiceProvider:
```php
$this->app->bind(UserRepositoryInterface::class, EloquentUserRepository::class);
```

---

## Exceptions — Domain-Specific

```php
// CORRECT — domain exception with factory method
class UserNotFoundException extends DomainException
{
    public static function withId(int $userId): self
    {
        return new self("User [{$userId}] not found.");
    }
}

class InsufficientBalanceException extends DomainException
{
    public static function forAmount(float $amount): self
    {
        return new self("Insufficient balance for amount: {$amount}.");
    }
}

// WRONG — never use generic exceptions for business logic
throw new \Exception('User not found'); // NO
throw new \RuntimeException('Insufficient balance'); // NO
```

Register domain exceptions in the global Handler for consistent API responses:
```php
$this->renderable(function (UserNotFoundException $e) {
    return response()->json(['message' => $e->getMessage()], 404);
});
```

---

## Caching with Redis — Service Layer Only

**Rules (non-negotiable):**
- Cache only in the Service layer (reads) and Action layer (invalidation after mutations)
- **Always set a TTL** — using `Cache::put()` or `Cache::remember()` without TTL is forbidden
- Use named TTL constants — never raw numbers
- Use cache tags for grouped invalidation
- **Cache invalidation happens in the Action** that performed the mutation — never in a Service

```php
// Service — cache reads only
class UserService
{
    private const CACHE_TTL_SECONDS = 3600;   // 1 hour — Laravel uses seconds
    private const CACHE_TAG         = 'users';

    public function findById(int $userId): User
    {
        return Cache::tags(self::CACHE_TAG)
            ->remember("user:{$userId}", self::CACHE_TTL_SECONDS, function () use ($userId) {
                return $this->userRepository->findById($userId)
                    ?? throw UserNotFoundException::withId($userId);
            });
    }
}

// Action — cache invalidation after mutation (see UpdateUserAction above)
```

// FORBIDDEN:
Cache::put('key', $value);                      // No TTL
Cache::remember('key', 0, fn() => $value);     // Zero TTL
Cache::forever('key', $value);                  // Only for genuinely static data — add comment explaining why
```

---

## Events & Listeners

- Events are pure data objects — no logic inside
- Listeners do exactly ONE thing
- Heavy or async operations go to Jobs dispatched from Listeners

```php
// Event — pure data
class UserCreated
{
    public function __construct(public readonly User $user) {}
}

// Listener — one responsibility
class SendWelcomeEmailListener
{
    public function handle(UserCreated $userCreatedEvent): void
    {
        SendWelcomeEmailJob::dispatch($userCreatedEvent->user);
    }
}

// Job — handles the async work
class SendWelcomeEmailJob implements ShouldQueue
{
    public function __construct(private readonly User $user) {}

    public function handle(MailService $mailService): void
    {
        $mailService->sendWelcome($this->user);
    }
}
```

---

## Form Requests — Validation Only

```php
class CreateUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name'                  => ['required', 'string', 'max:255'],
            'email'                 => ['required', 'email', 'unique:users'],
            'password'              => ['required', 'min:8', 'confirmed'],
            'password_confirmation' => ['required'],
        ];
    }
}
```

---

## Models — Data & Relations Only

```php
class User extends Authenticatable
{
    protected $fillable = ['name', 'email', 'password'];
    protected $hidden   = ['password', 'remember_token'];
    protected $casts    = ['email_verified_at' => 'datetime'];

    // Relations only — no business methods
    public function orders(): HasMany
    {
        return $this->hasMany(Order::class);
    }

    public function profile(): HasOne
    {
        return $this->hasOne(UserProfile::class);
    }
}
```

---

## API Resources — Response Transformation Only

```php
class UserResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'         => $this->id,
            'name'       => $this->name,
            'email'      => $this->email,
            'created_at' => $this->created_at->toISOString(),
        ];
    }
}
```

Never return raw Eloquent models from controllers — always use a Resource.

---

## Pagination

Repository returns a `LengthAwarePaginator`. Service passes it through. Controller wraps in Resource collection.

```php
// Repository Interface
public function paginate(int $perPage): LengthAwarePaginator;

// Eloquent Implementation
public function paginate(int $perPage = 20): LengthAwarePaginator
{
    return User::orderByDesc('created_at')->paginate($perPage);
}

// Service — queries only, passes paginator through
public function paginate(int $perPage = 20): LengthAwarePaginator
{
    return $this->userRepository->paginate($perPage);
}

// Controller
public function index(UserService $userService): JsonResponse
{
    return response()->json(UserResource::collection($userService->paginate()));
}
```

Response shape (automatic with `Resource::collection` on a paginator):
```json
{
  "data": [...],
  "links": { "first": "...", "last": "...", "prev": null, "next": "..." },
  "meta":  { "current_page": 1, "last_page": 5, "per_page": 20, "total": 98 }
}
```

---

## Business Rule Validation

HTTP validation (format, required fields) → Form Request.
Business rule validation (domain constraints) → Action (for mutations) or Service (for queries).

```php
// CreateUserAction — business rule: email must be unique across active users
class CreateUserAction
{
    public function execute(CreateUserDTO $createUserDTO): User
    {
        $existingUser = $this->userRepository->findByEmail($createUserDTO->email);
        if ($existingUser !== null) {
            throw UserAlreadyExistsException::withEmail($createUserDTO->email);
        }

        $user = $this->userRepository->create($createUserDTO);
        $this->eventDispatcher->dispatch(new UserCreated($user));
        return $user;
    }
}

// DeleteUserAction — business rule: can't delete user with pending orders
class DeleteUserAction
{
    public function execute(int $userId): void
    {
        $user = $this->userRepository->findById($userId)
            ?? throw UserNotFoundException::withId($userId);

        if ($this->orderRepository->hasPendingOrders($userId)) {
            throw UserHasPendingOrdersException::forUser($userId);
        }

        $this->userRepository->delete($userId);
        $this->eventDispatcher->dispatch(new UserDeleted($user));
    }
}
```
