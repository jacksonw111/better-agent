# 认证与访问控制

better-agent 的认证横跨两个 SPA（`apps/web` 面向客户、`apps/admin` 面向员工），四种过程门控（`publicProcedure`、`userProcedure`、`adminProcedure`、`agentProcedure`、`bridgeProcedure`），以及三条登录路径（密码、魔法链接、Google OAuth）。访问令牌仅存于内存；刷新令牌持久化在 `localStorage`。邀请门控进一步限制 web 客户端——除非兑换邀请码。相同的 oRPC 链拦截器（401 → 刷新 → 重试 → 重定向到 `/login`）在两个 app 中都运行。

## 架构

```
┌──────────────────────────────────────────────────────────────┐
│  浏览器 (apps/web 或 apps/admin)                                │
│    auth.ts: accessToken (内存) + refreshToken (localStorage)    │
│    orpc.ts: RPCLink → header(Bearer) → 拦截器(401→刷新→重试)     │
│    auth-guard.tsx: AuthBoundary                                  │
│      useAuthBootstrap: 加载时 refresh→setTokens                   │
│      PUBLIC_PATHS 跳过；否则重定向到 /login                       │
│      web: invite.status 门控 → /invite 重定向                     │
│      admin: me.isAdmin 门控 → NotAuthorizedScreen                │
└──────────────────────┬───────────────────────────────────────┘
                       │  Bearer JWT (access) / rt_ (refresh)
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  oRPC 服务端 (packages/api)                                      │
│    Context 解析: authedUser (JWT), authedAgent,                  │
│      authedBridgeToken (bt_ hash 查找)                            │
│    过程门控:                                                      │
│      publicProcedure  — 开放 (auth/refresh/invite)                │
│      userProcedure    — requireActiveUser (拦截封禁用户)           │
│      authorizedUserProcedure — userProcedure + 邀请门控            │
│      adminProcedure   — user + isAdminEmail OR user.isAdmin       │
│      agentProcedure   — agent token (t_)                         │
│      bridgeProcedure  — bridge token (bt_)                       │
│    issueTokens: 唯一签发入口 (password/magic/google/refresh)      │
└──────────────────────────────────────────────────────────────────┘
```

### 认证系统：内存访问令牌 + 持久化刷新令牌

访问令牌从不写入持久存储——它存在于模块级 `let accessToken`（`apps/web/src/utils/auth.ts:5`）。页面刷新后丢失，因此 `useAuthBootstrap`（`auth-guard.tsx:27`）在判断用户是否登录前，先从存储的刷新令牌铸造新的访问令牌。刷新令牌持久化在 `localStorage` 的 `authRefreshToken` 键下（`auth.ts:1`）。

oRPC 链（`apps/web/src/utils/orpc.ts:82`）在每个请求上附加 `authorization: Bearer <accessToken>`。其拦截器捕获代码为 `UNAUTHORIZED` 的 `ORPCError`，执行 `refreshAccessToken`，然后重试原始调用。专用的 `refreshLink`（`orpc.ts:43`）——一个无拦截器的裸 `RPCLink`——调用 `auth.refresh`，使刷新请求本身不会递归进入刷新拦截器。模块级 `refreshInFlight` promise（`orpc.ts:46`）去重并发的 401：所有同时触发的请求等待同一个刷新，然后重试。如果刷新失败，`clearTokens()` 清除状态，`redirectToLogin()` 硬导航到 `/login`（硬导航销毁所有过期的内存状态）。`apps/admin/src/utils/orpc.ts` 逐字段镜像此逻辑。

### 过程类型与 Context 解析

服务端在每次请求时从 bearer 解析主体（`packages/api/src/context.ts`），因此被封禁的用户会立即被拒绝——`requireActiveUser`（`index.ts:34`）对 `blocked` 用户抛出 `FORBIDDEN`，意味着访问令牌在管理员封禁账户的那一刻就失效了。

| 过程 | 门控 | 使用者 |
|-----------|------|---------|
| `publicProcedure` | 无 | `auth.requestLink`, `auth.verify`, `auth.refresh`, `auth.loginWithPassword`, `invite.status`, `invite.redeem`, Google 认证 |
| `userProcedure` | `requireActiveUser` | 大部分 web 数据路由, `auth.me`, `auth.logout` |
| `authorizedUserProcedure` | user + 邀请门控（员工绕过） | Web 客户面向数据路由（非 auth/invite/admin） |
| `adminProcedure` | user + `isAdminEmail` OR `user.isAdmin` | 所有管理后台路由 |
| `agentProcedure` | agent token (`t_`) | Web agent 运行时 |
| `bridgeProcedure` | bridge token (`bt_`) | 本地 CLI 中继面 |

`issueTokens`（`packages/api/src/routers/auth-tokens.ts:13`）是密码、魔法链接、Google、注册和刷新路径的唯一签发入口。它会重新检查 `user.blocked`（因此登录和签发之间的暂停什么也得不到），签 JWT，创建哈希刷新令牌行，并记录 `login` 活动事件。

### 邀请门控

当 authz 服务启用时（`context.services.authz.enabled`），web 客户端必须先兑换邀请码才能访问应用数据。`isWebAuthorized`（`index.ts:68`）将结果缓存在 `webAuthzCache` 中 60 秒，避免每次请求重新验证；员工完全绕过门控。`authorizedUserProcedure`（`index.ts:86`）在数据路由上执行此限制——被邀请门控阻止的用户会收到 `FORBIDDEN: "An invite code is required to use this app"`。

客户端镜像此逻辑：`AuthBoundary`（`apps/web/src/components/auth-guard.tsx:121`）在用户认证后查询 `invite.status`。如果 `required && !authorized`，重定向到 `/invite`。`/invite` 路由（`apps/web/src/routes/invite.tsx`）渲染一个票根表单；`invite.redeem` 调用 `authz.redeem`，乐观地将 `invite.status` 查询缓存更新为 `authorized: true`（这样首页路由的门控不会把它弹回来），然后导航到 `/dashboard`。当 authz 未配置时，邀请门控完全关闭——`isWebAuthorized` 返回 `true`。

### 管理后台认证

管理后台 app 使用相同的 oRPC 客户端和 `AuthBoundary` 模式，但门控更严格：`AuthedContent`（`apps/admin/src/components/auth-guard.tsx:103`）查询 `auth.me`，除非 `me.data.isAdmin` 否则渲染 `NotAuthorizedScreen`。`loginWithPassword` 过程接受 `audience: "customer" | "staff"` 字段（`auth.ts:191`）；管理后台登录表单始终发送 `"staff"`。客户凭据在任何令牌签发前就被 `FORBIDDEN` 拒绝。员工状态由 `cred.kind === "staff"` OR `isAdminEmail(cred.email, adminEmails)` 决定——因此超级管理员邮箱始终是员工，无论数据库 `kind` 值。

`isAdminEmail`（`packages/agent/src/auth/admin.ts:4`）检查两个来源：硬编码的 `SUPER_ADMIN_EMAIL`（`"jacksonwen001@gmail.com"`, `admin.ts:1`）和可配置的 `ADMIN_EMAILS` 白名单（环境变量驱动，通过 `authConfig.adminEmails` 传入）。数据库 `is_admin` 标志是第三条路径，通过 `stores.user.isAdmin(user.id)` 在服务端检查。

### Google OAuth（可选）

Google 登录是可选的——如果 `context.services.googleOAuth` 为 null，`googleAuthUrl` 和 `googleSignIn` 都会抛出 `NOT_FOUND: "Google sign-in is not configured"`。流程使用 OAuth 2.0 授权码 + PKCS 风格的 state：

1. `GoogleButton`（`apps/web/src/components/google-button.tsx:6`）生成 `state = crypto.randomUUID()`，存入 `sessionStorage` 的 `google_oauth_state` 键，获取 `auth.googleAuthUrl`，然后重定向。
2. Google 重定向回 `/auth/google/callback`，带 `code` 和 `state` 查询参数。
3. `GoogleCallbackPage`（`apps/web/src/routes/auth.google.callback.tsx:32`）验证 `state` 与 `sessionStorage` 中的值（不匹配则拒绝），调用 `auth.googleSignIn({ code })`，后者通过 `googleOAuth.exchangeCode` 交换码，要求 `profile.emailVerified`，查找或创建用户，标记邮箱已验证，签发令牌。
4. 成功后 `setTokens(result)`，清除 `sessionStorage` state，导航到 `/`。

## 关键文件

| 文件 | 职责 |
|------|----------------|
| `apps/web/src/utils/auth.ts` | 访问/刷新令牌存储：内存访问令牌，`localStorage` 刷新令牌 |
| `apps/web/src/utils/orpc.ts` | RPCLink 含 401→刷新→重试拦截器, `refreshAccessToken`, `redirectToLogin` |
| `apps/admin/src/utils/auth.ts` | 管理后台的令牌存储副本（与 web 相同） |
| `apps/admin/src/utils/orpc.ts` | 管理后台 oRPC 客户端（镜像 web 的拦截器） |
| `apps/web/src/components/auth-guard.tsx` | `AuthBoundary`：引导、公共路径白名单、邀请门控、Shell 渲染 |
| `apps/admin/src/components/auth-guard.tsx` | 管理后台 `AuthBoundary`：`me.isAdmin` 门控, `NotAuthorizedScreen` |
| `apps/web/src/routes/login.tsx` | 登录/创建账户/魔法链接/忘记密码模式 |
| `apps/web/src/routes/invite.tsx` | 邀请码兑换：票根 UI，乐观缓存更新 |
| `apps/web/src/routes/auth.google.callback.tsx` | Google OAuth 回调：state 验证，码交换，令牌签发 |
| `apps/web/src/components/google-button.tsx` | Google 登录触发：state 生成, `sessionStorage`, 重定向 |
| `packages/api/src/index.ts` | 过程类型：`publicProcedure`, `userProcedure`, `adminProcedure`, `agentProcedure`, `bridgeProcedure`, `authorizedUserProcedure`, `isWebAuthorized` |
| `packages/api/src/routers/auth.ts` | `authRouter`：login/register/refresh/verify/logout/me, 密码重置, 速率限制 |
| `packages/api/src/routers/auth-tokens.ts` | `issueTokens`：唯一签发入口，封禁用户重检，活动日志 |
| `packages/api/src/routers/google-auth.ts` | `googleAuthUrl`, `googleSignIn` 过程 |
| `packages/api/src/routers/invite.ts` | `inviteRouter`：`status` (缓存), `redeem` |
| `packages/agent/src/auth/admin.ts` | `SUPER_ADMIN_EMAIL`, `isAdminEmail` (超级管理员 + 白名单) |

## 数据流

### 登录（密码）

```
LoginPage → orpc.auth.loginWithPassword({email, password, audience:"customer"})
  → enforcePasswordLimits (按 IP + 邮箱限速)
  → findCredentialByEmail → verifyPassword (含 dummy hash 时间守卫)
  → kind/audience 检查 → issueTokens
  → JWT (accessTtl) + rt_ 刷新令牌 (哈希, 存储, refreshTtl)
  → setTokens({accessToken, refreshToken}) → navigate("/")
```

### 页面加载/刷新

```
AuthBoundary 挂载 → useAuthBootstrap
  → loadRefreshToken() 从 localStorage
  → 有: client.auth.refresh({refreshToken}) → setTokens(result) → ready=true
  → 无: ready=true (保持未登录)
  → 刷新失败: 保持未登录 (静默)
AuthBoundary 渲染: getAccessToken() !== null → authed
  → !authed && !public: 重定向到 /login
  → web: invite.status 查询 → 被阻止: 重定向到 /invite
  → admin: auth.me → !isAdmin: NotAuthorizedScreen
```

### 请求中 401（两个 app）

```
RPCLink 拦截器捕获 ORPCError(UNAUTHORIZED)
  → 无 refreshInFlight: refreshAccessToken()
      → refreshClient.auth.refresh (裸链, 无拦截器)
      → setTokens(result) → return true
      → 失败: clearTokens() → return false
  → await refreshInFlight (跨并发 401 去重)
  → ok: 重试 next() (原始请求, 带新 Bearer)
  → !ok: redirectToLogin() → window.location.href = "/login"
```

### 刷新令牌轮换与重用检测

`auth.refresh`（`auth.ts:108`）实现轮换刷新令牌：每次刷新时，提交的令牌被撤销，新令牌被签发。如果**已撤销**的令牌再次被提交（重用），服务端撤销该用户的**所有**令牌（`revokeAllForUser`）并抛出 `UNAUTHORIZED: "Refresh token reuse"`——这是一种防盗令牌响应，锁定该账户的所有会话。

### Google OAuth

```
GoogleButton → state=UUID → sessionStorage → auth.googleAuthUrl → 重定向
Google → /auth/google/callback?code=…&state=…
  → isValidState (sessionStorage 比对) → auth.googleSignIn({code})
  → googleOAuth.exchangeCode → profile.emailVerified 检查
  → findOrCreate → markEmailVerified → issueTokens
  → setTokens → 清除 sessionStorage state → navigate("/")
```

## 设计理由

- **访问令牌仅存内存** — XSS 无法从 `localStorage` 窃取，因为它不在那里。刷新令牌在 `localStorage`，但它是单次使用的（轮换），因此被盗的刷新令牌最多只能交换一次，之后重用检测就会触发。
- **刷新失败时硬重定向到 `/login`** — 硬 `window.location.href` 导航销毁所有过期的内存状态（查询缓存、组件状态），避免 SPA 路由重定向可能留下的"半登录"状态。
- **去重刷新** — `refreshInFlight` 确保当 10 个并发请求同时收到 401 时，只运行一次刷新；其余的等待并用结果令牌重试。
- **裸刷新链** — `refreshLink` 无拦截器，因此刷新调用本身返回 401 时不会递归进入 401→刷新拦截器（令牌无效时确实会发生）。
- **Context 每次请求从数据库解析用户** — `requireActiveUser` 读取 `context.authedUser`，由 context 中间件从 JWT 和数据库查找按请求解析。被封禁的用户立即被拒绝——不需要撤销未过期的 JWT；数据库检查就是终止开关。
- **员工/客户 audience 分离** — `loginWithPassword` 的 `audience` 字段在令牌签发层（任何令牌存在之前）阻止客户登录管理后台，反之亦然。超级管理员邮箱绕过此限制，始终为员工。
- **三条管理员路径** — 硬编码超级管理员（引导）、环境变量白名单（运维管理）、数据库标志（运行时授予）。管理员配置无单点故障。
- **未配置时邀请门控关闭** — `isWebAuthorized` 在 `authz.enabled` 为 false 时返回 `true`，因此在不使用邀请码的部署中门控是空操作。员工始终绕过。
- **乐观邀请缓存更新** — `invite.redeem` 的 `onSuccess` 在导航前将 `invite.status` 查询缓存设为 `authorized: true`，这样首页路由的门控不会读到过期缓存把用户弹回 `/invite`。
- **Google state 存在 sessionStorage** — CSRF 保护：随机 `state` 值证明回调来自我们发起的 Google 重定向，而非伪造的跨站请求。`sessionStorage`（非 `localStorage`）将其限定在标签页内，使用后清除。

## 配置

| 配置项 | 位置 | 默认值 | 备注 |
|------|----------|---------|-------|
| 访问令牌 TTL | `authConfig.accessTtl` | (env `ACCESS_TOKEN_TTL`) | 秒, 传入 `jwtService.sign` |
| 刷新令牌 TTL | `authConfig.refreshTtl` | (env `REFRESH_TOKEN_TTL`) | 秒, 存为刷新行的 `expiresAt` |
| 刷新令牌 localStorage 键 | `apps/web/src/utils/auth.ts:1` | `authRefreshToken` | `REFRESH_KEY` 常量 |
| 魔法链接 TTL | `authConfig.magicLinkTtl` | (env) | 秒; 链接邮件带 `?token=ml_…` |
| 密码重置 TTL | `auth.ts:28` `RESET_TTL_MS` | 3600000 (1h) | 密码重置链接 `?token=pr_…` |
| 密码最小长度 | `auth.ts:32` `PASSWORD_MIN` | 8 | 在 `passwordInput` zod schema 中强制 |
| 超级管理员邮箱 | `packages/agent/src/auth/admin.ts:1` | `jacksonwen001@gmail.com` | `SUPER_ADMIN_EMAIL`, 硬编码 |
| 管理员邮箱白名单 | `authConfig.adminEmails` | (env `ADMIN_EMAILS`) | 逗号分隔, 不区分大小写 |
| Google OAuth | `context.services.googleOAuth` | null (禁用) | 配置后: `authUrl`, `exchangeCode` |
| Google state 存储 | `google-button.tsx:8` | `sessionStorage["google_oauth_state"]` | 回调成功后清除 |
| 速率限制 (15 分钟窗口) | `auth.ts:21-29` | link: 5/邮箱, 20/IP; verify: 10/IP; refresh: 30/IP; password: 10/邮箱, 20/IP; reset: 5/邮箱, 20/IP | 按 `RateLimiter.hit` |
| Web authz 缓存 TTL | `index.ts:63` `AUTHZ_TTL_MS` | 60000 (60s) | 邀请门控结果缓存在 `webAuthzCache` |
| 公共路径 (web) | `auth-guard.tsx:17` | `/login`, `/auth/verify`, `/auth/google/callback`, `/reset-password` | `PUBLIC_PATHS` |
| 公共路径 (admin) | `auth-guard.tsx:23` | `/login`, `/auth/verify` | `PUBLIC_PATHS` |
| 查询过期时间 | `orpc.ts:17` `STALE_TIME_MS` | 60000 (60s) | TanStack Query 默认过期时间 |
