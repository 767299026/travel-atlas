// Deterministic interaction double. Real supplier rendering is checked separately on the domain.
export const amapFixture = `
window.fixtureMaps = []; window.fixtureConversions = [];
class MapDouble {
 constructor(element, options) { this.element=element; this.options=options; this.zoom=options.zoom; this.handlers={}; this.items=[]; this.center=[114.3,30.6]; this.cameraCommands=[]; window.fixtureMaps.push(this); element.dataset.mapMode=options.viewMode; element.addEventListener('wheel', e=>{if(!options.scrollWheel)return;e.preventDefault();this.setZoom(this.zoom+(e.deltaY<0?1:-1))},{passive:false}); }
 on(name,handler){ this.handlers[name]=handler; }
 add(items){this.items.push(...items); for(const item of items)if(item.options?.content){item.options.content.style.cssText='position:absolute;left:100px;top:'+(150+this.items.indexOf(item)*45)+'px';this.element.append(item.options.content);} }
 remove(items){this.items=this.items.filter(i=>!items.includes(i));for(const item of items)item.options?.content?.remove();}
 setCity(code,done){this.city=code;done?.();}
 setZoom(z){this.zoom=z;this.handlers.zoomend?.();}
 getZoom(){return this.zoom;}
 getCenter(){return this.center;}
 getFitZoomAndCenterByOverlays(){return [13,[114.3,30.6]];}
 setZoomAndCenter(zoom,center,immediately,duration){this.cameraCommands.push({zoom,center,immediately,duration});this.center=center;this.setZoom(zoom);this.handlers.moveend?.();}
 setFitView(){this.setZoom(13);}
 resize(){}
 destroy(){this.element.replaceChildren();}
}
class Marker {constructor(options){this.options=options;}}
class Polyline {constructor(options){this.options=options;this.handlers={};}on(name,fn){this.handlers[name]=fn;}}
window.AMap={Map:MapDouble,Marker,Polyline,convertFrom(points,type,done){window.fixtureConversions.push({points:JSON.parse(JSON.stringify(points)),type});const locations=points.map(([lng,lat])=>({getLng:()=>lng+.006,getLat:()=>lat+.003}));points.splice(0,points.length,...locations);done('complete',{locations});}};
`;
