# M0／M1 开发、运行与验证

更新：2026-10-22。本文记录真实应用实现，长期产品目标仍见 [实施清单](implementation-plan.md)。OpenDesign 复用范围见 [迁移记录](prototype-reuse.md)。

## 已实现范围

Vue 网站：本人登录、行程分页列表、新建多目的地和多日计划、概览、每日地点、时间／交通／角色／备注、当天地区／日期／住宿、增减空日期、排序／跨日移动／移除、行程备注、旅程元数据和状态、退出登录。

数据保存在本机专用 MySQL。路线版本和旅程基本信息版本独立；命令批次事务保存、幂等重试、最近 50 个路线版本快照、用户归属和可撤销会话已实现。本机草稿保存于 localStorage，按用户、路线和页面标识区分；同一页面刷新恢复。草稿没有跨设备同步，清理浏览器数据会丢失未提交内容。冲突保留草稿，可下载 JSON、核对后加载最新服务器版本，**尚无自动合并／草稿导入工具**。

新建表单需点击“开始安排”才入库；离开未创建表单会提示确认，暂未提供新建表单草稿恢复。地点、日期与备注弹窗确认后加入待提交批次，再点底部“保存行程”。旅程基本信息由独立保存提交；标记完成仅更新状态。

地图、轨迹生成、图文日记、照片上传、实际路线、到访、分享、思源导入、AI 与独立管理端尚未实现；现有地图验证结果没有被包装为正式服务。

## 技术与目录

- Node.js 24；Vue 3.5、Vue Router 4.6、Vite 8.3；不引入首阶段用不到的状态库或整套 UI 库。
- Fastify 5.12 + TypeBox JSON Schema；Drizzle 0.45 + mysql2 3.24。精确版本在 `package-lock.json`。
- `frontend/`：原型复用样式与 Vue 页面；`backend/src/`：API、身份、仓库、迁移及 CLI。
- `packages/contracts/src/`：共享类型、日期／目的地规则与路线命令。
- `backend/drizzle/`：提交审核的 SQL 与生成元数据；当前首迁移合并建立 M1 的 9 张业务表。
- `data/`：忽略提交的本机验证输出；`frontend/dist/` 与根 `dist/` 为构建产物。

密码使用独立的网站密码和 scrypt 哈希，HttpOnly／SameSite 会话 Cookie + Origin／CSRF 检查。后端不返回 SQL／连接异常原文；配置只在后端加载。初始化不提供公网注册，也不会重置已有账号。

## 本机运行

在项目根目录：

```bash
npm ci
npm run db:migrate
npm run user:init
npm run dev
```

首次 `user:init` 在无账号时生成网站密码，保存在 `.env` 的 `ADMIN_USERNAME`／`ADMIN_PASSWORD`；命令不打印密码。这与 MySQL 用户／密码完全独立。已有账号时只报告存在，不重置。

- Vue 开发／预览：`http://127.0.0.1:5178`。
- API：`http://127.0.0.1:3080`。前端代理 `/api` 和 `/health`，登录使用同源 Cookie。
- 默认仅监听回环地址，不会因此获得外网访问入口；SSH 转发示例：`ssh -L 5178:127.0.0.1:5178 <服务器>`。
- `npm run build` 后，分别运行 `npm run start:api` 与 `npm run preview` 可验证构建结果。Vite preview 用于本机检查，正式静态资源交给 Nginx。
- 后端源码监听和前端 HMR：`npm run dev:api`／`npm run dev:web`。不需要安卓 SDK 或安卓包。

## Nginx／OpenResty 接入

[示例配置](../deploy/nginx.conf.example) 指向 `frontend/dist`，同域反向代理 API，SPA 路由回退到 `index.html`。

2026-10-22：用户已在面板配置 `travel.yiqu.love` 转发到 `127.0.0.1:5178`。排查 502 时发现前后端临时进程均已退出；恢复后按用户要求使用 screen 托管，不采用 systemd。该轮没有修改用户的 OpenResty 配置。域名首页与健康检查返回 200；反代登录／退出已验证。浏览器来源白名单补齐该域名的 HTTP／HTTPS；Vite 仅额外允许该域名 Host，没有开放全部 Host。

实际接入时用网站的精确协议／主机／端口填写 `.env` 中的 `APP_ORIGINS`；HTTPS 对外站点设置 `COOKIE_SECURE=true`。本机纯 HTTP 预览使用 false。Nginx 配置检查、域名、TLS、常驻进程与备份恢复归部署阶段；网站不需要打包安卓。

### screen 预览会话

目前会话：`travel-atlas-web`（5178）与 `travel-atlas-api`（3080），均为 detached；不依赖聊天或 SSH 前台会话。日志在被忽略的 `data/runtime/*.screen.log`。screen 不提供机器重启后的自动启动或应用崩溃自动恢复。

```bash
screen -ls
screen -r travel-atlas-web
screen -r travel-atlas-api
```

进入后按 **Ctrl+A，再按 D** 分离，保持进程运行；Ctrl+C 会停止应用。停止指定会话使用 `screen -S travel-atlas-web -X quit`／`screen -S travel-atlas-api -X quit`。不要关闭其他项目会话。

需要重新启动时，先确认对应会话和端口已经退出，再在项目根目录执行：

```bash
umask 077
mkdir -p data/runtime
screen -dmS travel-atlas-api -L -Logfile /opt/projects/travel-journal/data/runtime/api.screen.log /usr/bin/node /opt/projects/travel-journal/dist/backend/src/server.js
screen -dmS travel-atlas-web -L -Logfile /opt/projects/travel-journal/data/runtime/web.screen.log /bin/bash -c 'cd /opt/projects/travel-journal/frontend && exec env __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=travel.yiqu.love /usr/bin/node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5178 --strictPort'
```

更新前端执行构建后重开前端会话；更新后端构建后重开 API 会话。此前临时添加的 `travel-atlas-*` systemd 服务已停用并删除，不保留开机启动项。

## 迁移与测试隔离

1. `npm run db:generate` 根据 schema 生成 SQL；先审阅，再运行迁移。
2. 迁移账本保存 SQL 校验值与 `applying/applied` 状态；MySQL DDL 不可事务回滚，失败或文件变动时中止，需检查后修复，不盲目重复执行。
3. 当前账号只有专用库权限，测试使用同一专用库内随机 `tjt_<8位随机十六进制>_` 表名，复用同一 SQL 的受控重命名版本；结束后仅清理该前缀表。此方案替代原建议的独立测试数据库，不需要扩大授权。
4. 正式表迁移与初始化通过 CLI 执行，服务器启动不自动改表。未来有业务数据的迁移先备份，不能清库重建。

```bash
npm run typecheck
npm test
npm run build
```

后端集成验证使用真实 MySQL 临时表，包含认证／CSRF／来源、越权、空日期和未定位、多目的地、重复地名、移动保留字段、幂等冲突、整批回滚、并发版本冲突、应用重建后会话恢复、退出撤销，以及关闭独立测试连接池模拟服务失败。不会停止共享 MySQL 服务。

浏览器回归脚本 `scripts/browser-check.ts` 使用相同隔离策略，临时启动 3080／5178，结束后关闭；执行前需构建且端口空闲。Playwright／Chromium 可由本机工具环境提供，通过 `PLAYWRIGHT_MODULE`／`CHROME_PATH` 指定；没有将 OpenDesign 安装目录写成项目依赖。运行命令为 `npm run test:browser`；验证结果与截图存 `data/browser-check/`，不提交含个人内容的运行数据。

## 本轮验证状态

2026-10-21：后端真实 MySQL 集成测试 10 项通过（9 个子场景加总测试）；Vue 与后端类型检查、生产构建通过。浏览器 10 组流程通过，覆盖 1280px 桌面、320px／390px 手机尺寸；没有 pageerror。修复过弹窗关闭后的焦点恢复问题。

隔离测试表已清理；正式专用库迁移完成，建立 9 张业务表与迁移账本，初始化本人账号，没有导入测试旅程。构建版 API／Vue 已在回环 3080／5178 启动，并用本人账号通过真实代理登录、空列表与退出检查。前端首包约 134kB JS／46kB CSS（gzip 约 50kB／10kB，不含 HTTP 开销）。

真机键盘、真实手机浏览器、生产网络、公开部署、备份恢复均不属于本轮验收。

## 版本管理

2026-10-22：用户授权初版提交与推送，目标为公开仓库 [767299026/travel-atlas](https://github.com/767299026/travel-atlas)，采用远程默认分支 `master`。初版包含 M0／M1 代码、数据库迁移、依赖锁文件、来源说明与设计／验证文档；私密 `.env`、依赖目录、构建产物、运行数据、日志和备份不进入提交。初次发布使用 GitHub 插件，服务端 Git 与远程提交同步；插件授权与服务器命令行的 Git 推送认证分别管理。

## 实现依据

- [Fastify 请求校验](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)
- [Drizzle MySQL](https://orm.drizzle.team/docs/mysql/get-started-mysql)
- [OWASP 密码存储参数](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

依赖于 2026-10-21 查询可用版本并锁定；实现兼容性由本轮类型检查、构建和集成验证确认。
