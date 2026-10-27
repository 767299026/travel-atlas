# OpenDesign 源码复用与 Vue 迁移

更新：2026-10-27。原型到 Vue 的迁移保留如下；本次按用户明确要求，将当前网页页面／样式反向同步为 OpenDesign 静态设计文件，见 [同步记录](opendesign-static-sync.md)。后续仍默认只读检查原型，明确要求修改时再同步。

## 来源与边界

原型项目 ID：`29b3ea48-0738-4712-963e-ec914fab4f77`，用户标注版本 v4。通过 OpenDesign 项目服务定位工程，运行时数据目录不作为固定项目路径。

| 原型来源 | 本项目位置 | 处理 |
| --- | --- | --- |
| `styles.css` | `frontend/src/styles/prototype-base.css` | 原样复制品牌变量、基础控件、导航与弹层样式 |
| `journeys.css` | `frontend/src/styles/prototype-journeys.css` | 原样复制行程卡片、日期栏、地点、表单和 v4 整理样式 |
| `index.html` 的 `@layer od-layout` | `frontend/src/styles/prototype-layout.css` | 保留布局原语与来源说明 |
| `app.js`／`journeys.js` 的 SVG 路径 | `frontend/src/components/icons.ts`、`AtlasIcon.vue` | 复用静态图标，用户数据不经过 `v-html` |
| `journeys.js` 的 `tripsPage`、`journeyCard`、`view` 与每日编辑结构 | `frontend/src/views/*.vue` | 沿用 HTML 层级、class、文案及操作组织，改成 Vue 模板和响应式状态 |
| 日期／多目的地等纯函数 | `packages/contracts/src/index.ts` | 提取为共享逻辑；日期改用 UTC 日历运算，避免时区偏移 |

两份原样 CSS 的 SHA-256 见 [复用清单](prototype-reuse-inventory.json)。后续适配写在 `app.css`；原型 CSS 的更新可单独对比。品牌山形标记在 Vue 中重绘，未声称逐字复制。

原型中的 `window.AtlasUI`、字符串拼接事件、演示数据和 IndexedDB 存储依赖彼此；正式版把交互改为组件及 API，请求写入 MySQL。演示照片与行程、假地图坐标、硬件手机边框未进入真实用户数据。当前端口中的页面是迁移后的真实应用，OpenDesign 仍用于设计预览和后续提示词迭代。

## 当前迁移范围

- 行程列表／新建／基本信息、概览／每日安排、地点表单与有文字的更多操作。
- 复用 v4 的日期栏、当天信息、地点排序／跨日移动、草稿提示与底部保存入口。
- 登录和真实服务器错误是本阶段新增。现已提供地图／旅程／回忆／我的四个入口；地图、图文、分享与独立管理端已真实实现，资料库和 AI 按用户要求后置。
- 本机只保存按用户／路线／页面隔离的待提交草稿；“已保存到服务器”仅在服务端确认后显示。

HTML／JS 原型可以复用，不意味着所有脚本都适合原样运行。每次迁移以页面行为、字段是否保留、真实持久化和手机浏览器可用性为验收依据，测试范围见 [M1 开发与验证](development.md)。

## 2026-10-23 页面完善

只读复查原型 app.js 的地图、地区／年份、城市记忆、标记到访、心愿与个人页；在本仓库新增 SVG 足迹首页、城市抽屉、心愿清单、个人统计／设置，并改进旅程与回忆筛选。原型地图投影及 SVG 组织作为参考改写为 Vue，用户内容使用 Vue 文本绑定，不迁移字符串 HTML 事件或示例数据。Natural Earth 世界参考图提取为约 194kB 的只读数据文件，DataV 国内几何按需缓存而不提交原始地图数据。详情见 [足迹与页面建设](footprints-and-pages.md)。

## 2026-10-27 照片回忆参考

OpenDesign 已独立更新 `memories.html`、`current/memories.js`、`current/memories-data.js` 与 `current/styles/memories.css`。先只读吸收其页面分组、纸边照片墙、大图、小摘要以及地点短签／照片滴形样式；用户随后授权落地，已将 CSS 复制到 `frontend/src/styles/photo-memories.css` 并重写为 Vue／API 页面。原型的本地相册、示例坐标和行政区 SVG 地图不作为真实服务直接迁移；详情见 [照片回忆设计](photo-memories-design.md)。较早的网页静态导出包不能覆盖这些后续新设计。
