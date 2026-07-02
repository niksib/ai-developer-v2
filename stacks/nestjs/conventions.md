# Backend Architecture — NestJS (Node.js API)

## Core Rule
**Zero business logic in Controllers, Guards, Interceptors, or Entities.**
Mutations go through Actions. Queries go through Services. Data access in Repositories. Data shapes are DTOs.
Mirrors the Laravel DDD approach — see [memory/backend.md](../memory/backend.md) for philosophy.

### Actions vs Services — the rule

| | Action | Service |
|--|--------|---------|
| **Purpose** | One mutating operation | Read / query only |
| **Examples** | `CreateUserAction`, `PublishPostAction` | `UserService.findById()`, `UserService.paginate()` |
| **Method** | Single `execute(dto): ResponseDto` | Multiple query methods |
| **Side effects** | Yes — events, jobs, cache invalidation | No |
| **Called from** | Controller (write endpoints) | Controller (read endpoints), other Actions |

---

## Stack
- **NestJS** — framework (modules, DI, decorators)
- **TypeScript** — strict, no `any`
- **TypeORM** or **Prisma** — ORM (check project's `.claude/CLAUDE.md`)
- **class-validator** + **class-transformer** — DTO validation
- **Bull** — queues (Redis-backed)
- **Jest** — testing

---

## Directory Structure

```
src/
├── domain/
│   └── {domain-name}/              # e.g. user, order, payment
│       ├── dto/                    # Data Transfer Objects
│       ├── entities/               # TypeORM/Prisma entities (data only)
│       ├── events/                 # Domain events
│       ├── exceptions/             # Domain-specific exceptions
│       ├── jobs/                   # Bull queue jobs
│       ├── listeners/              # Event listeners
│       ├── repositories/
│       │   ├── {domain}.repository.interface.ts
│       │   └── {domain}.repository.ts
│       ├── actions/                # Mutating operations — one class per operation
│       ├── services/               # Read / query logic only
│       ├── {domain}.controller.ts  # Thin controller
│       └── {domain}.module.ts      # NestJS module
├── common/
│   ├── dto/                        # PaginatedResponseDto, shared types
│   ├── filters/                    # Global exception filters
│   ├── guards/                     # Auth guards
│   ├── interceptors/               # Response interceptors
│   └── pipes/                      # Validation pipes
└── app.module.ts
```

---

## Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| DTO | `{Verb}{Entity}Dto` | `CreateUserDto`, `UpdateOrderDto` |
| Action | `{Verb}{Entity}Action` | `CreateUserAction`, `PublishPostAction` |
| Service | `{Entity}Service` | `UserService` |
| Repository Interface | `I{Entity}Repository` | `IUserRepository` |
| Repository | `{Entity}Repository` | `UserRepository` |
| Event | `{Entity}{PastTense}Event` | `UserCreatedEvent` |
| Listener | `{Entity}{PastTense}Listener` | `UserCreatedListener` |
| Job | `{Verb}{Entity}Job` | `SendWelcomeEmailJob` |
| Exception | `{Entity}{Reason}Exception` | `UserNotFoundException` |
| Module | `{Entity}Module` | `UserModule` |
| Controller | `{Entity}Controller` | `UserController` |

---

## Module

Actions must be registered in `providers` alongside Services.

```typescript
// domain/user/user.module.ts
@Module({
  imports: [TypeOrmModule.forFeature([UserEntity])],
  controllers: [UserController],
  providers: [
    // Repository binding
    { provide: IUserRepository, useClass: UserRepository },

    // Actions — one provider per action
    CreateUserAction,
    UpdateUserAction,
    DeleteUserAction,

    // Services
    UserService,
  ],
  exports: [UserService],
})
export class UserModule {}
```

---

## Controllers — Thin

Write endpoints use Actions. Read endpoints use Services.

```typescript
@Controller('users')
export class UserController {
  constructor(
    private readonly createUserAction: CreateUserAction,
    private readonly updateUserAction: UpdateUserAction,
    private readonly deleteUserAction: DeleteUserAction,
    private readonly userService: UserService,
  ) {}

  // WRITE → Action
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createUserDto: CreateUserDto): Promise<UserResponseDto> {
    return this.createUserAction.execute(createUserDto);
  }

  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) userId: number,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    return this.updateUserAction.execute(userId, updateUserDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', ParseIntPipe) userId: number): Promise<void> {
    return this.deleteUserAction.execute(userId);
  }

  // READ → Service
  @Get(':id')
  async findById(@Param('id', ParseIntPipe) userId: number): Promise<UserResponseDto> {
    return this.userService.findById(userId);
  }

  @Get()
  async paginate(@Query() query: PaginateUsersDto): Promise<PaginatedResponseDto<UserResponseDto>> {
    return this.userService.paginate(query);
  }
}

// WRONG — never put logic here
@Post()
async create(@Body() body: any) {              // NO: any type
  const user = await this.userRepo.save(body); // NO: direct repo call
  await this.mailer.send(user.email);          // NO: side effect here
  return user;
}
```

---

## Actions — Mutations

One class, one operation, single `execute()` method. Handles all side effects: events, jobs, cache invalidation.

```typescript
// domain/user/actions/create-user.action.ts
@Injectable()
export class CreateUserAction {
  constructor(
    @Inject(IUserRepository)
    private readonly userRepository: IUserRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(createUserDto: CreateUserDto): Promise<UserResponseDto> {
    const existingUser = await this.userRepository.findByEmail(createUserDto.email);
    if (existingUser) {
      throw new UserAlreadyExistsException(createUserDto.email);
    }

    const user = await this.userRepository.create(createUserDto);
    this.eventEmitter.emit('user.created', new UserCreatedEvent(user));

    return UserResponseDto.fromEntity(user);
  }
}

// domain/user/actions/update-user.action.ts
@Injectable()
export class UpdateUserAction {
  private readonly CACHE_KEY_PREFIX = 'user';

  constructor(
    @Inject(IUserRepository)
    private readonly userRepository: IUserRepository,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  async execute(userId: number, updateUserDto: UpdateUserDto): Promise<UserResponseDto> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UserNotFoundException(userId);

    const updatedUser = await this.userRepository.update(userId, updateUserDto);
    await this.cacheManager.del(`${this.CACHE_KEY_PREFIX}:${userId}`); // Invalidate after mutation
    return UserResponseDto.fromEntity(updatedUser);
  }
}

// domain/user/actions/delete-user.action.ts
@Injectable()
export class DeleteUserAction {
  constructor(
    @Inject(IUserRepository)
    private readonly userRepository: IUserRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(userId: number): Promise<void> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UserNotFoundException(userId);

    await this.userRepository.delete(userId);
    this.eventEmitter.emit('user.deleted', new UserDeletedEvent(user));
  }
}
```

---

## Services — Queries Only

No mutations. No side effects. Only read operations and cache reads.

```typescript
// domain/user/services/user.service.ts
@Injectable()
export class UserService {
  // NestJS cache-manager uses milliseconds (unlike Laravel which uses seconds)
  private readonly CACHE_TTL_MS = 3600 * 1000; // 1 hour in ms
  private readonly CACHE_KEY_PREFIX = 'user';

  constructor(
    @Inject(IUserRepository)
    private readonly userRepository: IUserRepository,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  async findById(userId: number): Promise<UserResponseDto> {
    const cacheKey = `${this.CACHE_KEY_PREFIX}:${userId}`;

    const cached = await this.cacheManager.get<UserResponseDto>(cacheKey);
    if (cached) return cached;

    const user = await this.userRepository.findById(userId);
    if (!user) throw new UserNotFoundException(userId);

    const responseDto = UserResponseDto.fromEntity(user);
    await this.cacheManager.set(cacheKey, responseDto, this.CACHE_TTL_MS);

    return responseDto;
  }

  async paginate(query: PaginateUsersDto): Promise<PaginatedResponseDto<UserResponseDto>> {
    const [users, total] = await this.userRepository.paginate(query.page, query.perPage);
    return PaginatedResponseDto.of(
      users.map(UserResponseDto.fromEntity),
      total,
      query.page,
      query.perPage,
    );
  }
}
```

---

## DTOs — Validation + Shape

```typescript
// domain/user/dto/create-user.dto.ts
export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  readonly name: string;

  @IsEmail()
  readonly email: string;

  @IsString()
  @MinLength(8)
  readonly password: string;
}

// domain/user/dto/user-response.dto.ts
export class UserResponseDto {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly createdAt: string;

  static fromEntity(user: UserEntity): UserResponseDto {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
```

Enable global validation pipe in `main.ts`:
```typescript
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
```

---

## Repositories — Data Access Only

```typescript
// Interface
export const IUserRepository = Symbol('IUserRepository');
export interface IUserRepository {
  create(dto: CreateUserDto): Promise<UserEntity>;
  findById(userId: number): Promise<UserEntity | null>;
  findByEmail(email: string): Promise<UserEntity | null>;
  update(userId: number, dto: UpdateUserDto): Promise<UserEntity>;
  delete(userId: number): Promise<void>;
  paginate(page: number, perPage: number): Promise<[UserEntity[], number]>;
}

// Implementation
@Injectable()
export class UserRepository implements IUserRepository {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userEntityRepository: Repository<UserEntity>,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<UserEntity> {
    const user = this.userEntityRepository.create({
      name:     createUserDto.name,
      email:    createUserDto.email,
      password: await bcrypt.hash(createUserDto.password, 10),
    });
    return this.userEntityRepository.save(user);
  }

  async findById(userId: number): Promise<UserEntity | null> {
    return this.userEntityRepository.findOne({ where: { id: userId } });
  }

  async paginate(page: number, perPage: number): Promise<[UserEntity[], number]> {
    return this.userEntityRepository.findAndCount({
      skip:  (page - 1) * perPage,
      take:  perPage,
      order: { createdAt: 'DESC' },
    });
  }
}
```

---

## Pagination

```typescript
// common/dto/paginate.dto.ts
export class PaginateDto {
  @IsInt()
  @Min(1)
  @Type(() => Number)
  readonly page: number = 1;

  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  readonly perPage: number = 20;
}

// common/dto/paginated-response.dto.ts
export class PaginatedResponseDto<T> {
  readonly data: T[];
  readonly meta: {
    currentPage: number;
    lastPage: number;
    perPage: number;
    total: number;
  };

  static of<T>(
    data: T[],
    total: number,
    page: number,
    perPage: number,
  ): PaginatedResponseDto<T> {
    return {
      data,
      meta: {
        currentPage: page,
        lastPage:    Math.ceil(total / perPage),
        perPage,
        total,
      },
    };
  }
}

// Domain-specific paginate DTO extends common one
export class PaginateUsersDto extends PaginateDto {}
```

---

## Business Rule Validation

HTTP validation (format, required) → class-validator in DTO.
Business rule validation (domain constraints) → Action (mutations) or Service (queries).

```typescript
// CreateUserAction — business rule: email must be unique
async execute(createUserDto: CreateUserDto): Promise<UserResponseDto> {
  const existingUser = await this.userRepository.findByEmail(createUserDto.email);
  if (existingUser) {
    throw new UserAlreadyExistsException(createUserDto.email); // domain exception
  }
  // ...
}

// DeleteUserAction — business rule: can't delete user with pending orders
async execute(userId: number): Promise<void> {
  const pendingOrders = await this.orderRepository.countPending(userId);
  if (pendingOrders > 0) {
    throw new UserHasPendingOrdersException(userId);
  }
  // ...
}
```

---

## Exceptions — Domain-Specific

```typescript
// domain/user/exceptions/user-not-found.exception.ts
export class UserNotFoundException extends NotFoundException {
  constructor(userId: number) {
    super(`User [${userId}] not found.`);
  }
}

export class UserAlreadyExistsException extends ConflictException {
  constructor(email: string) {
    super(`User with email [${email}] already exists.`);
  }
}

export class UserHasPendingOrdersException extends UnprocessableEntityException {
  constructor(userId: number) {
    super(`User [${userId}] cannot be deleted — has pending orders.`);
  }
}
```

Global exception filter for consistent error response shape:

```typescript
// common/filters/domain-exception.filter.ts
@Catch(HttpException)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const status = exception.getStatus();

    response.status(status).json({
      statusCode: status,
      message:    exception.message,
      error:      exception.name,
    });
  }
}

// Register in main.ts
app.useGlobalFilters(new DomainExceptionFilter());
```

---

## Caching with Redis — Rules

- Cache reads in Service layer only
- **Cache invalidation in the Action** that performed the mutation — never in a Service
- **Always set TTL** — `cacheManager.set(key, value)` without TTL is forbidden
- **NestJS cache-manager uses milliseconds** (unlike Laravel which uses seconds)

```typescript
// CORRECT
private readonly CACHE_TTL_MS = 3600 * 1000; // 1 hour — note: milliseconds in NestJS
await this.cacheManager.set(cacheKey, data, this.CACHE_TTL_MS);

// FORBIDDEN
await this.cacheManager.set(key, value);        // No TTL
await this.cacheManager.set(key, value, 0);     // Zero TTL
```

---

## Events & Listeners

```typescript
// Event — pure data
export class UserCreatedEvent {
  constructor(public readonly user: UserEntity) {}
}

// Listener — dispatches job, one responsibility
@Injectable()
export class UserCreatedListener {
  constructor(
    @InjectQueue('email')
    private readonly emailQueue: Queue,
  ) {}

  @OnEvent('user.created')
  async handle(event: UserCreatedEvent): Promise<void> {
    await this.emailQueue.add('welcome', { userId: event.user.id });
  }
}

// Register in module providers
```

---

## Queues (Bull)

```typescript
// Job processor
@Processor('email')
export class SendWelcomeEmailJob {
  @Process('welcome')
  async handle(job: Job<{ userId: number }>): Promise<void> {
    // send email logic — inject MailService here via constructor
  }
}

// Dispatch from listener (see above)
await this.emailQueue.add('welcome', { userId: user.id });
```

---

## Entities — Data & Relations Only

```typescript
@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  name: string;

  @Column({ unique: true })
  email: string;

  @Column({ select: false })
  password: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Relations only — no business methods
  @OneToMany(() => OrderEntity, (order) => order.user)
  orders: OrderEntity[];
}
```

---

## API Standards

- Versioning via URI: `/api/v1/users`
- Setup in `main.ts`: `app.setGlobalPrefix('api/v1')`
- Always return DTOs — never raw entities
- Consistent error response via global exception filter
- Pagination for all collection endpoints

```json
// Error response shape
{ "statusCode": 404, "message": "User [1] not found.", "error": "UserNotFoundException" }

// Paginated response shape
{
  "data": [...],
  "meta": { "currentPage": 1, "lastPage": 5, "perPage": 20, "total": 98 }
}
```

---

## Per-task test database (worktree mode)

When an orchestrator or CI runs the task in an isolated worktree it may provision a dedicated, throwaway database and injects these env vars into the agent process:

```
TEST_DB_ENGINE   postgres | mysql
DB_HOST          hostname of the per-task DB
DB_PORT          port
DB_DATABASE      per-task database name
DB_USERNAME
DB_PASSWORD
DATABASE_URL     full connection string (convenience alias)
```

**Detection:** check whether `TEST_DB_ENGINE` is set. If it is, you are in worktree mode; if absent, fall back to today's behaviour (project default DB / in-memory SQLite / whatever the project uses).

**Wiring the suite:**

NestJS has no built-in `RefreshDatabase` equivalent, so add a Jest `globalSetup` that runs migrations against the per-task DB before any test file loads.

```typescript
// test/global-setup.ts
import { DataSource } from 'typeorm';   // or your Prisma/Knex equivalent

export default async function globalSetup(): Promise<void> {
  if (!process.env.TEST_DB_ENGINE) return; // legacy mode — skip

  const dataSource = new DataSource({
    type: process.env.TEST_DB_ENGINE as 'postgres' | 'mysql',
    host:     process.env.DB_HOST,
    port:     Number(process.env.DB_PORT),
    database: process.env.DB_DATABASE,
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    entities:   [__dirname + '/../src/**/*.entity{.ts,.js}'],
    migrations: [__dirname + '/../src/database/migrations/*{.ts,.js}'],
  });

  await dataSource.initialize();
  await dataSource.runMigrations();
  await dataSource.destroy();
}
```

Register it in `jest.config.ts`:

```typescript
export default {
  globalSetup: '<rootDir>/test/global-setup.ts',
  // ... rest of config
};
```

**Per-test isolation:** wrap each test (or `beforeEach`/`afterEach`) in a transaction that rolls back, or truncate relevant tables. Do not rely on a shared state across tests.

```typescript
// Truncate pattern — usable in beforeEach
await dataSource.query('TRUNCATE TABLE users RESTART IDENTITY CASCADE');
```

**Domain data:** create all test fixtures via TypeORM factories or the project's factory helpers. Never rely on demo seeders — those are for development databases only.

**Seeders (reference data only):** if the project has lookup/reference seeders (e.g. roles, countries), run them inside `globalSetup` after migrations, before the suite starts.
