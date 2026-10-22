# 社区地图与户外数据源调查

资料核查／首次实测：2026-10-21。状态：候选研究与局部验证，尚未接入；三个区域均取得 OSM 对象，黄山含几何，另取得一张户外瓦片；查询曾有超时。未下载全国数据或部署地图服务，未确认三个样本的完整覆盖。

## 1. OSM 与 OCM

- **OpenStreetMap（OSM）**：社区共同采集和维护的开放地图数据库，包括道路、小径、地点及部分线路关系，是本项目需要评估的基础数据源。
- **OpenCycleMap（OCM）**：基于 OSM 的骑行地图，由 Thunderforest 提供地图服务；地图数据与服务并非同一个东西。不能因名称有 Open 就理解为无需账号、无限免费或所有组件均可自由复制部署。
- 若用户说的 OCM 是泛指社区地图，最可能对应 OSM；若确实指 OpenCycleMap，则徒步应优先比较同一供应商的 Outdoors 样式和其他徒步专题项目。

来源：[OSM 项目介绍](https://www.openstreetmap.org/about)、[OpenCycleMap](https://www.opencyclemap.org/)、[Thunderforest Outdoors](https://www.thunderforest.com/maps/outdoors/)。

## 2. 三个技术层次

| 层次 | 获得什么 | 本项目的用途 |
| --- | --- | --- |
| 原始地理数据 | 道路节点、连通关系、名称、标签、线路关系 | 查找与维护路线资料；为路由引擎提供输入 |
| 渲染底图／专题图层 | 瓦片、等高线、地形阴影、小径符号、线路高亮 | 在界面上看山路、地形和自有轨迹 |
| 路由引擎／规划服务 | 在已有可通行路网上连接起终点与途经点 | 生成候选徒步路径，再由用户核对 |

底图能显示一条路，不代表规划服务能沿它算路；能返回规划，也不代表它是用户实际走过的路径。切换渲染样式通常不会补上 OSM 底层缺失的道路。等高线／阴影还依赖独立高程数据，不能据此认为某段已经具有可靠爬升统计。

## 3. 候选比较

| 项目 | 类型与主要内容 | 对本项目的建议 |
| --- | --- | --- |
| [OSM](https://www.openstreetmap.org/) | 社区开放地理数据；原始道路、POI、路线关系 | 户外路网候选数据源，先检查重点景区 |
| [OpenTopoMap](https://github.com/der-stefan/OpenTopoMap) | 基于 OSM 与 SRTM 的开源地形地图，突出地形与等高线 | 对比地形底图；不要把瓦片服务视为算路 API |
| [OpenHikingMap](https://wiki.openstreetmap.org/wiki/OpenHikingMap)／[OpenMaps.fr](https://openmaps.fr/) | 徒步专题样式与在线瓦片，包含小径、山峰、山屋、泉水等 | 个人低流量试点的候选底图；源码见 [GitHub](https://github.com/sletuffe/OpenHikingMap) |
| [Waymarked Trails Hiking](https://hiking.waymarkedtrails.org/) | 展示 OSM 中已标记的徒步线路关系及详情 | 查找参考线路、借鉴资料展示；不能当作任意两点自动规划服务 |
| [Thunderforest Outdoors](https://www.thunderforest.com/maps/outdoors/) | 基于 OSM 的商业户外地图服务，强调徒步与地形 | 愿意使用账号与套餐时的托管候选；OCM 更偏骑行 |
| [BRouter](https://github.com/abrensch/brouter) 等 | 使用 OSM 路网的独立路由引擎 | 地图展示之外的算路候选；必须选合适徒步 profile |

### 当前项目状态的核查

- OpenTopoMap 仓库说明旧栅格瓦片已弃用、将转向矢量瓦片。当前官方在线服务的具体端点、兼容性和使用规则需接入时复核，不能直接照搬旧博客地址。[仓库说明](https://github.com/der-stefan/OpenTopoMap)
- OpenHikingMap 官方说明 2026 年更新了基于 OpenTopoMap 的徒步样式；它和 OpenMaps.fr 的 OpenTopoMap-R 是两个样式，后者也不等于上游 OpenTopoMap 官方服务。[项目文档](https://wiki.openstreetmap.org/wiki/OpenHikingMap)、[服务介绍](https://openmaps.fr/about-openmaps.fr.html)
- Waymarked Trails 旧 `waymarked-trails-site` 仓库的代码已归档，应参考新的 [website](https://github.com/waymarkedtrails/waymarkedtrails-website)、[backend](https://github.com/waymarkedtrails/waymarkedtrails-backend)、[api](https://github.com/waymarkedtrails/waymarkedtrails-api)；旧仓库仍承接问题反馈。完整自建涉及 Python、PostgreSQL／PostGIS、Mapnik，不是复制一个静态页面即可替换现有 MySQL 架构。

## 4. 徒步数据能提供多少信息

OSM 可记录道路类型（如 `highway=path/footway/steps`）、步行权限、路面、部分坡度或海拔，以及下列户外标签。标签是否存在、是否完整，需逐段检查，缺失不能自动解释为容易通行。

| 数据 | 可支持的功能 | 限制 |
| --- | --- | --- |
| `route=hiking` 等线路关系 | 名称、路段组合、线路展示 | 不等于所有小径或用户上传 GPX；只查线路关系会漏掉未组成关系的路段 |
| `sac_scale` | 已标注路段的徒步技术难度参考 | 不等于整趟行程的体能强度、海拔适应或当天条件 |
| `trail_visibility` | 小径辨识与找路难度参考 | 是社区标注，未标注不等于清晰 |
| 山峰、垭口、泉水、山屋等 POI | 规划途经点与资料关联 | 不能据地图点保证水源可用或设施当前营业 |

来源：[徒步线路关系](https://wiki.openstreetmap.org/wiki/Tag:route%3Dhiking)、[SAC 难度](https://wiki.openstreetmap.org/wiki/Key:sac_scale)、[小径可见度](https://wiki.openstreetmap.org/wiki/Key:trail_visibility)、[OpenHikingMap 渲染内容](https://wiki.openstreetmap.org/wiki/OpenHikingMap)。

Geofabrik 提供中国及子区域数据；首次局部实测在黄山区域框内获得 150 个小径／步道／台阶 way 和 1 个徒步线路关系；徽杭古道与长坪沟在缩减字段重试后分别得到 23／45 个 way 和 2／1 个相关关系，详情见 [验证记录第 9 节](validation-plan.md#9-osm-局部数据与户外图源首次实测)。这不是完整覆盖或线路正确性结论，超时也不能解释为无数据。没有依据宣称 OSM 在这些地区一定比高德更好或更差；Waymarked Trails 没显示某条线路，也不能据此判定 OSM 没有对应小径。[中国数据下载页](https://download.geofabrik.de/asia/china.html)

## 5. 开放数据与服务使用分别处理

- **OSM 原始数据**：按 ODbL 使用、署名，并根据实际派生／分发方式履行相关要求；可获得区域副本，用于自建处理。数据许可不等于对官方公共 API 和瓦片服务器的无限使用权。[许可](https://www.openstreetmap.org/copyright)、[瓦片政策](https://operations.osmfoundation.org/policies/tiles/)
- **OpenMaps.fr 服务**：核查时允许非商业、合理低流量使用，免注册 Key；政策列出每月 50 万瓦片上限、禁止批量抓取和预取，并要求署名与捐助链接，无 SLA。这里记录的是服务条款，不是本项目已被授予专属额度或稳定性保证。[当前政策](https://openmaps.fr/tile-usage-policy.html)
- **Thunderforest 服务**：需要注册，套餐及 Key 管理；其服务条款禁止缓存代理或转分发，批量下载另需适用套餐。不能为改善国内速度而默认镜像该服务。[条款](https://www.thunderforest.com/terms/)
- 样式代码、瓦片图片、OSM 原始数据库、高程及线路图标的许可可能不同；选定具体组件时分别核对，不能统一写成“开源所以任意用”。

后续已从本机取得一张 OpenHikingMap 瓦片，单次约 4.5s；这不是中国大陆客户端体验验收。商业服务套餐权益未实测，细节统一记录到 [验证文档](validation-plan.md#9-osm-局部数据与户外图源首次实测)。

## 6. 结合当前项目的建议架构

建议保持 Node.js + TypeScript 和 MySQL 的业务架构；增加户外图源不要求更换业务后端语言或数据库。

1. **常规旅行地图**：继续验证高德底图、国内地点搜索、城市交通与步行。
2. **户外查看模式**：候选采用 Leaflet 加合适的在线户外栅格图源；如确定采用矢量样式或需要更复杂图层，再评估 MapLibre GL JS。进入户外视图时加载对应组件，不把两套 SDK 默认同时放入首屏。
3. **徒步路径生成**：针对高德缺口，评估 OSM 路由引擎或已有托管规划服务。换户外底图不自动切换或获得算路服务。
4. **长期路线档案**：自己的记录、合法参考 GPX、手工补绘和社区数据派生结果分别保留来源、坐标系与允许使用范围；不把所有结果混成无法追溯的一条线。

坐标继承 [地图方案](maps-and-routing.md#5-坐标与业务格式)：OSM／GPX 的 WGS84 与高德 GCJ-02 分别处理。户外模式优先使用匹配的底图和坐标；不能把 OSM 瓦片直接套到高德画布上，期待它与其他数据自然对齐。跨模式转换保持原始数据，供应商结果能否跨底图展示仍按其授权处理。

库参考：[Leaflet](https://leafletjs.com/)、[MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/)。

### 部署安排

当前优先采用在线图源、有限样本数据及已有工具验证。自建全国底图、搜索和算路后置，避免本机同时承担大规模导入、瓦片生成与多套地理数据库。

Geofabrik 核查时中国 PBF 约 1.5GB，仅为压缩原始数据大小，不是部署磁盘／内存总需求。可以后续选择子区域验证路由，资源以实际构建和更新观测为准；这与用户无需离线打开地图的要求并不冲突，属于服务端数据安排。

## 7. 下一轮对比计划

继续沿用三条已经测过的样本，不扩大到全国：

1. 先将明确的用户目标节点与 GCJ-02／WGS84 位置核对；与景区资料或获准使用的参考轨迹比对。
2. 检查 OSM 的原始小径、连通性、步行权限、难度标签和线路关系，分别记录“有数据／缺失／需要确认”。
3. 在户外底图上查看同一区域，记录实际访问速度、署名展示、缩放范围及是否有等高线；仅网页能打开不算国内体验验证完成。
4. 对数据可用的区域选择一种徒步路由方案，以相同节点比较完整性、绕路、首尾偏移与人工确认结果。BRouter 明确使用徒步配置，不能默认其骑行 trekking 配置适合徒步。[徒步配置候选](https://github.com/abrensch/brouter/blob/master/misc/profiles2/hiking-mountain.brf)
5. 通过后再决定是否引入户外查看模式、托管算路或区域自建；当前未确认任何新增生产依赖。

## 8. 当前验证进展

已完成第 1 轮三个区域的对象存在性检查和单张瓦片访问，第 2 轮在黄山局部图中找到云谷寺至白鹅岭的连续候选线（二维约 3.14km）。保存了 [原始快照、示意与 GPX](evidence/huangshan-osm-2026-10-21/README.md)，可离线复查计算；尚未统一高德与 OSM 端点或选定正式徒步路由。

本次再次对照思源笔记，确认“云谷寺/索道”这类文字需要分解为交通方式和具体位置候选，不能直接生成唯一确定路线。完整边界与证据见 [验证记录第 10 节](validation-plan.md#10-黄山局部连通检查与-gpx-样本)。

第 3 轮用同一组 OSM 点调用 BRouter `hiking-mountain` 成功，返回约 3.12km 候选线与模型高程／耗时，几何与局部图基本重合。默认 profile 的难度惩罚、方向规则及公开服务接入仍需评估，不能把引擎可调用当作生产选型完成。见 [第 11 节](validation-plan.md#11-brouter-徒步路由单样本验证) 及 [证据目录](evidence/huangshan-brouter-2026-10-21/README.md)。
