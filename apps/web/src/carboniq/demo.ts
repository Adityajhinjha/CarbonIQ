import { COUNTRY_NAMES, DEFAULT_FILTERS, DISCLAIMER, SCORE_COMPONENTS, type CarbonIQService, type Project, type ProjectScore, type BuyerPreference, type RecommendationItem, type Portfolio, type PortfolioItem, type SimulatedOrder, type ProjectFilters, type ComponentName } from "./domain";
import { ApiError } from "./api";
const AS_OF="2026-09-09T00:00:00Z";
const photos=[
  "https://images.unsplash.com/photo-1631006995557-9866a74ee05c?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85&w=900",
  "https://images.unsplash.com/photo-1543419163-155ebaf80730?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85&w=900",
  "https://images.unsplash.com/photo-1718661934073-ecfd78710651?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85&w=900",
  "https://images.unsplash.com/photo-1473448912268-2022ce9509d8?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85&w=900",
  "https://images.unsplash.com/photo-1592417817098-8f3d6910985b?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85&w=900",
];
const templates = [
  {name:"Western Ghats Forest Restoration",country:"IN",type:"Reforestation",category:"removal",price:780,lat:12.4,lon:75.7,image:0},
  {name:"Tamil Nadu Wind Collective",country:"IN",type:"Wind energy",category:"reduction",price:490,lat:8.3,lon:77.5,image:1},
  {name:"Sundarbans Blue Carbon",country:"IN",type:"Mangrove restoration",category:"removal",price:860,lat:21.9,lon:88.8,image:2},
  {name:"Amazon Forest Conservation",country:"BR",type:"Forest conservation",category:"avoidance",price:680,lat:-3.4,lon:-60,image:0},
  {name:"Rift Valley Clean Cookstoves",country:"KE",type:"Improved cookstoves",category:"reduction",price:420,lat:-1.3,lon:36.8,image:3},
  {name:"Borneo Peatland Recovery",country:"ID",type:"Forest conservation",category:"avoidance",price:920,lat:0.5,lon:114,image:2},
  {name:"Pacific Northwest Biochar",country:"US",type:"Biochar",category:"removal",price:1400,lat:45.5,lon:-122.6,image:4},
  {name:"Deccan Soil & Forest Program",country:"IN",type:"Reforestation",category:"mixed",price:650,lat:17.4,lon:78.5,image:0},
  {name:"Cerrado Landscape Renewal",country:"BR",type:"Reforestation",category:"mixed",price:750,lat:-15.8,lon:-47.9,image:0},
  {name:"Kenyan Community Forests",country:"KE",type:"Reforestation",category:"removal",price:560,lat:-0.5,lon:37.1,image:2},
] as const;
function fixtureScore(index:number):ProjectScore {
  const components:Record<ComponentName,number|null>={integrity:89-index%9,permanence:82-index%7,verification:91-index%8,co_benefits:94-index%10,value:81-index%6,delivery:87-index%5,compatibility:76-index%8};
  const n=(key:ComponentName)=>components[key] as number;
  const missing=index===13||index===24;
  return {overall_score:missing?null:Number(SCORE_COMPONENTS.reduce((sum,[key,,weight])=>sum+n(key)*weight/100,0).toFixed(1)),quality_score:missing?null:Number((.45*n("integrity")+.25*n("permanence")+.3*n("verification")).toFixed(1)),impact_score:missing?null:Number((.6*n("integrity")+.4*n("co_benefits")).toFixed(1)),risk_score:missing?null:Number((.35*(100-n("integrity"))+.25*(100-n("permanence"))+.2*(100-n("verification"))+.2*(100-n("delivery"))+(index%5===4?6:0)).toFixed(1)),confidence:missing?.38:.92-index%7*.03,components:missing?Object.fromEntries(SCORE_COMPONENTS.map(([key])=>[key,null])) as Record<ComponentName,null>:components,methodology_version:"1.0.0",calculated_at:AS_OF,missing_evidence:missing?["Methodology evidence","Independent verification document"]:[],status:missing?"insufficient_evidence":"scored"};
}
/** All 30 records are fictional UX fixtures, including registry associations and scores. No registry data is claimed. */
export const DEMO_PROJECTS:Project[]=Array.from({length:30},(_,i)=>{
  const t=templates[i%10], id=`10000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`;
  return {id,name:t.name+(i>=10?` · Demonstration lot ${Math.floor(i/10)+1}`:""),developer:`${COUNTRY_NAMES[t.country]} Climate Collective (fictional)`,project_type:t.type,category:t.category,country:t.country,registry:["Verra VCS","Gold Standard","ACR"][i%3],external_project_id:`SYNTH-${String(i+1).padStart(3,"0")}`,methodology:i===13||i===24?null:"Illustrative methodology — source pending",verification_status:i%5===4?"evidence_missing":"evidence_available",validation_status:"Demonstration record",monitoring_status:"Demonstration record",issuance_status:"Synthetic inventory",retirement_status:"No retirement",latitude:t.lat,longitude:t.lon,description:`An illustrative ${t.type.toLowerCase()} project in ${COUNTRY_NAMES[t.country]}, designed to demonstrate how CarbonIQ connects climate integrity, project evidence and buyer preferences. All project facts, prices, registry associations and scores in this record are synthetic. Photography illustrates the project type and does not document this project.`,image_url:t.image===null?null:photos[t.image],sdgs:[13,15,i%2?7:8],credits:[{id:`20000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`,project_id:id,vintage:2024+i%3,currency:"INR",unit_price:i===24?null:String(t.price+Math.floor(i/10)*35),available_quantity:i===24?null:2400+i*150,data_as_of:AS_OF,is_synthetic:true}],score:fixtureScore(i),risk_signals:i%5===4?[{id:`signal-${i}`,code:"MISSING_VERIFICATION_EVIDENCE",severity:"medium",explanation:"Independent verification evidence is missing from the demonstration record.",evidence:"No verification document attached to this synthetic fixture.",rule_version:"1.0.0",detected_at:AS_OF,human_review:true}]:[],documents:[{id:`document-${i}`,title:"Project evidence dossier",status:"ready",url:null,pages:12}],provenance:{source_organization:"CarbonIQ demonstration fixtures",source_url:null,data_as_of:AS_OF,retrieved_at:AS_OF,classification:"synthetic"},is_synthetic:true};
});
export function filterProjects(filters:ProjectFilters) {
  let items=DEMO_PROJECTS.filter(p=>{
    const c=p.credits[0];
    return (!filters.query||`${p.name} ${p.developer} ${p.project_type}`.toLowerCase().includes(filters.query.toLowerCase()))&&(!filters.category||p.category===filters.category)&&(!filters.country||p.country===filters.country)&&(!filters.project_type||p.project_type===filters.project_type)&&(!filters.registry||p.registry===filters.registry)&&(!filters.verification_status||p.verification_status===filters.verification_status)&&(!filters.vintage||c.vintage===Number(filters.vintage))&&(!filters.max_price||(c.unit_price!==null&&Number(c.unit_price)<=Number(filters.max_price)))&&(!filters.max_risk||(p.score?.risk_score!=null&&p.score.risk_score<=Number(filters.max_risk)))&&(!filters.sdg||p.sdgs.includes(Number(filters.sdg)));
  });
  items=[...items].sort((a,b)=>filters.sort==="price_asc"?(Number(a.credits[0].unit_price??Infinity)-Number(b.credits[0].unit_price??Infinity)):filters.sort==="risk_asc"?(a.score?.risk_score??Infinity)-(b.score?.risk_score??Infinity):filters.sort==="name"?a.name.localeCompare(b.name):(b.score?.overall_score??-1)-(a.score?.overall_score??-1));
  return {items:items.slice((filters.page-1)*filters.page_size,filters.page*filters.page_size),total:items.length,page:filters.page,page_size:filters.page_size};
}
export function demoRecommendations(pref:BuyerPreference):RecommendationItem[] {
  return DEMO_PROJECTS.filter(p=>{
    const c=p.credits[0];
    return c.currency===pref.currency&&c.unit_price!==null&&(c.available_quantity??0)>0&&p.score?.quality_score!=null&&p.score.quality_score>=pref.minimum_quality&&(!pref.countries.length||pref.countries.includes(p.country))&&(!pref.categories.length||pref.categories.includes(p.category))&&(!pref.project_types.length||pref.project_types.includes(p.project_type))&&(pref.risk_tolerance!=="low"||!p.risk_signals.some(r=>r.severity==="critical"))&&Number(c.unit_price)<=Number(pref.budget)/pref.required_credits;
  }).map(project=>{
    const risk=project.score?.risk_score??100;
    const factors:[[number,number],...[number,number][]]=[[project.score?.overall_score??0,30],[Math.max(0,100-Math.abs(risk-({low:12,medium:35,high:60}[pref.risk_tolerance]))),20],[Math.max(0,100-Number(project.credits[0].unit_price)/(Number(pref.budget)/pref.required_credits)*35),20]];
    if(pref.categories.length||pref.project_types.length)factors.push([100,10]);
    if(pref.countries.length)factors.push([100,10]);
    if(pref.sdgs.length)factors.push([pref.sdgs.filter(s=>project.sdgs.includes(s)).length/pref.sdgs.length*100,10]);
    return {project,match_score:Number((factors.reduce((s,[n,w])=>s+n*w,0)/factors.reduce((s,[,w])=>s+w,0)).toFixed(1)),reasons:[`Quality score meets your ${pref.minimum_quality}/100 minimum`,`${COUNTRY_NAMES[project.country]} matches your geographic scope`,"INR price snapshot fits your per-credit budget"],trade_offs:[project.risk_signals.length?"Review missing verification evidence":"Permanence and delivery still require evidence review","Synthetic demonstration data; not a purchasing recommendation"]};
  }).sort((a,b)=>b.match_score-a.match_score);
}
export function validatePreference(pref:BuyerPreference) {
  if(!Number.isFinite(Number(pref.budget))||Number(pref.budget)<=0||!Number.isInteger(pref.required_credits)||pref.required_credits<1)throw new ApiError("INVALID_PREFERENCES","Enter a positive budget and a whole number of required credits.");
  if(pref.min_projects<1||pref.max_projects<pref.min_projects||pref.max_projects>30)throw new ApiError("INVALID_PREFERENCES","Maximum projects must be at least the minimum and no more than 30.");
  if(pref.concentration_limit<=0||pref.concentration_limit>100||pref.max_projects*pref.concentration_limit<100)throw new ApiError("NO_FEASIBLE_PORTFOLIO","The project-count and concentration limits cannot allocate 100% of your credits. Increase either limit.");
}
/** Illustrative allocator, explicitly not the planned OR-Tools optimizer. Every returned allocation is constraint-checked. */
export function demoPortfolio(pref:BuyerPreference, locked:PortfolioItem[]=[]):Portfolio {
  validatePreference(pref);
  const eligible=demoRecommendations(pref).map(x=>x.project);
  const cap=Math.floor(pref.required_credits*pref.concentration_limit/100);
  if(locked.some(x=>!eligible.some(p=>p.id===x.project_id)||x.quantity>cap||x.quantity>(eligible.find(p=>p.id===x.project_id)?.credits[0].available_quantity??0)))throw new ApiError("NO_FEASIBLE_PORTFOLIO","A locked allocation conflicts with eligibility, inventory or concentration. Unlock it or adjust your preferences.");
  const requiredCount=Math.max(pref.min_projects,Math.ceil(pref.required_credits/Math.max(cap,1)),locked.length);
  if(requiredCount>pref.max_projects||eligible.length<requiredCount)throw new ApiError("NO_FEASIBLE_PORTFOLIO","Too few eligible projects satisfy your project-count and concentration limits. Broaden geography, lower minimum quality, or increase your budget.");
  const selected=[...locked.map(x=>eligible.find(p=>p.id===x.project_id)!),...eligible.filter(p=>!locked.some(x=>x.project_id===p.id))].slice(0,requiredCount);
  let remaining=pref.required_credits-locked.reduce((n,x)=>n+x.quantity,0);
  if(remaining<0)throw new ApiError("NO_FEASIBLE_PORTFOLIO","Locked credits exceed the requested quantity.");
  const quantities=selected.map(p=>locked.find(x=>x.project_id===p.id)?.quantity??0);
  let unlocked=selected.filter(p=>!locked.some(x=>x.project_id===p.id)).length;
  selected.forEach((p,i)=>{if(locked.some(x=>x.project_id===p.id))return;const q=Math.min(cap,p.credits[0].available_quantity??0,Math.ceil(remaining/unlocked));quantities[i]=q;remaining-=q;unlocked--;});
  if(remaining!==0||quantities.some(q=>q<1))throw new ApiError("NO_FEASIBLE_PORTFOLIO","The demonstration allocator cannot meet this quantity with the available inventory and locks. Adjust the constraints.");
  const items:PortfolioItem[]=selected.map((p,i)=>({credit_id:p.credits[0].id,project_id:p.id,project_name:p.name,category:p.category,quantity:quantities[i],unit_price_snapshot:p.credits[0].unit_price!,allocation_percent:quantities[i]/pref.required_credits*100,risk_score_snapshot:p.score?.risk_score??null,score_snapshot:p.score,warnings_snapshot:p.risk_signals,source_snapshot:p.provenance,locked:locked.some(x=>x.project_id===p.id)}));
  const cost=items.reduce((sum,x)=>sum+Math.round(Number(x.unit_price_snapshot)*100)*x.quantity,0)/100;
  if(cost>Number(pref.budget))throw new ApiError("NO_FEASIBLE_PORTFOLIO","The demonstration allocation exceeds your budget. Increase the budget or adjust your constraints.");
  return {id:crypto.randomUUID(),name:pref.name,currency:pref.currency,items,total_cost:cost.toFixed(2),total_credits:pref.required_credits,portfolio_risk:Number((items.reduce((s,x)=>s+(x.risk_score_snapshot??0)*x.quantity,0)/pref.required_credits+items.reduce((s,x)=>s+(x.allocation_percent/100)**2,0)*10).toFixed(1)),optimizer_version:"demo-illustrative-1.0.0",created_at:new Date().toISOString(),is_synthetic:true};
}
function load<T>(key:string,fallback:T):T {try{return typeof window!=="undefined"?JSON.parse(localStorage.getItem(`carboniq.demo.${key}`)||JSON.stringify(fallback)):fallback;}catch{return fallback;}}
function save(key:string,value:unknown) {try{localStorage.setItem(`carboniq.demo.${key}`,JSON.stringify(value));}catch{throw new ApiError("STORAGE_UNAVAILABLE","Your browser could not save this demonstration. Check storage settings.");}}
export function createDemoService():CarbonIQService {
  return {
    projects:async filters=>filterProjects(filters||DEFAULT_FILTERS),
    project:async id=>{const p=DEMO_PROJECTS.find(p=>p.id===id);if(!p)throw new ApiError("NOT_FOUND","Project not found.");return p;},
    compare:async ids=>DEMO_PROJECTS.filter(p=>ids.includes(p.id)),
    login:async()=>({id:"demo-buyer",name:"Demo buyer",email:"demo@carboniq.example",role:"buyer"}),
    register:async()=>({id:"demo-buyer",name:"Demo buyer",email:"demo@carboniq.example",role:"buyer"}),
    logout(){},
    preferences:async()=>load<BuyerPreference[]>("preferences",[]),
    savePreference:async preference=>{const p={...preference,id:preference.id||crypto.randomUUID()};validatePreference(p);const all=load<BuyerPreference[]>("preferences",[]);save("preferences",[p,...all.filter(x=>x.id!==p.id)]);return p;},
    recommendations:async preference=>({id:crypto.randomUUID(),items:demoRecommendations(preference),engine_version:"demo-illustrative-1.0.0",data_snapshot:AS_OF,created_at:new Date().toISOString(),stale:false}),
    optimize:async(pref,locked)=>demoPortfolio(pref,locked),
    portfolios:async()=>load<Portfolio[]>("portfolios",[]),
    savePortfolio:async portfolio=>{const all=load<Portfolio[]>("portfolios",[]);save("portfolios",[portfolio,...all.filter(x=>x.id!==portfolio.id)]);return portfolio;},
    ask:async()=>({answer:"No project documents have been ingested in this demonstration. CarbonIQ cannot support a factual answer without project-specific evidence.",status:"insufficient_evidence",citations:[],limitations:["Demonstration mode. Connect the document-ingestion and assistant API to enable grounded answers."]}),
    simulate:async portfolio=>{const order:SimulatedOrder={id:crypto.randomUUID(),portfolio:structuredClone(portfolio),created_at:new Date().toISOString(),disclaimer:DISCLAIMER,disclaimer_version:"1.0.0"};save(`order.${order.id}`,order);return order;},
    report:async order=>new Blob([JSON.stringify(order,null,2)],{type:"application/json"}),
    importProjects:async()=>{throw new ApiError("API_REQUIRED","Imports require a connected API and a curator or administrator account.");},
    importStatus:async()=>{throw new ApiError("API_REQUIRED","Import status requires a connected API.");}
  };
}
