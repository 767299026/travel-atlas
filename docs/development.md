# 项目开发、运行与阶段验证

更新：2026-10-23。本文记录真实应用实现，长期产品目标仍见 [实施清单](implementation-plan.md)。OpenDesign 复用范围见 [迁移记录](prototype-reuse.md)。

## 已实现范围

Vue 网站：本人登录、行程分页列表、新建多目的地和多日计划、概览、每日地点、时间／交通／角色／备注、当天地区／日期／住宿、增减空日期、排序／跨日移动／移除、行程备注、旅程元数据和状态、退出登录。

数据保存在本机专用 MySQL。路线版本和旅程基本信息版本独立；命令批次事务保存、幂等重试、最近 50 个路线版本快照、用户归属和可撤销会话已实现。本机草稿保存于 localStorage，按用户、路线和页面标识区分；同一页面刷新恢复。草稿没有跨设备同步，清理浏览器数据会丢失未提交内容。冲突保留草稿，可下载 JSON、核对后加载最新服务器版本，**尚无自动合并／草稿导入工具**。

新建表单需点击“开始安排”才入库；离开未创建表单会提示确认，暂未提供新建表单草稿恢复。地点、日期与备注弹窗确认后加入待提交批次，再点底部“保存行程”。旅程基本信息由独立保存提交；标记完成仅更新状态。

M2 已增加计划复制／空实际记录、实际路线独立编辑、手动到访、私密图文日记与独立管理端。正文使用纯文本，照片可排序、说明与删除；日记本机草稿和版本冲突不静默覆盖。详见 [M2 范围、限制与验收](m2-records.md)。

M3.1 已接入独立地图页、高德按需加载与选点／官方显示转换、不可变手工几何、GPX 预览／原件／导出、核对／保护和过期。来源、坐标和限制见 [M3 专项记录](m3-maps.md)。M3.2 新增自动算路候选与独立户外模式，见 [算路专题](m3-routing.md)；M4.1 已加入可撤销行程快照分享；尚无 GeoJSON、思源导入或 AI；照片仍待真实手机相册补验。

## 技术与目录

- Node.js 24；Vue 3.5、Vue Router 4.6、Vite 8.3；不引入首阶段用不到的状态库或整套 UI 库。
- Fastify 5.12 + TypeBox JSON Schema；Drizzle 0.45 + mysql2 3.24。精确版本在 `package-lock.json`。
- `frontend/`：原型复用样式与 Vue 页面；`admin/`：独立 Vue 管理端；`backend/src/`：API、身份、仓库、迁移及 CLI。
- `packages/contracts/src/`：共享类型、日期／目的地规则与路线命令。
- `backend/drizzle/`：SQL 与生成元数据；`0000` 建立 M1 的 9 张表，`0001` 为 M2 增加 5 张表及字段，`0002` 为 M3.1 增加 `geometry_assets`，`0003` 为 M3.2 增加任务、候选与来源字段，`0004` 为 M4.1 增加 `share_links`，`0005` 新增 `place_records` 和到访归属／坐标快照／版本，合计 19 张业务表与账本。
- 图片处理使用 Sharp 0.35.5、multipart 10.1.4；原图、阅读图和缩略图位于私有 `MEDIA_ROOT`，默认 `data/media`。配额和限制见 M2 文档及 `.env.example`。
- GPX 使用后端 xmldom 0.9.12，原 XML 和不可变几何保存在 MySQL，计入数据库备份。地图页及外部 SDK 按需加载；浏览器只接收运行时 JS Key，安全密钥留在固定上游的鉴权代理。
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

目前四个 detached 会话：`travel-atlas-web`（5178）、`travel-atlas-api`（3080）、`travel-atlas-admin`（5179）和 `travel-atlas-router`（17777，仅回环）；不依赖聊天或 SSH 前台会话。日志在被忽略的 `data/runtime/*.screen.log`。screen 不提供机器重启后的自动启动或应用崩溃自动恢复。

```bash
screen -ls
screen -r travel-atlas-web
screen -r travel-atlas-api
screen -r travel-atlas-admin
screen -r travel-atlas-router
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

M3 的 `npm run test:browser:m3` 与真实服务 `npm run test:browser:amap` 复用 M2 隔离端口，三者按顺序运行。M3 浏览器使用只在测试中注入的 SDK 替身（包括会改写数组的行为），真实高德检查单独记录，不能互相替代；后者需要本机配置和网络，可能消耗账号额度。结果分别在 `data/browser-m3-check/`／`data/browser-amap-check/`。只有真实服务检查会访问高德，普通几何 API 测试使用受控上游替身。

可选隔离构建：Vite 的 `TRAVEL_DIST_DIR` 指定输出目录，`TRAVEL_API_TARGET` 指定测试代理；M2 浏览器脚本接受 `FRONTEND_TEST_DIST`／`ADMIN_TEST_DIST`，M1 接受 `TRAVEL_DIST_DIR`，默认均使用正常工作区产物。测试独立生成照片文件，结束后删除。

`npm run db:backup` 需要本机 `mysqldump`；只备份应用 MySQL，输出 `data/backups/*.sql`（600），临时凭据文件完成后删除。图片必须另外备份 `MEDIA_ROOT`，配置需安全保存。当前未自动定时、未完成整体恢复演练。`npm run media:cleanup` 清理超过 7 天的未关联上传及已删除文件，执行前考虑本机草稿引用的旧图片；不会删除仍关联日记的图片。

## 本轮验证状态

2026-10-21：后端真实 MySQL 集成测试 10 项通过（9 个子场景加总测试）；Vue 与后端类型检查、生产构建通过。浏览器 10 组流程通过，覆盖 1280px 桌面、320px／390px 手机尺寸；没有 pageerror。修复过弹窗关闭后的焦点恢复问题。

隔离测试表已清理；正式专用库迁移完成，建立 9 张业务表与迁移账本，初始化本人账号，没有导入测试旅程。构建版 API／Vue 已在回环 3080／5178 启动，并用本人账号通过真实代理登录、空列表与退出检查。前端首包约 134kB JS／46kB CSS（gzip 约 50kB／10kB，不含 HTTP 开销）。

2026-10-22：M2 三个工作区类型检查／构建通过，后端累计 21 项测试通过；M2 浏览器 12 组、M1 回归 10 组通过，无 pageerror。主站首包 JS 151.52kB／CSS 51.41kB（gzip 55.56／10.62kB）；日记编辑懒加载 JS 16.01kB。独立管理端 JS 81.02kB（gzip 31.87kB），不进入主站包。

正式迁移前已生成权限 600 的 SQL 备份，增量迁移后为 14 张业务表和账本、1 个本人账号、0 个旅程／日记／照片／测试前缀表。旧数据未清空；本人账号的登录、M2 私有读取、独立管理端、现有域名反代与退出通过。三个 screen 会话正常。

真实手机照片、真机键盘／相册、真实手机浏览器和网络、生产 TLS、公开分享及整体备份恢复尚未验收。当前域名提供 HTTP 预览，不等同正式上线。下一功能阶段为 M3 地图、补绘和文件互通。

2026-10-22 M3.1：累计后端 32 项、M1／M2／M3 共 32 组浏览器流程通过，另完成真实高德底图、安全代理、WGS84 显示转换和标记检查。修复 SDK 改写输入数组、JSONP MIME、SQL 路段顺序及 HTTP 请求标识生成。地图懒加载 JS 29.63kB（gzip 11.24kB）／CSS 3.04kB，首屏 JS 与预加载共享块合计约 153.58kB。

已先生成权限 600 的 SQL 备份再迁移 `0002`，保留本人账号和原表，15 张业务表＋账本、0 个遗留测试前缀。新旧构建按暂存目录切换，三个 screen 会话正常。现有域名上下文通过只读浏览器登录、HTTP 新建空表单、真实地图与显示转换、管理概览和退出检查；测试通过本机域名解析到该服务器，未创建演示业务数据。外部 DNS／手机网络、TLS、账号长期使用范围与整体恢复仍未验收。下一功能节点为 M3.2 算路候选和户外模式。

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


### M3.2 运行与验证

本机 BRouter 固定 1.7.10、Java 17，已下载黄山／徽杭及长坪沟两个 5° 区域块，约 42.2MB 安装目录；额外使用 `travel-atlas-router` screen 和 17777 回环端口。运行、数据更新、profile、配额和清理命令见 [M3.2](m3-routing.md)。默认 `.env.example` 关闭路由，本机 `.env` 已启用，秘密仍只保存在服务器。

`npm run test:browser:m32` 复用 M2／M3 隔离端口，需本机已安装并运行 router；它调用一次真实引擎，失败／取消场景用受控响应，瓦片用替身以避免重复请求公开服务；单瓦片真实浏览器另验。全部浏览器脚本顺序运行。新阶段后端累计 44 项、浏览器累计 42 组通过，类型检查与暂存构建通过。Leaflet JS 148.62kB（gzip 43.33kB）及 CSS 15.09kB 仅加载户外地图后请求。

2026-10-22 09:57 UTC 先生成 20,578 字节、权限 600 的 SQL 备份，再应用 `0003_perfect_storm.sql`。当前 17 张业务表＋账本、1 个本人账号、0 个旅程／几何／任务／候选，无遗留测试表，未导入演示数据。构建暂存验证后切换 API／主站／管理端，旧版本保留 `data/releases/`，前端保留旧哈希资源。现有反代配置与 OpenDesign 保持只读。

当前主站预览可使用户外地图和区域徒步候选；尚无全国／多交通方式路由、复杂高程、GeoJSON、分享、思源和 AI。后续按 M4 推进分享范围、HTTPS／正式部署和整体恢复。真机、手机网络、区域覆盖与通行、崩溃／开机恢复、定时清理及数据库＋媒体恢复仍需补验。


### M4.1 分享运行与验证

行程详情新增「分享这次旅程」，默认只选已保存的安排，图文／日期／备注显式选择后预览、确认创建。访客页与私人会话分离，链接 fragment 承载凭证，图片按同一链接及当前选择状态读取；不提供原图、精确位置、几何或 GPX。方案与接口见 [M4.1](m4-sharing.md)。

`.env` 新增独立 `SHARE_LINK_SECRET`（64 位小写十六进制），本机已生成且权限 600，不进入构建或 Git。配置缺失时只可预览；更换密钥使旧链接失效。`npm run share:cleanup` 清理结束超过 30 天的分享记录，不删业务数据，当前仍手动执行。

`npm run test:browser:m41` 使用与 M2／M3 相同的隔离端口，按顺序运行；临时配置随机分享密钥并清理测试表及图片。累计 55 项后端、52 组浏览器通过，类型检查与暂存构建通过。分享编辑 JS 8.89kB（gzip 3.79kB），访客 JS 1.97kB（gzip 1.21kB），共享分享渲染块 3.84kB（gzip 1.90kB），不计 Vue 等公共依赖；均按路由加载。

2026-10-22 11:24 UTC，迁移前 SQL 备份 24,039 字节、权限 600，随后应用 `0004_light_firestar.sql`。保留旧业务表和账号，18 张业务表＋账本，正式分享 0 条、遗留测试表 0。升级 API、主站和管理端构建，router 保持现有 screen；旧构建与前端旧哈希资源保留。实际反代配置未修改，仅补充仓库 Nginx 示例的匿名页面响应头。

当前仍是 HTTP 域名预览。独立匿名页面和既有本人域名上下文检查通过，没有自动创建对外分享；HTTPS／正式静态托管、真实手机网络、整个数据库＋媒体＋配置恢复仍属 M4.2，不能把本节点视为正式上线。

本次切换曾遇到旧 screen 尚未释放 5178 端口，新进程因 strictPort 退出。已恢复主站，并在本机切换脚本中等待各旧监听关闭后再启动，管理端也按同样顺序升级；之后三端健康、域名及匿名检查通过。后续 M4.2 的正式部署脚本需保留该等待及回滚步骤。


### 原型主要页面与足迹闭环

2026-10-23：默认首页改为 `/map`，恢复四个入口，补齐城市回忆、地区／年份、心愿、个人统计与设置；旅程和日记加入服务端筛选与本人照片封面。完整口径见 [足迹与页面](footprints-and-pages.md)。资料／AI 按用户要求后置，不提供演示结果。

新环境执行 `npm run atlas:setup` 准备地区目录和全国参考图；国内数据缓存到 `data/atlas`，世界参考图在 `backend/assets/world.json`，无需新增 SDK 或数据库服务。参考目录不可用时仍读取存量足迹；新建归属可稍后重试。原型地图及脚本只读，DataV 几何不提交，示例摄影与旅行数据不导入。

`npm run test:browser:pages` 使用与 M2 相同的隔离端口，按顺序执行；16 组新增流程及 52 组原有回归通过，后端累计 68 项。M1 浏览器脚本现明确接收暂存目录，所有回归针对新构建；首页改变后旧脚本通过导航进入旅程。地图标签左右避让，标记和文字可点，另有地区选择器；地图拖动不误当作选区。

00:30 北京时间先生成权限 600、25,629 字节 SQL 备份，再迁移 0005。正式表当前 19 张业务表＋账本、1 个本人账号、无演示旅程或城市记录，测试表清理完毕。API／主站／管理端等待旧端口释放后切换，旧构建和前端哈希资源保留，区域 router 沿用原 screen。

本轮检查发现域名已自动跳转 HTTPS；实际反代配置未修改。浏览器检查采用实际 origin，四个入口、地图、设置只读、心愿空状态、高德、区域能力和匿名分享均核对，未修改正式本人资料或密码。此前 HTTP 预览记录保留为历史；当前 HTTPS 可访问不等于生产 Cookie／代理策略、外部网络、真机或整体恢复已完成。

## 地图三轮审核与模拟数据（2026-10-23）

全国／省级补齐区域名称与滚轮；市级自动使用高德 2D，叠加确认到访快照及有效实际几何。SDK 加载器与路线编辑页共享，滚轮有显式处理，手机尺寸变化后重适配。完整任务、三轮发现与修正、接口和限制见 [地图迭代](map-iterations.md)。

`npm run demo -- status|seed|cleanup` 管理本人账号的演示样本；清单及操作缓存仅在忽略的 `data/demo/`，备份在 `data/backups/`。当前按授权保留 3 个演示旅程、3 篇图文、14 条行程到访、2 条城市补记和 1 条心愿，不能继续把早期的“无演示数据”当成当前库状态。用户修改过的演示内容会阻止自动清理。

`npm run test:browser:atlas` 需 `PLAYWRIGHT_MODULE` 和可选暂存构建目录，复用隔离端口，不能同时运行其他浏览器夹具；测试 SDK 替身仅验证交互，真实高德另用实际域名审核。75 项后端、13 组地图、16 组页面、10 组路线地图以及 8 组真实域名流程通过，范围见专题。

## 小米截图与地图渲染替换（2026-10-23）

图鉴由自绘 SVG 改为已有 Leaflet Canvas，保留原地区数据与市级高德，默认国内视野放大；标题、画布、图源、统计和抽屉分区布局，三工具按钮各 44×44。性能测量、社区方案对照和真机边界见 [手机地图专题](mobile-map-rendering.md)。

`npm run test:browser:mobile` 提供手机布局／实际 CDP 触摸检查，性能脚本为 `scripts/browser-map-performance.ts`，仍通过 `FRONTEND_TEST_DIST` 选择暂存构建。用户提供的 `tmp/` 截图不会提交。

## 地图紧凑入口与单行抽屉（2026-10-23）

顶部改为「时光／寻找」短入口，年份与地区搜索放在顶部遮罩浮层；手机抽屉收起仅 56px，内容展开才显示，桌面独立侧栏沿用。393×775 的湖北地图画布由约 182px 增至 375px。19 组手机检查、13 组地图、16 组页面回归和 9 组实际域名检查通过。主站 screen 已切换暂存构建，保留回退版本；数据库与原型不变，截图及边界见 [手机地图专题](mobile-map-rendering.md)。

## 地图配色、内置署名与缩放切层（2026-10-23）

中国／世界标签进一步收紧，图源署名浮放地图内；393×775 湖北地图画布从约 375px 增至 419px，采用与暖白／森林绿协调的灰青、暖灰与鼠尾草绿。全国／省级图鉴随缩放焦点自动下钻，城市接高德 2D，缩小逐级返回；重置、尺寸变化和纯拖动不触发自动下钻。

`npm run test:browser:atlas-zoom` 新增 11 组真实滚轮／双指与切层边界检查；仍需 `PLAYWRIGHT_MODULE`，可通过 `FRONTEND_TEST_DIST` 指定暂存构建，与其他浏览器夹具顺序运行。另有手机 19 组、地图业务 13 组、页面 16 组及实际域名 12 组通过。现主站 screen 已更新，数据库与后端不迁移；阈值、跨组件相机边界、配色参考和截图记录见 [手机地图专题](mobile-map-rendering.md)。

## 地图工具伸展与居中动画（2026-10-23）

共用 `MapTools.vue` 默认只显示右上角下箭头，展开缩放／居中按钮，点击地图或 Escape 收起。图鉴用 Leaflet `flyTo`，高德通过官方相机接口请求约 650ms 平滑过渡；支持用户操作中断与减少动态效果偏好，初始化／尺寸适配不动画，居中不自动切层。24 组手机、11 组切层、13 组地图、16 组页面回归与 6 组真实域名验证通过，真实高德记录到连续相机位置；补齐旧地图停用和延后释放，未包装 SDK 的城市切换复核无 pageerror。主站 screen 已更新，旧构建保留，数据与后端不迁移；证据和范围见 [手机地图专题](mobile-map-rendering.md)。

## 图鉴名称布局专项（2026-10-23）

图鉴文字采用多边形内部稳定锚点、实际尺寸碰撞判断与缩放结束后恢复。`npm run test:browser:atlas-labels` 使用独立数据库前缀，和其他浏览器脚本共用验证端口，必须顺序执行；支持 `FRONTEND_TEST_DIST` 暂存构建。两轮视觉审核、文字原点修正和真实域名证据见 [手机地图专题](mobile-map-rendering.md)。

## 足迹卡片、路线联动与年度回顾（2026-10-23）

新增 `npm run test:browser:memories`，复用独立前缀表、媒体与浏览器端口；与其他浏览器夹具顺序运行。覆盖照片来源、直接城市进入、路径／到访双向选择、尺寸变化保持相机、年份、跨城入场及中断／减少动态效果。API 增量均为只读响应，不需要表迁移。详细设计、自审与真实域名截图见 [足迹参考及实现记录](amap-footprints-reference.md)。


## 2026-10-27 照片回忆更新

当前回忆入口为照片墙／照片地图，旧日记列表移至 `/journals`，原详情与编辑地址保留。照片 API 和独立持久化、EXIF／坐标与媒体生命周期见 [照片回忆](photo-memories-design.md)。新增 `0006`／`0007` 两次增量迁移，当前 21 张业务表及账本。部署前运行 `npm run db:backup`，然后 `npm run db:migrate`；迁移不重写旧日记资料。

验证命令：`npm run typecheck`、`npm test`、`npm run test:browser:photos`。照片浏览器脚本使用临时库前缀及临时媒体目录，结束清理；与其他浏览器脚本共享端口，必须顺序执行。`FRONTEND_TEST_DIST` 可指向隔离构建。`REAL_AMAP=true BROWSER_SOFTWARE_VECTOR=true` 时，HTTPS 域名下所有业务 API 拦截到临时后端，真实 SDK 访问供应商；不能把这个模式误当作本人数据联调。默认生成摄影替身；只有显式指定 `PHOTO_REVIEW_ASSETS` 才读取本机原型的摄影样本，不写生产资料。

服务继续使用 `travel-atlas-api` 与 `travel-atlas-web` 两个 screen，原管理端、区域路由与 OpenResty 保持现状。发布保存旧 API 与前端构建，并保留旧哈希静态资源以兼容已打开页面；健康检查失败时恢复旧构建。本轮数据库字段／表为增量添加，旧代码回退无需删除新资料表。备份、发布路径、数据指纹及私有截图仅在忽略的 `data/` 下记录；数据库备份未执行恢复演练，完整灾备仍待后续。


## 2026-10-29 旅程工作区

普通 `/journeys`、`/journeys/new` 和 `/journeys/:id` 使用新工作区；旧详细计划保留在 `/journeys/:id/edit`，实际记录、GPX、分享和日记地址继续可用。新增 `0008` 迁移仅加 `route_days.is_unscheduled` 与 `journeys.planning_preferences`，业务表仍为 21 张。正式执行前备份，增量列允许旧构建回退。

`npm run test:browser:workspace` 检查实际 API／Vue 与隔离地图交互；`npm run test:browser:workspace-real` 在 HTTPS 域名上下文访问真实高德搜索与底图，业务请求全部转发到临时库后端。使用 `PLAYWRIGHT_MODULE`／`FRONTEND_TEST_DIST` 指定本机工具与隔离构建，真实 SDK 在无 GPU 浏览器中需 `BROWSER_SOFTWARE_VECTOR=true`。所有浏览器套件共用临时端口，顺序运行；测试结束删除临时表和媒体。模型、自动保存／冲突、删除范围与两轮自审见 [旅程工作区](journey-workspace-implementation.md)。

发布继续使用 screen，保留旧 API／前端构建与旧哈希静态资源，健康检查失败恢复构建，不自动回退或删除新列。实际发布路径、SQL 备份、数据指纹、验证截图只存忽略的 `data/journey-workspace-20261029/`。不改管理端、BRouter、反代和 OpenDesign 原型。


## 2026-10-31 独立管理工作台

`admin/` 扩展为概览、内容台账、账号、分享、服务状态与操作记录六个模块；新接口位于 `backend/src/admin-console.ts`，均需 owner 权限。管理员读取全局台账，账号编辑仍使用版本冲突与会话撤销；分享撤销写审计且不输出凭证。详细数据口径、范围与两轮审核见 [管理专题](admin-console.md)。

本轮无数据库结构迁移或正式演示数据写入；继续 `screen` 托管 API 3080 与管理端 5179，不改主站 5178、区域路由与反代。`npm run test:browser:admin` 使用随机前缀表、临时媒体；可用 `ADMIN_TEST_DIST` 指向隔离构建，用 `ADMIN_CHECK_DIR` 指定私有证据目录。与其他浏览器夹具共享端口，必须顺序执行。管理端不再导入整份使用端 CSS，只复用品牌、图标与弹窗行为，避免页面样式干扰。
