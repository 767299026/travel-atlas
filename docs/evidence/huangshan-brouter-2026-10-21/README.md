# 黄山 BRouter 徒步路由验证证据

日期：2026-10-21。用途：检验独立徒步路由与数据格式，不是已确认出行路线或 GPS 实录。说明见 [验证记录第 11 节](../../validation-plan.md#11-brouter-徒步路由单样本验证)。

| 文件 | 内容 |
| --- | --- |
| [request.json](request.json) | 无密钥公开请求的参数、端点、耗时、引擎版本和所读取 profile 的摘要／SHA256 |
| [response.geojson](response.geojson) | 服务原始返回，含模型高程、模型累计时间等，均不是个人实测 |
| [summary.json](summary.json) | 端点偏移、线长及与前次局部图的几何对照 |
| [comparison.svg](comparison.svg) | 无在线底图依赖的局部图／BRouter 候选线对照 |
| [candidate.gpx](candidate.gpx) | 153 点的 WGS84 规划参考，保留来源，不输出高程或模拟采样时间 |

## 来源与边界

- 引擎：[BRouter](https://brouter.de/)，服务本次自报 `BRouter-1.7.11-beta`；profile 为 `hiking-mountain`，参数值来自测试时公开 profile。托管配置与路由数据会变动，未获得服务端所用 OSM 快照版本，不能保证未来相同请求逐点一致。
- 道路几何源自 © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)，按 [ODbL](https://opendatacommons.org/licenses/odbl/1-0/) 保留来源。引擎代码许可与路网数据许可分别处理。
- 高程不是 GPS 实测；BRouter 网站说明使用外部高程模型，但本次响应未精确给出每点高程数据集及版本。完整高程数据使用条件和精度未在本轮确认，不把本证据目录当作已获准公开发布的高程产品。
- 单次公开在线调用只供少量技术验证，没有确认生产流量、稳定性承诺或商业接入安排。没有部署 BRouter，也没有新增正式依赖。
- 本次只请求一个方向的一条路径；没有测试候选方案、复杂单向、路段封闭、点级障碍或模型时间准确性。

## 对照口径

输入与 [前次局部图](../huangshan-osm-2026-10-21/README.md) 使用同一组 OSM 地点坐标，均为 WGS84。对照量是每组顶点到另一组连续折线的最小距离，再取本组最大值；用局部平面近似，不是连续曲线精确 Hausdorff 距离或安全／准确率指标。

两组几何基本重合，首尾因贴合规则略有不同。BRouter 长度为服务字段 3123m；自行按其平面点串球面累加约 3127m，不能把二者强制改成同一个字段或当作实测。其 `filtered ascend=785`、`total-time=5714` 是模型输出；`times` 也不能转换成用户真实运动时间。

为了复查优先使用保存的响应；如需重测，由脚本或工具按 `request.json` 的公开端点和参数发出单次请求，并重新记录服务版本及 profile 摘要，不将公共服务接入页面无限重算。
