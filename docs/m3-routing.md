# M3.2 算路候选与户外模式

更新：2026-10-22。状态：本机实现、隔离验证与现有预览升级完成。承接 [M3.1](m3-maps.md)。

## 本节点范围

- 以 Leaflet 按需加载 OpenHikingMap 户外底图，保留 OSM／样式／捐助署名和有效 Referer，不预下载，不提供离线包。独立使用 WGS84，不将高德 GCJ-02 点直接放到社区地图上。
- 固定 BRouter 1.7.10，在本机 Java 单线程、256MiB 堆和回环端口提供个人算路。先下载黄山／徽杭与长坪沟所在的两个 5° 数据块，后续按实际需求扩展，不自建全国底图或路网。
- 先支持明确 WGS84 起终点的徒步连接，使用固定的 `hiking-mountain` profile；不把其他交通意图静默降级为徒步。profile 是路网成本模型，不代表线路难度或现场通行已获确认。
- MySQL 持久化任务、候选、输入指纹、来源和诊断；计算不占用业务事务。完成只生成候选，必须预览后主动采纳，再沿用路径核对流程。
- 支持取消、过期、失败、重启中断、迟到结果作废和受保护路径拒绝覆盖；改备注不必丢弃仍匹配输入的候选。GPX 保留 OSM／ODbL 来源，不输出模型高程或时间为个人采样。

## 服务依据

2026-10-22 查阅：[OpenMaps 使用政策](https://openmaps.fr/tile-usage-policy.html)、[服务说明](https://openmaps.fr/about-openmaps.fr.html)、[BRouter 官方部署](https://github.com/abrensch/brouter)、[1.7.10 版本](https://github.com/abrensch/brouter/releases/tag/v1.7.10)、[Leaflet 1.9.4](https://leafletjs.com/reference.html)。本项目当前为个人非商业低流量预览，图源服务没有 SLA；后续使用规模或商业用途变化时重新核对条件。

本节点仅交付个人网页预览与区域算路，未完成外部网络、真机或正式上线验收。

## 使用流程

1. 行程详情进入「查看路线地图与 GPX」，选择「社区户外地图」，按需加载；默认仍为高德。模式切换不更改地点原始坐标。
2. 为徒步连接确认起终点 WGS84 位置和交通方式，保存行程修改。户外地图点击会保存 `outdoor_pick` 来源；其他坐标系不会叠加到户外地图，也不反向转换成 WGS84。
3. 点击「计算徒步候选」。任务持久化，可刷新后查看、取消。计算完成不改路线，不创建到访或运动记录。
4. 查看候选、端点偏移、来源及诊断；勾选确认后采纳。采纳生成不可变 `routing` 资产并更新路线版本，旧资产保留；仍需「已核对这段路径」及保存，才能按既有导出规则导出。
5. 地点／交通／绑定变化、路径保护、候选过期或版本冲突时拒绝覆盖；仅改备注不使输入失效。GPX 记录 BRouter、profile、区域数据和 OSM／ODbL 来源，不写入模型高程或耗时为采样。

## 架构与限制

- Leaflet 1.9.4 与样式懒加载，图块直连 OpenMaps.fr；明确 `strict-origin-when-cross-origin`，覆盖站点默认 `same-origin` referrer 设置。保持可见的样式／OSM／捐助链接。不预下载、不开离线缓存包，普通浏览器 HTTP 缓存照常工作。
- 按 2026-10-22 政策，当前个人非商业低流量使用无需图块 API Key；月度服务上限 50 万图块，服务可随时限制且无 SLA。移动端速度、外部网络和商业使用未验收；底图与路网计算来源独立。
- `routing_jobs`、`routing_candidates` 由 MySQL 管理，API 每秒取任务。每个 API 进程同时计算一个任务；本机只运行一个 API 实例，Java 路由线程为 1。若扩容多实例，需增加全局并发协调。
- 网络计算在业务事务外；短事务领取任务、写候选。运行租约 50 秒，API 超时 35 秒，Java 单次上限 30 秒。异常重启后的运行任务租约到期标记中断，不静默重算；等待任务可继续。
- 每人 1 个等待／计算任务、滚动 24 小时 20 个、保留最多 200 个。任务及候选 24 小时有效。`npm run routing:cleanup` 清理创建超过 7 天的终态任务和其候选；采纳后的几何及来源保留。目前清理需手动执行，尚无定时调度。
- 起终点直线距离 10 米至 50 公里，候选最多 10,000 点、二维线长 200 公里、响应 2MiB。仅支持 `hike`；城市步行、自驾、公交不自动套用徒步 profile。
- `hiking-mountain` 原版 profile 的 `SAC_scale_limit=3` 属于成本模型，超限惩罚并非绝对禁行；允许台阶及渡轮，不补直线。不能据此确认线路难度、景区规定、封闭状态或实际通行。
- 两个初始数据块：`E115_N30`（东经 115–120°，北纬 30–35°，黄山／徽杭周边）及 `E100_N30`（东经 100–105°，北纬 30–35°，长坪沟周边）。范围内有数据不代表任意端点可达，跨出已安装范围会失败；不是全国路由。

## 本机安装与维护

```bash
# Java 17+ 已在本机存在；不自动安装系统包
npm run routing:setup
# 仅回环 17777，不通过现有代理公开
screen -dmS travel-atlas-router -L -Logfile /opt/projects/travel-journal/data/runtime/router.screen.log /bin/bash -c 'cd /opt/projects/travel-journal && exec /usr/bin/node scripts/brouter-serve.mjs'
```

安装器固定官方 BRouter 1.7.10，限制区域数和下载大小，写入新的 `data/brouter/versions/<时间>/`，成功才原子替换 manifest。安装和数据均被 Git 忽略，权限由 umask 077 限制；引擎 MIT 许可另留仓库 `licenses/`。保存下载地址、时间、Last-Modified、文件 SHA-256 和组合数据标识。二进制／数据更新时先保留旧 manifest 及目录，停止 API 和 router，安装新版本后重启 router、API；不要原地改旧目录，否则来源标识失真。需要扩区时显式传入全部保留块，例如 `npm run routing:setup -- --tiles E115_N30 E100_N30 E110_N30`，最多 8 块。

`.env` 中 `BROUTER_ENABLED=true`、`BROUTER_MANIFEST=data/brouter/manifest.json` 启用后台能力；默认关闭。API 只访问固定回环端点，不接受浏览器传入上游 URL 或 profile。启动校验 manifest、profile 指纹和数据文件存在性；数据目录按版本维护。更新后旧输入指纹候选不能再采纳。回滚时同时恢复旧 manifest、router 和 API；保留已应用的兼容增量数据库结构，不删表降级。

BRouter 原始 stdout 含请求坐标，wrapper 丢弃该输出；stderr 只记通用提示。接口不返回本机路径或上游异常正文。screen 不负责开机恢复／崩溃自动拉起。完成确认后可人工删除未引用的旧安装目录；当前没有自动删区域数据或定期更新。

## 2026-10-22 本机样本与资源

- Java 17.0.20.1，BRouter 1.7.10。区域数据 39,436,722 字节；安装目录约 42.2MB。固定 profile SHA-256 `691299a5018726e58cd5a97a5f1f96deaa88c6780c9fb8d80d4a2454e58d29f1`，组合区域数据 `bd1b8df11c2dbd1a27703ac042005c2d22b0f4725fa678af7b3da395f6450304`；与 private manifest 对应。
- Java `-Xms32m -Xmx256m -XX:ActiveProcessorCount=1`；一次黄山查询后 RSS 约 60MiB（单次采样，不是峰值或总内存上限）。后续长路线峰值仍需观察。
- 云谷寺至白鹅岭：153 点，供应商里程 3,123 米、二维线长约 3.13km、模型耗时 5,714 秒，两端偏移约 5 米。只证明该组点能算通，不代表长坪沟、全国覆盖或现场路线已验收。

验证和部署最终结果见 [验证计划第 18 节](validation-plan.md#18-m32-区域算路候选与户外地图)。
