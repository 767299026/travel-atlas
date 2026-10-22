# Documentation evidence only: offline topology diagnostic, not a production hiking router.
import json,math,heapq,collections,time
from pathlib import Path
root=Path(__file__).resolve().parent
raw=json.loads((root/'source.osm.json').read_text())
ways=[x for x in raw['elements'] if x['type']=='way' and 'highway' in x.get('tags',{})]
pois=[x for x in raw['elements'] if x['type']=='node' and x.get('tags',{}).get('name') in ['云谷寺','白鹅岭']]
def dist(a,b):
 x,y=map(math.radians,a);u,v=map(math.radians,b)
 return 12742017.6*math.asin(min(1,math.sqrt(math.sin((v-y)/2)**2+math.cos(y)*math.cos(v)*math.sin((u-x)/2)**2)))
coords={};graph=collections.defaultdict(list);excluded=[];directional=[];integrity=[]
for w in ways:
 t=w['tags'];foot=t.get('foot',t.get('access',''))
 if foot in ['no','private'] or any(k.startswith(('access:conditional','foot:conditional')) for k in t):excluded.append({'id':w['id'],'tags':t});continue
 ns=w['nodes'];gs=w.get('geometry',[])
 if len(ns)!=len(gs):integrity.append(w['id']);continue
 for n,g in zip(ns,gs):coords[n]=(g['lon'],g['lat'])
 one=t.get('oneway:foot')
 # Conservative directional handling for this diagnostic, including ambiguous generic oneway on footpaths.
 if one is None and t['highway'] in ['path','footway','steps']:one=t.get('oneway')
 if one not in [None,'no','0','false']:directional.append({'id':w['id'],'tags':t})
 for i in range(len(ns)-1):
  n,m=ns[i:i+2];d=dist(coords[n],coords[m])
  if one!='-1' and t.get('foot:forward')!='no':graph[n].append((m,d,w['id']))
  if one not in ['yes','1','true'] and t.get('foot:backward')!='no':graph[m].append((n,d,w['id']))
ends={}
for p in pois:
 loc=(p['lon'],p['lat']);n=min(coords,key=lambda n:dist(coords[n],loc))
 ends[p['tags']['name']]={'poi_id':p['id'],'poi_location':loc,'node':n,'network_location':coords[n],'offset_m':round(dist(coords[n],loc),1)}
s=ends['云谷寺']['node'];goal=ends['白鹅岭']['node'];best={s:0};prev={};heap=[(0,s)];t0=time.perf_counter()
while heap:
 d,n=heapq.heappop(heap)
 if d!=best[n]:continue
 if n==goal:break
 for m,weight,way in graph[n]:
  nd=d+weight
  if nd<best.get(m,float('inf')):best[m]=nd;prev[m]=(n,way);heapq.heappush(heap,(nd,m))
path=[];routeways=[]
if goal in best:
 n=goal
 while n!=s:
  path.append(n);p,w=prev[n];routeways.append(w);n=p
 path.append(s);path.reverse();routeways.reverse()
unique=list(dict.fromkeys(routeways));waymap={w['id']:w for w in ways}
segments=[{'id':w,'tags':waymap[w]['tags']} for w in unique]
result={'osm_base':raw['osm3s']['timestamp_osm_base'],'ways_total':len(ways),'graph_nodes':len(coords),'graph_directed_edges':sum(map(len,graph.values())),'integrity_issues':integrity,'excluded_ways':excluded,'directional_ways':directional,'endpoints':ends,'connected':goal in best,'horizontal_length_m':round(best[goal],1) if goal in best else None,'path_nodes':len(path),'path_way_count':len(unique),'path_ways':segments,'search_ms':round((time.perf_counter()-t0)*1000,2)}
print(json.dumps(result,ensure_ascii=False))
result['path_node_ids']=path;result['path_geometry']=[coords[n] for n in path]
(root/'result.recomputed.json').write_text(json.dumps(result,ensure_ascii=False))
