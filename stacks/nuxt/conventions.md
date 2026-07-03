# Frontend Architecture — Feature Sliced Design + Nuxt 3 + TypeScript

## Core Rule
Architecture follows **Feature Sliced Design (FSD)**. Each layer can only import from layers below it.
No business logic in pages or templates. All data fetching must be SSR-aware (`useAsyncData` / `useFetch`).

---

## FSD Layers (top → bottom, imports go downward only)

```
pages/        ← Nuxt file-based routing — thin, delegates to widgets/features
widgets/      ← Composite UI blocks: Header, Sidebar, UserFeed, OrderDashboard
features/     ← User scenarios: LoginForm, AddToCart, CreateOrder, UploadVideo
entities/     ← Business entities: user/, order/, product/, payment/
shared/       ← No business logic: ui/, lib/, api/, config/, types/
```

**The one rule that makes FSD work:** a slice can import from layers below, never from the same or higher layer.

```
✅ features/login  →  entities/user  →  shared/ui
❌ features/login  →  features/register   (same layer — forbidden)
❌ entities/user   →  features/login      (higher layer — forbidden)
```

Cross-imports within the same layer are **never allowed**. If two features need the same logic — it belongs in `entities/` or `shared/`.

---

## Directory Structure (Nuxt 3 + FSD)

```
├── pages/                    # Nuxt file-based routing
│   ├── index.vue
│   ├── login.vue
│   └── orders/
│       ├── index.vue
│       └── [id].vue
│
├── widgets/                  # Self-contained UI blocks, composed from features/entities
│   ├── header/
│   │   ├── ui/Header.vue
│   │   └── index.ts
│   └── order-feed/
│       ├── ui/OrderFeed.vue
│       └── index.ts
│
├── features/                 # User interaction scenarios
│   ├── auth-login/
│   │   ├── ui/LoginForm.vue
│   │   ├── model/useLoginForm.ts
│   │   ├── api/authApi.ts
│   │   └── index.ts          # public API — only this is imported from outside
│   └── create-order/
│       ├── ui/CreateOrderForm.vue
│       ├── model/useCreateOrder.ts
│       ├── api/createOrderApi.ts
│       └── index.ts
│
├── entities/                 # Business entities with their own UI, model, api
│   ├── user/
│   │   ├── ui/UserCard.vue
│   │   ├── model/useUser.ts
│   │   ├── api/userApi.ts
│   │   ├── types.ts
│   │   └── index.ts
│   └── order/
│       ├── ui/OrderCard.vue
│       ├── model/useOrder.ts
│       ├── api/orderApi.ts
│       ├── types.ts
│       └── index.ts
│
└── shared/                   # Pure reusable code, zero business logic
    ├── ui/                   # Button, Input, Modal, Table, Badge, Spinner
    ├── api/                  # Base $fetch config, interceptors
    ├── lib/                  # formatDate, formatPrice, validators
    ├── config/               # constants, env
    └── types/                # Pagination, ApiResponse, common interfaces
```

---

## Public API — index.ts per slice

Every slice exposes only what's needed via `index.ts`. Nothing else is imported from outside.

```typescript
// entities/user/index.ts
export type { User, CreateUserDTO, UpdateUserDTO } from './types'
export { useUser } from './model/useUser'
export { UserCard } from './ui/UserCard.vue'
export { userApi } from './api/userApi'
```

```typescript
// features/auth-login/index.ts
export { LoginForm } from './ui/LoginForm.vue'
export { useLoginForm } from './model/useLoginForm'
```

Importing from deep paths is forbidden:
```typescript
❌ import { useUser } from '~/entities/user/model/useUser'
✅ import { useUser } from '~/entities/user'
```

---

## TypeScript — Strict

- All files: `.ts` or `.vue` with `<script setup lang="ts">`
- Interfaces for all props, emits, API responses, and DTOs
- No `any` — use `unknown` and narrow where needed
- `readonly` on all refs returned from composables and models

Types live in the slice they belong to (`entities/user/types.ts`), shared types in `shared/types/`.

---

## Data Fetching Rules

| Situation | Use |
|-----------|-----|
| Fetching data in `<script setup>` | `useAsyncData` or `useFetch` |
| Inside event handler / button click | `$fetch` directly |
| Inside a composable/model used in setup | `useAsyncData(() => api.method())` |

**Never use `onMounted` + `$fetch` for initial data** — breaks SSR, causes hydration mismatches.

```typescript
// ❌ WRONG
onMounted(async () => { user.value = await $fetch('/api/users/1') })

// ✅ CORRECT
const { data: user, status, error } = await useAsyncData(
  `user-${userId}`,
  () => userApi.getById(userId),
)
```

---

## Entity Layer — Model

```typescript
// entities/user/model/useUser.ts
import { userApi } from '../api/userApi'
import type { User } from '../types'

export function useUser(userId: MaybeRef<number>) {
  const { data: user, status, error, refresh } = useAsyncData(
    () => `user-${unref(userId)}`,
    () => userApi.getById(unref(userId)),
    { watch: [() => unref(userId)] },
  )

  const isLoading = computed(() => status.value === 'pending')

  return {
    user:      readonly(user),
    isLoading: readonly(isLoading),
    error:     readonly(error),
    refresh,
  }
}
```

---

## Entity Layer — API

```typescript
// entities/user/api/userApi.ts
import type { User, CreateUserDTO, UpdateUserDTO } from '../types'

export const userApi = {
  async getById(userId: number): Promise<User> {
    return $fetch<User>(`/api/v1/users/${userId}`)
  },

  async getAll(): Promise<User[]> {
    return $fetch<User[]>('/api/v1/users')
  },

  async create(data: CreateUserDTO): Promise<User> {
    return $fetch<User>('/api/v1/users', { method: 'POST', body: data })
  },

  async update(userId: number, data: UpdateUserDTO): Promise<User> {
    return $fetch<User>(`/api/v1/users/${userId}`, { method: 'PUT', body: data })
  },

  async remove(userId: number): Promise<void> {
    return $fetch(`/api/v1/users/${userId}`, { method: 'DELETE' })
  },
}
```

---

## Feature Layer

Features implement a single user scenario. They have their own UI, model (composable), and API.

```typescript
// features/create-order/model/useCreateOrder.ts
import { orderApi } from '~/entities/order'      // ✅ importing from entity below
import type { CreateOrderDTO } from '~/entities/order'

export function useCreateOrder() {
  const isSubmitting = ref(false)
  const error = ref<string | null>(null)

  const submitOrder = async (orderData: CreateOrderDTO): Promise<void> => {
    isSubmitting.value = true
    error.value = null
    try {
      await orderApi.create(orderData)
      await navigateTo('/orders')
    } catch (caughtError) {
      error.value = 'Failed to create order'
    } finally {
      isSubmitting.value = false
    }
  }

  return {
    isSubmitting: readonly(isSubmitting),
    error:        readonly(error),
    submitOrder,
  }
}
```

---

## Widget Layer

Widgets compose features and entities into self-contained UI blocks.

```vue
<!-- widgets/order-feed/ui/OrderFeed.vue -->
<script setup lang="ts">
import { OrderCard } from '~/entities/order'          // ✅ entity below
import { CreateOrderForm } from '~/features/create-order' // ✅ feature below
</script>

<template>
  <div>
    <CreateOrderForm />
    <OrderCard v-for="order in orders" :key="order.id" :order="order" />
  </div>
</template>
```

---

## Pages — Routing Only

```vue
<!-- pages/orders/index.vue -->
<script setup lang="ts">
definePageMeta({
  layout: 'default',
  middleware: ['auth'],
})

useSeoMeta({ title: 'Orders' })
</script>

<template>
  <OrderFeed />   <!-- widget -->
</template>
```

Pages contain **only** `definePageMeta`, `useSeoMeta`, and widget/layout composition. No logic, no API calls.

---

## Middleware

```typescript
// shared/config/middleware.ts — middleware names as constants
export const MIDDLEWARE = {
  AUTH:  'auth',
  GUEST: 'guest',
} as const
```

```typescript
// middleware/auth.ts
export default defineNuxtRouteMiddleware(() => {
  const { currentUser } = useAuthStore()
  if (!currentUser.value) return navigateTo('/login')
})
```

---

## Shared Layer — UI Components

`shared/ui/` contains base components with zero business logic:

```vue
<!-- shared/ui/BaseButton.vue -->
<script setup lang="ts">
interface Props {
  variant?: 'primary' | 'secondary' | 'danger'
  loading?: boolean
  disabled?: boolean
}
withDefaults(defineProps<Props>(), { variant: 'primary', loading: false, disabled: false })
const emit = defineEmits<{ click: [] }>()
</script>
```

---

## Pinia — Global State Only

Use stores **only** for state shared across unrelated slices:
- Auth session (`useAuthStore`)
- Global notifications / toasts (`useNotificationStore`)
- Shopping cart (`useCartStore`)

Stores live in `shared/` or `entities/{name}/model/` depending on scope.

```typescript
// entities/user/model/authStore.ts
export const useAuthStore = defineStore('auth', () => {
  const currentUser = ref<User | null>(null)

  const login = async (credentials: LoginDTO): Promise<void> => {
    currentUser.value = await authApi.login(credentials)
  }

  const logout = async (): Promise<void> => {
    await authApi.logout()
    currentUser.value = null
  }

  return { currentUser: readonly(currentUser), login, logout }
})
```

---

## Pagination

Pagination composable lives in `entities/{name}/model/` or `shared/lib/` if reusable.

```typescript
// entities/user/model/useUserList.ts
import { userApi } from '../api/userApi'
import type { PaginatedResponse, User } from '../types'

export function useUserList(initialPage = 1) {
  const page = ref(initialPage)

  const { data, status, refresh } = useAsyncData(
    () => `users-page-${page.value}`,
    () => userApi.paginate(page.value),
    { watch: [page] },
  )

  const isLoading = computed(() => status.value === 'pending')

  const goToPage = (newPage: number): void => {
    page.value = newPage
  }

  return {
    users:     computed(() => data.value?.data ?? []),
    meta:      computed(() => data.value?.meta ?? null),
    isLoading: readonly(isLoading),
    page:      readonly(page),
    goToPage,
    refresh,
  }
}
```

```typescript
// entities/user/types.ts — pagination types in shared/types/ if used across entities
export interface PaginationMeta {
  currentPage: number
  lastPage: number
  perPage: number
  total: number
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: PaginationMeta
}
```

---

## Inertia (when used instead of standalone Nuxt)

When the project uses Inertia.js (Laravel renders pages, no separate API):

**Key differences from standalone Nuxt:**
- No `useAsyncData` / `useFetch` — Laravel pushes data to pages via Inertia props
- No `services/` API layer — mutations go through `useForm` / `router`
- FSD layers still apply: `widgets/`, `features/`, `entities/`, `shared/`
- `pages/` receive typed props from Laravel

**What stays the same:** TypeScript types, composables for local logic, FSD structure, components.

```typescript
// shared/types/inertia.ts — shared Inertia page prop types
export interface InertiaPage<T extends Record<string, unknown> = Record<string, unknown>> {
  props: T
}

export interface PaginationLinks {
  first: string | null
  last: string | null
  prev: string | null
  next: string | null
}

export interface InertiaCollection<T> {
  data: T[]
  links: PaginationLinks
  meta: PaginationMeta
}
```

```vue
<!-- pages/users/index.vue — receives paginated users from Laravel -->
<script setup lang="ts">
import type { User } from '~/entities/user'
import type { InertiaCollection } from '~/shared/types/inertia'
import { UserFeed } from '~/widgets/user-feed'

definePageMeta({ layout: 'default', middleware: ['auth'] })

interface Props {
  users: InertiaCollection<User>
}
const props = defineProps<Props>()
</script>

<template>
  <UserFeed :users="props.users.data" :meta="props.users.meta" />
</template>
```

```vue
<!-- features/create-user/ui/CreateUserForm.vue — mutation via Inertia form -->
<script setup lang="ts">
import type { CreateUserDto } from '~/entities/user'

const form = useForm<CreateUserDto>({
  name:  '',
  email: '',
})

const submit = () => form.post(route('users.store'), {
  onSuccess: () => form.reset(),
})
</script>
```

- Use `useForm` from `@inertiajs/vue3` for all form submissions — provides errors, loading state, reset
- Use `router.visit()` / `router.post()` for programmatic navigation without a form
- All Inertia page props must be typed — no implicit `any` from untyped props

---

## What Goes Where — Quick Reference

| Code | Layer |
|------|-------|
| Button, Input, Modal | `shared/ui/` |
| Date formatter, price formatter | `shared/lib/` |
| User type, Order type | `entities/{name}/types.ts` |
| User API calls (CRUD) | `entities/{name}/api/` |
| `useUser`, `useOrder` composable | `entities/{name}/model/` |
| UserCard, OrderCard component | `entities/{name}/ui/` |
| Login form logic | `features/auth-login/model/` |
| Add-to-cart button + logic | `features/add-to-cart/` |
| Header with nav + auth | `widgets/header/` |
| Page route component | `pages/` |
| Auth session store | `entities/user/model/authStore.ts` |

---

## UI Verification in Worktree Mode

Multiple tasks may run `ui_verification` concurrently in separate worktrees. To avoid port conflicts and data collisions when booting the Nuxt app for verification:

- **Pick a free port dynamically** — never hardcode `3000` or any default. Detect a free port at runtime (e.g. `node -e "const net=require('net');const s=net.createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})"`) and pass it via `--port`.
- **Use an isolated data directory** — if the project writes any runtime data (uploads, cache files), point it at a path scoped to the worktree, not a shared location.
- **Stop only the server you started** — store the process reference or PID and kill only that process when verification finishes. Never run `pkill node`, `pkill nuxt`, or any broad process kill that would terminate other tasks' servers.

## Naming Conventions

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
