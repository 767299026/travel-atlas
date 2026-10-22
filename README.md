# 迹屿 · 旅行记录与路线知识库

面向中国国内旅行与徒步，长期维护路线资料、行程规划、路线补绘和图文日记，并逐步加入基于个人资料的 AI 问答。

当前阶段：已基于 OpenDesign v4 源码完成 M0／M1 私有行程网站，支持登录、多日地点编辑、MySQL 保存和本机草稿。图文、地图、分享和 AI 按后续里程碑加入。当前已提供域名预览，正式上线验收尚未完成。

从 [文档索引](docs/README.md) 进入设计与技术资料；用户确认的选择和待验证建议见 [决策记录](docs/decisions.md)。最近整理：2026-10-22。

## 已确定技术方向

- 前端：Vue 3 + Vite + TypeScript，优先适配手机浏览器。
- 后端：Node.js + TypeScript，提供独立业务 API。
- 数据库：复用本机 MySQL，使用专属数据库和账号。
- 客户端：先做网站，预留 Capacitor 安卓打包。
- 核心使用场景：出发前在线规划、回来后图文记录，无离线地图需求。
- 管理端：独立 Web 页面，承担用户、资料与服务配置管理。

后端已采用 Fastify + TypeBox、Drizzle + mysql2；地图供应商、图片存储和 AI 模型仍待验证，依据见 [技术方案](docs/technical-plan.md)。

## 目录

- `frontend/`：Vue 网页、复用原型样式与手机适配。
- `backend/`：Fastify API、身份、MySQL 仓库与迁移；思源和 AI 后续加入。
- `docs/`：产品、原型、提示词、技术选型、数据源、验证计划和决策记录。
- `packages/contracts/`：共享类型与路线命令规则。
- `scripts/`：本机开发与浏览器验证。
- `.env`：本机私密配置，禁止提交；变量说明见 `.env.example`。

前后端使用同一仓库。前端构建为静态资源，由反向代理提供访问；后端作为独立服务运行。

使用端与管理端独立构建、共用业务后端是当前建议架构；管理端代码目录在实施时确定。

## 配置

本机 `.env` 保存思源、高德、MySQL 与网站登录配置，权限为 `600`；仅后端加载，不进入前端包。新环境复制 `.env.example` 并填写值。

2026-10-21 已完成真实 MySQL 迁移、9 张业务表和迁移账本、本人账号初始化；测试数据使用隔离前缀表并已清理。业务库未导入演示旅程。网站账号见 `.env` 的 `ADMIN_USERNAME`／`ADMIN_PASSWORD`，与数据库密码独立。

## 开发与预览

```bash
npm ci
npm run db:migrate
npm run user:init
npm run dev
```

默认 Vue 为 `http://127.0.0.1:5178`，API 为 `http://127.0.0.1:3080`；构建使用 `npm run build`，静态资源在 `frontend/dist`，可交给 Nginx。当前没有修改既有 OpenResty 配置，不需要安卓包。

2026-10-22：用户已配置 `travel.yiqu.love` 反代；前后端现使用 `travel-atlas-web`／`travel-atlas-api` 两个 screen 会话托管。访问与会话操作见开发说明。

运行、测试与限制见 [开发说明](docs/development.md)，原型源码复用见 [迁移记录](docs/prototype-reuse.md)，Nginx 配置见 [示例](deploy/nginx.conf.example)。

## 数据原则

- 路线模板、出行计划、实际出行和日记分别建模。
- GPS 实录、导入参考、路网规划、手工补绘均保留来源，展示时明确区分。
- 初期只读取指定思源文档及其子文档，导入内容默认私有。
- 原始笔记、提取结果和人工修订分开保存，避免同步覆盖修改。
- 秘钥仅后端使用；公开分享不能间接暴露思源私密资料。

## 来源与许可

原型复用范围见 [迁移记录](docs/prototype-reuse.md)；Open Design 布局与地图验证样本的上游来源和许可见 [第三方说明](THIRD_PARTY_NOTICES.md)。
