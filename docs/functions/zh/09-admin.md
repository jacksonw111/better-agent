# 管理后台

管理后台应用 (`apps/admin/`) 是一个面向员工用户的 TanStack Router 单页应用（SPA），用于管理客户、员工账号和 AI 供应商凭证。它与面向客户的 Web 应用是独立部署的，并处于更严格的认证门禁之后：只有员工受众可以登录，并且只有 admin 邮箱或数据库标记为管理员的账号才能渲染应用外壳。

## 架构

管理后台由四个功能领域构成，建立在带类型的 oRPC 客户端之上，全部由一道认证边界门禁把守：

```
┌─────────────────────────────────────────────────────────────┐
│  AuthBoundary (auth-guard.tsx)                               │
│   staff-audience token → me.isAdmin → <AdminShell/>          │
│        else → NotAuthorizedScreen / redirect to /login       │
└─────────────────────────────────────────────────────────────┘
        │ TanStack Router routes (file-based)
        ├── /customers          CustomersTable (list/search/page)
        ├── /customers/$userId  CustomerInfoCard + Usage + Activity
        ├── /users              UsersTable (staff CRUD)
        ├── /providers          Tabs: Credentials / Catalog / Models
        └── /login              password sign-in (audience: "staff")
                │
                ▼  createTanstackQueryUtils(client)
        ┌──────────────────────────────────────────────────────┐
        │  orpc.* — typed RPC over /rpc (Bearer access token)  │
        └──────────────────────────────────────────────────────┘
                │  adminProcedure (packages/api/src/index.ts)
                ▼
        adminRouter { listCustomers, getCustomer, blockUser,
                       unblockUser, listStaff, createStaff,
                       deleteStaff, … } + providersRouter
```

### 两类认证受众

平台将客户和员工保持在两个相互独立的群体中。`loginWithPassword` (`packages/api/src/routers/auth.ts:191`) 接受 `"customer" | "staff"` 的 `audience` 参数。管理后台的登录表单始终发送 `audience: "staff"` (`apps/admin/src/routes/login.tsx:61`)；客户凭证会在任何令牌签发之前以 FORBIDDEN 被拒绝。超级管理员邮箱（`packages/agent/src/auth/admin.ts:1` 中的 `SUPER_ADMIN_EMAIL`）无论数据库中的 `kind` 字段为何，始终被视为员工。

### 管理后台 procedure 门禁

每个管理后台路由的 procedure 都会经过 `adminProcedure` (`packages/api/src/index.ts:52`)：

1. `requireActiveUser(context)` — 将 JWT bearer 解析为 `User`，若不存在或处于 `blocked` 状态则拒绝。
2. `isAdminEmail(user.email, authConfig.adminEmails)` — 内置超级管理员，或 `ADMIN_EMAILS` 允许名单中的一项。
3. 或者 `stores.user.isAdmin(user.id)` — 通过带外方式设置的数据库 `is_admin` 标志。
4. 若以上都不满足，抛出 `FORBIDDEN`。

客户端在启动时会再次校验：`useAuthBootstrap` 用存储的 refresh token 换取一个新的 access token，随后 `AuthBoundary` 在渲染 `<AdminShell/>` 之前读取 `me.isAdmin`。一个非管理员即便以某种方式获取了员工令牌，也只会看到 `NotAuthorizedScreen` 并被提供登出选项（`apps/admin/src/components/auth-guard.tsx:82`）。

## 关键文件

| 文件 | 职责 |
|------|----------------|
| `apps/admin/src/routes/customers.index.tsx` | 客户列表：`listCustomers` 查询 + `useListView`（搜索/分页） |
| `apps/admin/src/routes/customers.$userId.tsx` | 客户详情：信息卡片 + 用量区块 + 活动时间线；NOT_FOUND 时重定向 |
| `apps/admin/src/routes/users.tsx` | 员工列表：`listStaff`、客户端搜索 + `PAGE_SIZE=10` 分页、通过 `deleteStaff` 删除 |
| `apps/admin/src/routes/providers.tsx` | 三标签页的供应商页面（凭证 / 目录 / 模型） |
| `apps/admin/src/routes/login.tsx` | 密码登录，硬编码 `audience: "staff"` |
| `apps/admin/src/components/auth-guard.tsx` | `AuthBoundary`：refresh 引导、公共路径白名单、`me.isAdmin` 门禁、重定向到 `/login` |
| `apps/admin/src/components/customers/customers-table.tsx` | 头像 + 邮箱 + 已验证/加入时间/状态 + 指向详情的箭头链接 |
| `apps/admin/src/components/customers/customer-info-card.tsx` | 详情头部：头像、状态徽章、加入/已验证/agentCount、`BlockToggle` |
| `apps/admin/src/components/customers/block-toggle.tsx` | 带确认气泡的 `Block` / 描边样式的 `Unblock`；使 customer+list+activity 查询失效 |
| `apps/admin/src/components/customers/customer-usage-section.tsx` | `SummaryCards` + `TokenChart` + `WindowToggle`（时间窗口选择器） |
| `apps/admin/src/components/customers/activity-timeline.tsx` | `customerActivity` 查询、按图标映射的事件时间线 |
| `apps/admin/src/components/users/users-table.tsx` | 员工行；自身行显示 "you"（不可删除）；其他行显示 `DeleteConfirm` |
| `apps/admin/src/components/users/add-staff-dialog.tsx` | 邮箱 + 密码（最少 8 位）对话框，调用 `createStaff` |
| `apps/admin/src/components/providers/credentials-card.tsx` | 凭证 CRUD 表格；通过 `CredentialDialog` 新增/编辑，通过确认气泡删除 |
| `apps/admin/src/components/providers/catalog-card.tsx` | 目录列表 + 调用 `catalogRefresh` 的 `Refresh catalog` mutation |
| `apps/admin/src/components/providers/models-card.tsx` | 供应商选择 → `modelsList` 表格（模型、名称、上下文、工具） |
| `packages/api/src/routers/admin-customers.ts` | `listCustomers`、`getCustomer`、`customerUsage`、`customerActivity`、`blockUser`、`unblockUser` |
| `packages/api/src/routers/admin.ts` | 合并 `adminCustomersRouter`；新增 `listStaff`、`createStaff`、`deleteStaff`（自身/超级管理员保护） |
| `packages/api/src/routers/providers.ts` | `catalogList`、`catalogRefresh`、`credentialsList/Upsert/Delete`、`modelsList`（管理员）；`available`/`models`（任意用户） |
| `packages/api/src/index.ts` | `adminProcedure`（受众 + 白名单 + isAdmin）、`requireActiveUser`（实时拦截被封禁用户） |
| `packages/agent/src/auth/admin.ts` | `SUPER_ADMIN_EMAIL` 常量、`isAdminEmail(email, allowlist)` |

## 数据流

### 客户列表 → 详情

`customers.index.tsx:21` 运行 `orpc.admin.listCustomers.queryOptions()`，它会解析所有 `kind === "customer"` 的用户（`admin-customers.ts:24`）。`useListView` hook 在结果之上叠加了客户端的邮箱子串过滤 + 分页。点击某一行会导航到 `/customers/$userId`，在那里 `customers.$userId.tsx:55` 会发起三个相互独立的查询：

- `getCustomer` — 信息 + `agentCount`（一次单独的 `listByUser` 计数），
- `customerUsage`（通过 `useCustomerUsage`）— 用于图表的每日 token 序列，
- `customerActivity` — 用于时间线的近期事件。

当客户在列表与详情之间被删除而产生 NOT_FOUND 时，会被 `isNotFound`（`customers.$userId.tsx:18`）检测到，并带着 toast 重定向回 `/customers`。

### 封禁 / 解封

`block-toggle.tsx:26` 调用 `blockUser`。在服务端（`admin-customers.ts:58`），它会依次做三件事：

1. `requireCustomer` — 确认该 id 是一个真实客户（否则返回 NOT_FOUND）。
2. `stores.user.setBlocked(userId, true)` — 翻转 `blocked` 标志。
3. `stores.refreshToken.revokeAllForUser(userId)` — **所有** refresh token 都被吊销，因此用户的现有会话无法再换取新的 access token。

由于 `requireActiveUser`（`packages/api/src/index.ts:34`）会在**每一次**已认证请求中重新读取用户记录，并在 `blocked` 为 true 时抛出 FORBIDDEN，因此即便是已签发的 access token 也会立即失效（它们最多存活一个 access-token TTL，但下一次请求会在门禁处失败）。会记录一条 `account_blocked` 活动记录。`unblockUser` 清除该标志并记录 `account_unblocked`；不会重新签发令牌——用户必须重新登录。

客户端在成功时会失效三个查询键（`block-toggle.tsx:17`）：详情的 `getCustomer`、列表的 `listCustomers`，以及 `customerActivity`（这样时间线就能拾取新事件）。

### 员工创建 / 删除

`createStaff`（`admin.ts:16`）是创建 `kind: "staff"` 记录的唯一途径——Web 注册（`registerWithPassword`）硬编码为 `kind: "customer"`（`auth.ts:182`）。邮箱唯一性在服务端强制校验（已存在的邮箱会返回 CONFLICT）。密码在存储之前通过 `hashPassword` 进行 scrypt 哈希处理。

`deleteStaff`（`admin.ts:34`）在操作数据库之前会拒绝两种情况：

- `input.userId === context.authedUser.id` → BAD_REQUEST "You cannot delete your own account" — 在 UI 侧也于 `users-table.tsx:36` 强制执行（自身行渲染 "you" 而不是删除按钮）。
- `target.email === SUPER_ADMIN_EMAIL` → BAD_REQUEST "The super admin cannot be deleted" — 超级管理员不可撤销。

一次有效的删除会先吊销目标的所有 refresh token，然后硬删除该记录。

### 供应商凭证与目录

供应商页面是三个标签页，共享一个 `catalogList` 查询（供应商 id/名称的来源）：

- **Credentials**（`credentials-card.tsx`）— `credentialsList` 返回脱敏后的行（`providerId`、`last4`、`baseURL`、`enabled`）。新增/编辑会打开 `CredentialDialog` → `credentialsUpsert`（`providers.ts:24`），它会在原始密钥到达数据库之前用 `SecretBox` 加密（参见 [13-cross-cutting.md]）。删除通过确认气泡 → `credentialsDelete`。
- **Catalog**（`catalog-card.tsx`）— `catalogList` 展示已知供应商目录；`Refresh catalog` 调用 `catalogRefresh` → `services.catalog.sync()`，它从 models.dev 拉取数据并对目录 + 模型缓存执行 upsert。
- **Models**（`models-card.tsx`）— 选择一个供应商，然后 `modelsList` 返回其缓存的模型（id、name、contextLimit、toolCall 能力）供查看。

`available` 和 `models`（`providers.ts:46`）是面向 Web 的、非管理员的对应接口：任何已授权用户都可以读取已启用的供应商 id 和某个供应商的模型（不含密钥）——这些接口支撑 Web 应用中的 agent 创建流程。

## 设计理由

- **独立的受众枚举，而非单张用户表上的角色标志** — 在凭证记录中保留 `kind: "customer" | "staff"` 意味着，即便客户的令牌泄露到了管理后台的源，客户也永远无法登录管理后台；这道门禁设在签发环节，而不仅仅在 procedure 层。
- **每次请求都实时校验封禁状态** — `requireActiveUser` 每次请求都重新读取记录，而不是信任 JWT 的声明。封禁会在下一次 API 调用时立即生效，无需等待 access token 过期。
- **封禁吊销 refresh token，而非 access token** — 没有 access token 黑名单；取而代之的是杀掉所有 refresh token，使新的 access token 无法被换取，而实时的记录校验让现有 access token 在一次请求内失效。简单、无状态、即时。
- **自身/超级管理员删除保护设在 procedure 中，而不仅仅是 UI** — UI 隐藏了按钮，但服务端独立强制执行，因此构造的请求无法绕过它。
- **`createStaff` 是唯一的员工创建路径** — 注册被硬绑定到客户；员工必须由现有管理员配置，这与运营模型一致。
- **凭证加密存储、脱敏列出** — 列表永不返回原始密钥（只返回 `last4`）；原始密钥用 `SecretBox` 封存，仅在实际调用供应商时才在运行时内部解密。
- **在完整列表之上做客户端搜索/分页** — 客户/员工的数据量足够小，抓取全部记录并在 `useListView` 中切片，比服务端分页更简单，且能让带类型的查询缓存极易失效。

## 配置

| 配置项 | 位置 | 默认值 | 说明 |
|------|----------|---------|-------|
| 员工登录受众 | `apps/admin/src/routes/login.tsx:61` | `"staff"` | 硬编码；无法从 UI 修改 |
| 密码最小长度 | `apps/admin/src/routes/login.tsx:12` | 8 | `PASSWORD_MIN`，服务端同步（`auth.ts:32`） |
| 员工分页大小 | `apps/admin/src/routes/users.tsx:16` | 10 | `PAGE_SIZE`，客户端切片 |
| 查询过期时间 | `apps/admin/src/utils/orpc.ts:18` | 60_000 ms | QueryClient 上的 `STALE_TIME_MS` |
| 超级管理员邮箱 | `packages/agent/src/auth/admin.ts:1` | `jacksonw111@gmail.com` | 编译期常量；不可撤销 |
| 管理员邮箱白名单 | `ADMIN_EMAILS` 环境变量 | 空 | 逗号分隔；由 `isAdminEmail` 校验 |
| 数据库管理员标志 | `users.is_admin` 列 | false | 带外提权路径；由 `stores.user.isAdmin` 校验 |
| 公共路径（无需认证） | `apps/admin/src/components/auth-guard.tsx:23` | `/login`, `/auth/verify` | `PUBLIC_PATHS`，跳过重定向 |
| access token 过期时重定向 | `apps/admin/src/utils/orpc.ts` | `/login` | refresh 失败时硬跳转，清理过期状态 |
