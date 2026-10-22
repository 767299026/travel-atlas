# OpenDesign 源码复用与 Vue 迁移

更新：2026-10-21。用户要求直接利用现有 HTML／JS；原始 OpenDesign 工程继续只读。

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
- 登录和真实服务器错误是本阶段新增。导航暂提供“旅程／我的”；地图、回忆、分享、AI 与独立管理端随对应里程碑加入。
- 本机只保存按用户／路线／页面隔离的待提交草稿；“已保存到服务器”仅在服务端确认后显示。

HTML／JS 原型可以复用，不意味着所有脚本都适合原样运行。每次迁移以页面行为、字段是否保留、真实持久化和手机浏览器可用性为验收依据，测试范围见 [M1 开发与验证](development.md)。
