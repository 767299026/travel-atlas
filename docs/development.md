# M0–M2 开发、运行与验证

更新：2026-10-22。本文记录真实应用实现，长期产品目标仍见 [实施清单](implementation-plan.md)。OpenDesign 复用范围见 [迁移记录](prototype-reuse.md)。

## 已实现范围

Vue 网站：本人登录、行程分页列表、新建多目的地和多日计划、概览、每日地点、时间／交通／角色／备注、当天地区／日期／住宿、增减空日期、排序／跨日移动／移除、行程备注、旅程元数据和状态、退出登录。

数据保存在本机专用 MySQL。路线版本和旅程基本信息版本独立；命令批次事务保存、幂等重试、最近 50 个路线版本快照、用户归属和可撤销会话已实现。本机草稿保存于 localStorage，按用户、路线和页面标识区分；同一页面刷新恢复。草稿没有跨设备同步，清理浏览器数据会丢失未提交内容。冲突保留草稿，可下载 JSON、核对后加载最新服务器版本，**尚无自动合并／草稿导入工具**。

新建表单需点击“开始安排”才入库；离开未创建表单会提示确认，暂未提供新建表单草稿恢复。地点、日期与备注弹窗确认后加入待提交批次，再点底部“保存行程”。旅程基本信息由独立保存提交；标记完成仅更新状态。

M2 已增加计划复制／空实际记录、实际路线独立编辑、手动到访、私密图文日记与独立管理端。正文使用纯文本，照片可排序、说明与删除；日记本机草稿和版本冲突不静默覆盖。详见 [M2 范围、限制与验收](m2-records.md)。

地图、轨迹生成、分享、思源导入、AI 尚未实现；现有地图验证结果没有被包装为正式服务。照片格式暂为静态 JPG／PNG／WebP；真实手机相册样本尚待验收。

## 技术与目录

- Node.js 24；Vue 3.5、Vue Router 4.6、Vite 8.3；不引入首阶段用不到的状态库或整套 UI 库。
- Fastify 5.12 + TypeBox JSON Schema；Drizzle 0.45 + mysql2 3.24。精确版本在 `package-lock.json`。
- `frontend/`：原型复用样式与 Vue 页面；`admin/`：独立 Vue 管理端；`backend/src/`：API、身份、仓库、迁移及 CLI。
- `packages/contracts/src/`：共享类型、日期／目的地规则与路线命令。
- `backend/drizzle/`：SQL 与生成元数据；`0000` 建立 M1 的 9 张表，`0001` 为 M2 增量迁移，新增 5 张表与复制来源／用户版本字段。
- 图片处理使用 Sharp 0.35.5、multipart 10.1.4；原图、阅读图和缩略图位于私有 `MEDIA_ROOT`，默认 `data/media`。配额和限制见 M2 文档及 `.env.example`。
- `data/`：忽略提交的本机内容、验证、日志、备份与旧构建；`frontend/dist/`、`admin/dist/` 与根 `dist/` 为构建产物。

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
- 管理端开发／预览：`http://127.0.0.1:5179`，分别使用 `npm run dev:admin`／`npm run preview:admin`，仅管理员可用。
- API：`http://127.0.0.1:3080`。前端代理 `/api` 和 `/health`，登录使用同源 Cookie。
- 默认仅监听回环地址，不会因此获得外网访问入口；SSH 转发示例：`ssh -L 5178:127.0.0.1:5178 <服务器>`。
- `npm run build` 后，分别运行 `npm run start:api` 与 `npm run preview` 可验证构建结果。Vite preview 用于本机检查，正式静态资源交给 Nginx。
- 后端源码监听和前端 HMR：`npm run dev:api`／`npm run dev:web`。不需要安卓 SDK 或安卓包。

管理端保持独立入口；本机访问白名单包含 5179。远程访问可使用 `ssh -L 5179:127.0.0.1:5179 <服务器>` 后在自己电脑打开 `http://127.0.0.1:5179`。未来单独配置域名时，同步添加精确 `APP_ORIGINS`，无需把后台加入主站。

## Nginx／OpenResty 接入

[示例配置](../deploy/nginx.conf.example) 指向 `frontend/dist`，同域反向代理 API，SPA 路由回退到 `index.html`。

2026-10-22：用户已在面板配置 `travel.yiqu.love` 转发到 `127.0.0.1:5178`。排查 502 时发现前后端临时进程均已退出；恢复后按用户要求使用 screen 托管，不采用 systemd。该轮没有修改用户的 OpenResty 配置。域名首页与健康检查返回 200；反代登录／退出已验证。浏览器来源白名单补齐该域名的 HTTP／HTTPS；Vite 仅额外允许该域名 Host，没有开放全部 Host。

实际接入时用网站的精确协议／主机／端口填写 `.env` 中的 `APP_ORIGINS`；HTTPS 对外站点设置 `COOKIE_SECURE=true`。本机纯 HTTP 预览使用 false。Nginx 配置检查、域名、TLS、常驻进程与备份恢复归部署阶段；网站不需要打包安卓。

### screen 预览会话

目前三个 detached 会话：`travel-atlas-web`（5178）、`travel-atlas-api`（3080）和 `travel-atlas-admin`（5179）；不依赖聊天或 SSH 前台会话。日志在被忽略的 `data/runtime/*.screen.log`。screen 不提供机器重启后的自动启动或应用崩溃自动恢复。

```bash
screen -ls
screen -r travel-atlas-web
screen -r travel-atlas-api
screen -r travel-atlas-admin
```

进入后按 **Ctrl+A，再按 D** 分离，保持进程运行；Ctrl+C 会停止应用。停止指定会话使用 `screen -S travel-atlas-web -X quit`／`screen -S travel-atlas-api -X quit`。不要关闭其他项目会话。

需要重新启动时，先确认对应会话和端口已经退出，再在项目根目录执行：

```bash
umask 077
mkdir -p data/runtime
screen -dmS travel-atlas-api -L -Logfile /opt/projects/travel-journal/data/runtime/api.screen.log /usr/bin/node /opt/projects/travel-journal/dist/backend/src/server.js
screen -dmS travel-atlas-web -L -Logfile /opt/projects/travel-journal/data/runtime/frontend.screen.log /bin/bash -c 'cd /opt/projects/travel-journal && exec env __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=travel.yiqu.love /usr/bin/node scripts/preview.mjs frontend'
screen -dmS travel-atlas-admin -L -Logfile /opt/projects/travel-journal/data/runtime/admin.screen.log /bin/bash -c 'cd /opt/projects/travel-journal && exec /usr/bin/node scripts/preview.mjs admin'
```

更新前端执行构建后重开对应会话；更新后端构建后重开 API 会话。`scripts/preview.mjs` 按工作区解析 Vite，兼容 npm 依赖提升。此前临时添加的 `travel-atlas-*` systemd 服务已停用并删除，不保留开机启动项。

有正在使用的预览时，先构建到独立目录验证，再切换产物；不要在前后端版本不兼容的窗口覆盖线上文件。M2 已保留 M1 旧构建于 `data/releases/`，前端保留前一版带哈希资源，供已打开页面完成加载。

## 迁移与测试隔离

1. `npm run db:generate` 根据 schema 生成 SQL；先审阅，再运行迁移。
2. 迁移账本保存 SQL 校验值与 `applying/applied` 状态；MySQL DDL 不可事务回滚，失败或文件变动时中止，需检查后修复，不盲目重复执行。
3. 当前账号只有专用库权限，测试使用同一专用库内随机 `tjt_<8位随机十六进制>_` 表名，复用同一 SQL 的受控重命名版本；结束后仅清理该前缀表。此方案替代原建议的独立测试数据库，不需要扩大授权。
4. 正式表迁移与初始化通过 CLI 执行，服务器启动不自动改表。未来有业务数据的迁移先备份，不能清库重建。

```bash
npm run typecheck
npm test
npm run build
npm run db:backup
```

后端集成验证使用真实 MySQL 临时表，包含认证／CSRF／来源、越权、空日期和未定位、多目的地、重复地名、移动保留字段、幂等冲突、整批回滚、并发版本冲突、应用重建后会话恢复、退出撤销，以及关闭独立测试连接池模拟服务失败。不会停止共享 MySQL 服务。

浏览器回归使用同一前缀隔离策略；M1 脚本临时使用 3090／5188，M2 使用 API 3091、使用端 5189、管理端 5191，结束后关闭，不需要停现有预览。先构建，确保这些端口空闲。Playwright／Chromium 由本机工具环境提供，通过 `PLAYWRIGHT_MODULE`／`CHROME_PATH` 指定；没有把 OpenDesign 安装目录写成依赖。运行 `npm run test:browser`／`npm run test:browser:m2`；截图与结果位于 `data/browser-check/`／`data/browser-m2-check/`，不提交含个人内容的运行数据。

可选隔离构建：Vite 的 `TRAVEL_DIST_DIR` 指定输出目录，`TRAVEL_API_TARGET` 指定测试代理；M2 浏览器脚本接受 `FRONTEND_TEST_DIST`／`ADMIN_TEST_DIST`，M1 接受 `TRAVEL_DIST_DIR`，默认均使用正常工作区产物。测试独立生成照片文件，结束后删除。

`npm run db:backup` 需要本机 `mysqldump`；只备份应用 MySQL，输出 `data/backups/*.sql`（600），临时凭据文件完成后删除。图片必须另外备份 `MEDIA_ROOT`，配置需安全保存。当前未自动定时、未完成整体恢复演练。`npm run media:cleanup` 清理超过 7 天的未关联上传及已删除文件，执行前考虑本机草稿引用的旧图片；不会删除仍关联日记的图片。

## 本轮验证状态

2026-10-21：后端真实 MySQL 集成测试 10 项通过（9 个子场景加总测试）；Vue 与后端类型检查、生产构建通过。浏览器 10 组流程通过，覆盖 1280px 桌面、320px／390px 手机尺寸；没有 pageerror。修复过弹窗关闭后的焦点恢复问题。

隔离测试表已清理；正式专用库迁移完成，建立 9 张业务表与迁移账本，初始化本人账号，没有导入测试旅程。构建版 API／Vue 已在回环 3080／5178 启动，并用本人账号通过真实代理登录、空列表与退出检查。前端首包约 134kB JS／46kB CSS（gzip 约 50kB／10kB，不含 HTTP 开销）。

2026-10-22：M2 三个工作区类型检查／构建通过，后端累计 21 项测试通过；M2 浏览器 12 组、M1 回归 10 组通过，无 pageerror。主站首包 JS 151.52kB／CSS 51.41kB（gzip 55.56／10.62kB）；日记编辑懒加载 JS 16.01kB。独立管理端 JS 81.02kB（gzip 31.87kB），不进入主站包。

正式迁移前已生成权限 600 的 SQL 备份，增量迁移后为 14 张业务表和账本、1 个本人账号、0 个旅程／日记／照片／测试前缀表。旧数据未清空；本人账号的登录、M2 私有读取、独立管理端、现有域名反代与退出通过。三个 screen 会话正常。

真实手机照片、真机键盘／相册、真实手机浏览器和网络、生产 TLS、公开分享及整体备份恢复尚未验收。当前域名提供 HTTP 预览，不等同正式上线。下一功能阶段为 M3 地图、补绘和文件互通。

## 版本管理

2026-10-22：用户授权初版提交与推送，目标为公开仓库 [767299026/travel-atlas](https://github.com/767299026/travel-atlas)，采用远程默认分支 `master`。初版包含 M0／M1 代码、数据库迁移、依赖锁文件、来源说明与设计／验证文档；私密 `.env`、依赖目录、构建产物、运行数据、日志和备份不进入提交。初次发布使用 GitHub 插件，服务端 Git 与远程提交同步；插件授权与服务器命令行的 Git 推送认证分别管理。

用户进一步授权：今后每完成一个已验证阶段节点，同步设计／实施／验证文档，检查不包含凭据和私有内容，然后直接提交并推送 GitHub，无需逐次询问。每次在交付说明记录提交；远端如有新提交先核对并整合，不强制覆盖历史。M2 本机实现与验证作为初版之后的下一个阶段提交。

## 实现依据

- [Fastify 请求校验](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)
- [Drizzle MySQL](https://orm.drizzle.team/docs/mysql/get-started-mysql)
- [OWASP 密码存储参数](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [Sharp 输出与元数据](https://sharp.pixelplumbing.com/api-output/)
- [Sharp 自动旋转](https://sharp.pixelplumbing.com/api-operation/#autoorient)
- [Fastify multipart 上传与限制](https://github.com/fastify/fastify-multipart)

依赖于 2026-10-21 查询可用版本并锁定；实现兼容性由本轮类型检查、构建和集成验证确认。
