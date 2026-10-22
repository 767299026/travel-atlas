# 黄山 OSM 路网验证样本

日期：2026-10-21。用途：技术验证与后续复查，**不是已确认出行路线或 GPS 实录**。结果说明见 [验证记录第 10 节](../../validation-plan.md#10-黄山局部连通检查与-gpx-样本)。

## 文件

| 文件 | 内容 |
| --- | --- |
| [source.osm.json](source.osm.json) | Overpass 返回的局部原始快照，含坐标、节点编号、way 标签；不含服务密钥或笔记正文 |
| [result.json](result.json) | 图统计、选点与贴合偏差、候选路段、WGS84 点串及限制说明 |
| [check-topology.py](check-topology.py) | 离线诊断脚本，无网络、无第三方依赖；重算输出 `result.recomputed.json` |
| [route-preview.svg](route-preview.svg) | 可独立打开的路网与候选路径示意图，不请求地图瓦片 |
| [candidate.gpx](candidate.gpx) | 163 点的规划参考样本，WGS84；没有虚构海拔、轨迹采样时间或运动速度 |

## 来源与使用

地理数据及派生样本来源 © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)，按 [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) 使用；保留原始响应版权说明、编号、快照时间和归属。本目录说明及诊断脚本不改变上游数据许可。

数据基准时间：`2026-10-21T07:45:51Z`，不是现场核验时间。途经通行状态、开放时间、难度、天气及点／关系级限制未完整核实。

本次成功请求的 Overpass QL：

```text
[out:json][timeout:20][maxsize:67108864];
(
  way["highway"~"^(path|footway|steps|track|pedestrian|service|residential|unclassified)$"](30.113,118.160,30.147,118.201);
  node["name"~"云谷寺|白鹅岭"](30.113,118.160,30.147,118.201);
);
out body geom;
```

公共接口：`https://overpass-api.de/api/interpreter`。优先用本地快照复查，不为每次浏览或重算重复请求公共服务。

## 复查方法

在本目录执行 `python3 check-topology.py`。它读取保存的快照，重算图和候选点串，不连接网络，不覆盖原始 `result.json`。

算法：由相邻 OSM 节点构建图，以球面距离加权；排除显式禁止／私有和条件权限路段，按脚本声明处理方向；两个地点先吸附到最近路网顶点，再以 Dijkstra 检查最短连通路径。仅是几何与简化通行规则诊断，不是正式徒步 profile。

示意图不依赖外部底图；图上的灰线包含局部其他道路，绿色候选线不保证涵盖全部目标徒步走法。GPX 中只包含吸附后的连续路网段，未把地点与路网间偏移强行算成步道。导入其他工具后仍需确认用途和线路。
