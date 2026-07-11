# 部署与持续集成/持续部署

better-agent 以三个可独立部署的目标交付：用于单服务器部署的自托管 Docker Compose 栈、用于生产的 k3s + kustomize 栈，以及用于 authz + mcp 边缘服务的 Cloudflare Workers。GitHub Actions 负责构建镜像、部署 Workers 并发布 bridge CLI。

## 架构

```
GitHub (dev push) ──▶ build-images.yml ──▶ ghcr.io/{server,web,admin}
                  ──▶ deploy-test.yml  ──▶ Cloudflare Workers (authz, mcp)

GitHub (main push) ──▶ deploy-prod.yml
                        ├─ build matrix → ghcr (sha + latest)
                        ├─ kubectl + sops/age → decrypt secrets, apply
                        ├─ pin images to sha via kustomize edit
                        ├─ migrate Job (gate) → wait for complete
                        └─ kubectl apply -k overlays/prod → rollout

GitHub (cli-v* tag) ──▶ release-cli.yml ──▶ 4 Bun --compile binaries
                                           + install.sh → GitHub Release
```

这种拆分是刻意为之的：有状态服务（postgres、redis、server、web、admin）运行在运维方控制的服务器上（小型部署用 Docker Compose，生产用 k3s），而无状态边缘服务（authz 邀请门禁、mcp 工具代理）则留在它们被开发出来的 Cloudflare Workers 上。

## 关键文件

| 文件 | 职责 |
|------|----------------|
| `deploy/compose/docker-compose.yml` | 单服务器栈：pgvector/pg18、redis、来自 ghcr 的 server/web/admin、一次性 migrate、Caddy |
| `deploy/compose/Caddyfile` | 带 auto-HTTPS 的反向代理，面向 api/web/admin 域名 |
| `deploy/k8s/base/server.yaml` | Server Deployment（2 副本，反亲和）+ Service |
| `deploy/k8s/base/web.yaml` / `admin.yaml` | Web/Admin Deployments + Services |
| `deploy/k8s/base/postgres.yaml` | Postgres StatefulSet（固定到一个节点），10Gi PVC |
| `deploy/k8s/base/redis.yaml` | Redis Deployment + Service |
| `deploy/k8s/base/migrate-job.yaml` | 一次性迁移 Job（由 CI 在 rollout 之前单独应用） |
| `deploy/k8s/base/ingress.yaml` | 三个公共域名的 Ingress |
| `deploy/k8s/base/backup-cronjob.yaml` | 定时 pg 备份 |
| `deploy/k8s/base/kustomization.yaml` | 基础资源列表（migrate 除外 — 单独应用） |
| `deploy/k8s/overlays/prod/kustomization.yaml` | 生产 overlay：configMap 字面量、镜像钉定、postgres nodeSelector 补丁 |
| `deploy/k8s/overlays/prod/cert-issuer.yaml` | 生产 cert-manager issuer |
| `deploy/secrets/prod.secrets.example.yaml` | `app-secrets` Secret 的明文模板（用 sops 原地加密） |
| `.github/workflows/build-images.yml` | dev 分支：类型校验门禁 + 构建/推送 server/web/admin 到 ghcr |
| `.github/workflows/deploy-test.yml` | dev 分支：部署 mcp + authz Workers（authz 迁移 + 播种管理员） |
| `.github/workflows/deploy-prod.yml` | main 分支：构建、sops 解密密钥、迁移、kustomize rollout |
| `.github/workflows/release-cli.yml` | `cli-v*` 标签：Bun --compile 4 个二进制 + install.sh → GitHub Release |
| `apps/bridge-cli/install.sh` | 安装器：平台检测、公开/令牌下载、安装到 ~/.better-agent/bin、PATH 提示 |

## 数据流

### Docker Compose（自托管）

`deploy/compose/docker-compose.yml` 是小型部署路径。镜像**从不在此处构建** — 服务器内存受限，会 OOM — 它们在 `build-images.yml` 发布之后从 ghcr 拉取。

启动顺序通过健康门禁强制保证：

1. **postgres**（`pgvector/pgvector:pg18`）— 健康检查 `pg_isready`。PG18+ 镜像使用带版本号的 `pg_ctlcluster` 布局，因此卷挂载在父目录 `/var/lib/postgresql`（而非 `/data`）；`PGDATA` 刻意不设置，以便 PG18 使用其带版本号的默认值。
2. **redis**（`redis:7.4-alpine`，appendonly）— 健康检查 `redis-cli ping`。
3. **migrate** — 复用 server 镜像，带 `SKIP_ENV_VALIDATION=1` 运行 `node dist/migrate.mjs`（migrate 只需要 `DATABASE_URL`），`depends_on.postgres.condition: service_healthy`，`restart: "no"`。
4. **server** — `depends_on.migrate.condition: service_completed_successfully` 且 redis 健康。
5. **web** / **admin** — 依赖 server。
6. **caddy** — 依赖全部三个应用；服务 80/443，auto-HTTPS，按 `API_DOMAIN`/`WEB_DOMAIN`/`ADMIN_DOMAIN` 路由。

authz 和 mcp 留在 Workers 上；server 通过它们的公共 URL（`AUTHZ_URL`、用户配置的 MCP server URL）访问它们。

### CI：`build-images.yml`（dev → ghcr）

在推送到 `dev` 时触发。两个作业：

1. **check** — 全 monorepo 的 `pnpm check-types`。每个镜像的 Docker 构建只编译自己的应用，因此这道门禁防止一个损坏的类型被烘焙进已发布的镜像。
2. **images** — `{server, web, admin}` 的矩阵。每个用 `deploy/docker/{server,app}.Dockerfile`（`APP` + `VITE_SERVER_URL` 构建参数）构建，推送两个标签（`latest` + `${{ github.sha }}`），并使用按应用划分作用域的 GHA 构建缓存。

### CI：`deploy-test.yml`（dev → Workers）

两个并行作业（mcp、authz），各自 `pnpm install --frozen-lockfile` 然后部署：

- **mcp** — 运行 `pnpm -F mcp test`，然后从 `apps/mcp` 执行 `wrangler deploy`。
- **authz** — 迁移自己的数据库（`drizzle-kit migrate`），播种管理员（`tsx src/seed-admin.ts`），构建 SPA，然后带密钥（`AUTHZ_DATABASE_URL`、`AUTHZ_JWT_SECRET`、`AUTHZ_SERVICE_SECRET`、`MAIN_SERVER_URL`）执行 `wrangler deploy`。

### CI：`deploy-prod.yml`（main → k3s）

在推送到 `main` 时触发。两个作业，严格有序：

1. **build** — 与 `build-images.yml` 相同的矩阵，将 `${sha}` + `latest` 标签推到 `ghcr.io/<owner>/better-agent-{server,web,admin}`。
2. **deploy**（依赖 build）：
   1. 将 `PROD_KUBECONFIG` 密钥写入 `~/.kube/config`。
   2. **解密并应用密钥**：下载 sops，`kubectl apply` 命名空间，然后用 `SOPS_AGE_KEY` 执行 `sops -d deploy/secrets/prod.secrets.yaml | kubectl apply -f -`。密钥在静态存储时用 age 加密，从不以明文存在于磁盘或 git 中。
   3. **将镜像钉定到此 sha**：`kustomize edit set image` 将 `overlays/prod/kustomization.yaml` 中的三个镜像引用从 `OWNER` 占位符改写为 `${IMAGE_PREFIX}-<name>:${sha}`。
   4. **迁移门禁**：删除任何过期的 `migrate` Job，用 sed 将 migrate Job 的镜像改为此 sha，应用，并 `kubectl wait --for=condition=complete --timeout=180s`。若迁移失败，会打印作业日志并让工作流出错 — **迁移失败时不会发生 rollout**。
   5. **Rollout**：`kubectl apply -k overlays/prod`，然后对 server/web/admin 各执行 `rollout status`（各 180s 超时）。

`concurrency.group: deploy-prod` 配合 `cancel-in-progress: false` 串行化生产部署，这样两次推送不会在迁移门禁上竞争。

### Bridge CLI 发布

`release-cli.yml` 在 `cli-v*` 标签时触发。`bun build --compile` 将 Bun 运行时嵌入一个自包含的二进制，因此用户机器上无需 Node.js/npm。在循环中构建四个目标，每个目标同时以规范名 `agent-cli-*` 和 0.2.0 之前的别名 `better-agent-bridge-*` 发布，使现有安装脚本继续可用：

| 目标 | 产物 |
|--------|--------|
| `bun-darwin-arm64` | `agent-cli-darwin-arm64`（+ `better-agent-bridge-darwin-arm64`） |
| `bun-darwin-x64` | `agent-cli-darwin-x64`（+ `better-agent-bridge-darwin-x64`） |
| `bun-linux-x64` | `agent-cli-linux-x64`（+ `better-agent-bridge-linux-x64`） |
| `bun-linux-arm64` | `agent-cli-linux-arm64`（+ `better-agent-bridge-linux-arm64`） |

`gh release create` 附上全部八个二进制以及 `apps/bridge-cli/install.sh`，并附带生成的说明。

### `install.sh`

安装器（`apps/bridge-cli/install.sh`）检测操作系统（darwin/linux）和架构（x64/arm64），然后通过一个公开/私有分支解析下载 URL：

- **公开仓库 / 无令牌** — `releases/latest/download/<asset>` 快捷方式无需认证即可工作。
- **私有仓库 / 设置了 `GITHUB_TOKEN`** — 该快捷方式对所有人都返回 404；安装器通过已认证的 API（先用 `python3`，回退到 `grep`）解析 asset id，并通过 octet-stream 端点抓取。

它安装到 `~/.better-agent/bin`（用 `INSTALL_DIR` 覆盖），`chmod +x`，并为安装目录尚不在 `PATH` 上的 zsh/bash 用户打印 PATH 提示。PATH 预检很重要，因为 bridge CLI 会派生 agent CLI（例如 `claude-code`），这些 CLI 自身必须位于 `PATH` 上。

## 设计理由

- **镜像在 CI 中构建，从不在服务器上构建** — 自托管服务器内存受限；在上面构建 monorepo 会 OOM。Compose 只做 `pull`；CI 拥有构建。
- **迁移作为一次性门禁** — 在 Compose 中它是一个 `service_completed_successfully` 依赖；在 k3s 中它是一个工作流在 rollout 之前等待的 Job。无论哪种方式，失败的迁移都会阻塞部署，而不是发布一个 schema 不匹配的 server。
- **用 sops + age 管理生产密钥** — 密钥在 git 中静态加密，仅在 CI 运行内部解密（通过 `SOPS_AGE_KEY`）。从不提交明文密钥文件。
- **镜像钉定到 sha，而非 `latest`** — 生产 overlay 被改写为提交 sha，因此回滚就是 `git revert` + 重新部署，且部署可复现。`latest` 是一个便利标签，不是生产中的真实来源。
- **PG18 卷挂载在父目录** — PG18+ 的 `pg_ctlcluster` 布局将数据放在带版本号的子目录中；挂载父目录避免了破坏并为就地大版本升级留出空间。基础 k8s 清单仍使用 PG16 并带显式 `PGDATA`（全新卷，无迁移），因此两条部署路径相互独立。
- **无状态边缘用 Workers，有状态核心用 server** — authz（邀请门禁）和 mcp（工具代理）是无状态的或拥有自己的数据库，并从 Workers 的全球边缘中受益；核心（postgres、sessions、agents）需要一个单一的有状态归属。
- **CLI 用 Bun `--compile`** — 每个平台一个自包含二进制意味着安装体验是 `curl | bash` 且零运行时前提条件，而 PATH 预检是唯一的设置摩擦。
- **公开/私有安装分支** — 同一个 `install.sh` 既适用于公开仓库（无令牌，快捷 URL）也适用于私有仓库（令牌 + API asset 查找），因此当可见性改变时无需 fork 安装器。

## 配置

| 配置项 | 位置 | 默认值 | 说明 |
|------|----------|---------|-------|
| Compose PG 镜像 | `deploy/compose/docker-compose.yml:25` | `pgvector/pgvector:pg18` | 用于记忆嵌入的 pgvector |
| Compose PG 卷挂载 | `deploy/compose/docker-compose.yml:32` | `/var/lib/postgresql` | 父目录 — PG18 带版本号布局 |
| Compose 镜像标签 | `deploy/compose/docker-compose.yml:54` | `${IMAGE_TAG:-latest}` | 覆盖以钉定一个 sha |
| k8s server 副本数 | `deploy/k8s/base/server.yaml:7` | 2 | 带 pod 反亲和 |
| k8s postgres 存储 | `deploy/k8s/base/postgres.yaml:46` | 10Gi | `volumeClaimTemplates` |
| k8s postgres 镜像 | `deploy/k8s/base/postgres.yaml:18` | `postgres:16.6-alpine` | 显式 `PGDATA=/var/lib/postgresql/data/pgdata` |
| 生产镜像标签 | `deploy/k8s/overlays/prod/kustomization.yaml:20` | `latest` | 由 CI 的 `kustomize edit set image` 改写为 sha |
| 生产 postgres 节点钉定 | `deploy/k8s/overlays/prod/kustomization.yaml:28` | `NODE1_HOSTNAME` | local-path 卷是节点本地的 |
| 迁移超时 | `.github/workflows/deploy-prod.yml:96` | 180s | `kubectl wait --for=condition=complete` |
| Rollout 超时 | `.github/workflows/deploy-prod.yml:102` | 180s | 每个部署 |
| 并发（生产） | `.github/workflows/deploy-prod.yml:9` | `deploy-prod`, `cancel-in-progress: false` | 串行化部署 |
| CLI 发布标签模式 | `.github/workflows/release-cli.yml:13` | `cli-v*` | 触发发布工作流 |
| CLI 安装目录 | `apps/bridge-cli/install.sh:16` | `~/.better-agent/bin` | 用 `INSTALL_DIR` 覆盖 |
| CLI owner/repo | `apps/bridge-cli/install.sh:14` | `jacksonw111/better-agent` | 用 `OWNER_REPO` 覆盖 |
