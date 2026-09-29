import * as React from "react";
// Simplified geographic silhouettes for decorative visualization, not project boundaries.
const LAND = [
  [[-17,35],[-7,36],[5,37],[13,33],[25,32],[34,30],[43,12],[51,11],[43,-12],[35,-22],[20,-35],[11,-28],[8,-8],[-1,5],[-15,10],[-17,22]],
  [[-10,36],[-9,44],[-1,49],[7,54],[10,58],[5,62],[15,71],[29,70],[40,61],[61,68],[87,75],[113,73],[142,60],[165,61],[178,52],[146,45],[137,35],[125,39],[120,23],[107,17],[109,5],[100,2],[92,21],[81,7],[73,19],[69,24],[58,24],[51,13],[43,13],[35,29],[29,36],[21,39],[16,46],[10,44],[2,42]],
  [[-168,70],[-141,70],[-130,57],[-127,48],[-123,39],[-115,31],[-111,23],[-100,16],[-91,17],[-83,9],[-77,9],[-86,22],[-81,25],[-81,32],[-72,42],[-60,48],[-53,52],[-67,62],[-82,64],[-96,73],[-130,72]],
  [[-81,12],[-69,11],[-61,7],[-49,-1],[-35,-8],[-40,-20],[-51,-32],[-66,-55],[-73,-51],[-76,-30],[-80,-6]],
  [[113,-22],[122,-15],[131,-12],[139,-17],[146,-16],[154,-26],[151,-37],[135,-36],[128,-31],[116,-35]],
  [[-52,60],[-43,60],[-21,72],[-27,83],[-45,83],[-61,76]],
  [[47,-13],[50,-16],[48,-25],[44,-25],[44,-19]],
  [[95,5],[105,-2],[108,-7],[104,-7]],[[108,-7],[120,-8],[120,-10],[109,-9]],[[109,7],[118,7],[119,-4],[110,-4]],[[131,-2],[149,-5],[146,-9],[133,-7]],
  [[130,31],[141,42],[145,44],[142,36],[135,32]],[[166,-34],[179,-40],[169,-47],[166,-44]]
];
function inside(x:number,y:number,polygon:number[][]) {let value=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const [xi,yi]=polygon[i],[xj,yj]=polygon[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)value=!value;}return value;}
const DOTS:number[][]=[];
for(let lat=-56;lat<=82;lat+=1.8)for(let lon=-180;lon<180;lon+=1.8/Math.max(.3,Math.cos(lat*Math.PI/180)))if(LAND.some(p=>inside(lon,lat,p)))DOTS.push([lat,lon]);
export default function Globe({small=false,staticMode=false}:{small?:boolean;staticMode?:boolean}) {
  const canvas=React.useRef<HTMLCanvasElement>(null);
  const rotation=React.useRef(28);
  const drag=React.useRef<number|null>(null);
  const [paused,setPaused]=React.useState(false);
  React.useEffect(()=>{
    const el=canvas.current;if(!el)return;
    const context=el.getContext("2d");if(!context)return;
    const ctx=context;
    const media=window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame=0,visible=true,last=0;
    const size=680,ratio=Math.min(window.devicePixelRatio||1,2);
    el.width=size*ratio;el.height=size*ratio;ctx.scale(ratio,ratio);
    const cx=340,cy=340,r=245,tilt=-.16;
    function project(lat:number,lon:number) {const a=lat*Math.PI/180,b=(lon-rotation.current)*Math.PI/180;const x=Math.cos(a)*Math.sin(b),y=-Math.sin(a),z=Math.cos(a)*Math.cos(b);return {x:cx+r*(x*Math.cos(tilt)-y*Math.sin(tilt)),y:cy+r*(x*Math.sin(tilt)+y*Math.cos(tilt)),z};}
    function draw(time:number){
      if(!ctx)return;
      const moving=!paused&&!media.matches&&!staticMode&&visible&&document.visibilityState!=="hidden";
      if(moving&&drag.current===null)rotation.current+=(Math.min(time-last,40)||0)*.0025;
      last=time;ctx.clearRect(0,0,size,size);
      const halo=ctx.createRadialGradient(cx,cy,r*.65,cx,cy,r*1.3);halo.addColorStop(0,"rgba(143,236,111,0)");halo.addColorStop(.6,"rgba(92,191,97,.09)");halo.addColorStop(.79,"rgba(141,235,95,.12)");halo.addColorStop(1,"rgba(79,160,62,0)");ctx.fillStyle=halo;ctx.fillRect(0,0,size,size);
      const base=ctx.createRadialGradient(cx-r*.42,cy-r*.48,0,cx,cy,r*1.1);base.addColorStop(0,"#2d5139");base.addColorStop(.45,"#152b20");base.addColorStop(.82,"#091b13");base.addColorStop(1,"#050d09");ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle=base;ctx.fill();
      ctx.save();ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.clip();
      function line(points:number[][]){ctx.beginPath();let pen=false;for(const [lat,lon]of points){const p=project(lat,lon);if(p.z<0){pen=false;continue;}if(!pen){ctx.moveTo(p.x,p.y);pen=true;}else ctx.lineTo(p.x,p.y);}ctx.stroke();}
      ctx.lineWidth=.55;ctx.strokeStyle="rgba(145,195,146,.16)";
      for(let lat=-75;lat<=75;lat+=15)line(Array.from({length:181},(_,i)=>[lat,i*2-180]));
      for(let lon=-180;lon<180;lon+=20)line(Array.from({length:91},(_,i)=>[i*2-90,lon]));
      for(const [lat,lon]of DOTS){const p=project(lat,lon);if(p.z<0)continue;const light=Math.max(.1,Math.min(1,(1-(p.x-cx)/r*.45-(p.y-cy)/r*.35)*.65));const grain=.65+.35*Math.sin(lon*3+lat*11);ctx.fillStyle=`rgba(${Math.round(127+70*light)},${Math.round(164+68*light)},${Math.round(107+30*light)},${(.28+p.z*.72)*light*grain})`;ctx.beginPath();ctx.arc(p.x,p.y,(.7+p.z*.85)*grain,0,Math.PI*2);ctx.fill();}
      const shade=ctx.createLinearGradient(cx-r,cy-r,cx+r*.8,cy+r);shade.addColorStop(.15,"rgba(0,0,0,0)");shade.addColorStop(1,"rgba(0,8,4,.8)");ctx.fillStyle=shade;ctx.fillRect(0,0,size,size);
      const pins=[[12.4,75.7],[-3.4,-60],[-1.3,36.8],[0.5,114],[45.5,-122.6]];
      for(const [lat,lon]of pins){const p=project(lat,lon);if(p.z<0)continue;ctx.strokeStyle="rgba(202,249,135,.25)";ctx.lineWidth=1;ctx.beginPath();ctx.arc(p.x,p.y,10,0,Math.PI*2);ctx.stroke();ctx.fillStyle="#d5ff91";ctx.shadowBlur=16;ctx.shadowColor="#aafa79";ctx.beginPath();ctx.arc(p.x,p.y,3.5,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;}
      ctx.restore();ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.strokeStyle="rgba(195,241,153,.23)";ctx.lineWidth=1;ctx.stroke();
      ctx.save();ctx.translate(cx,cy);ctx.rotate(-.32);ctx.strokeStyle="rgba(197,239,157,.26)";ctx.lineWidth=.8;ctx.beginPath();ctx.ellipse(0,0,321,95,0,0,Math.PI*2);ctx.stroke();ctx.strokeStyle="rgba(208,255,155,.6)";ctx.beginPath();ctx.ellipse(0,0,321,95,0,.22,.85);ctx.stroke();ctx.restore();
      frame=requestAnimationFrame(draw);
    }
    const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;});observer.observe(el);
    frame=requestAnimationFrame(draw);return()=>{cancelAnimationFrame(frame);observer.disconnect();};
  },[paused,staticMode]);
  return <div className={`ci-globe ${small?"ci-globe-small":""}`}>
    <canvas ref={canvas} aria-label="Decorative three-dimensional Earth showing illustrative project regions" role="img" onPointerDown={e=>{drag.current=e.clientX;e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(drag.current!==null){rotation.current-=(e.clientX-drag.current)*.35;drag.current=e.clientX;}}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} />
    {!small&&<><div className="ci-globe-label ci-globe-label-top"><span className="ci-dot"/> PLANETARY PERSPECTIVE <span>01—05</span></div><div className="ci-orbit-note"><span className="ci-cross">+</span><span>ONE PLANET.<br/>BETTER DECISIONS.</span></div><div className="ci-globe-controls"><span>ILLUSTRATIVE PROJECT REGIONS</span><button onClick={()=>setPaused(v=>!v)} aria-label={paused?"Resume globe rotation":"Pause globe rotation"}>{paused?"Play motion":"Pause motion"}</button></div></>}
  </div>;
}
