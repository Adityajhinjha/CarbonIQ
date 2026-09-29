/** Frontend DTOs derived from PROJECT_DOCUMENTATION.md. Confirm field shapes against backend OpenAPI before live release. */
export type Category = "avoidance" | "reduction" | "removal" | "mixed";
export type Role = "visitor" | "buyer" | "curator" | "administrator";
export type Severity = "informational" | "low" | "medium" | "high" | "critical";
export type Mode = "demo" | "api";
export interface User { id: string; name: string; email: string; role: Role }
export interface Provenance { source_organization: string; source_url: string | null; data_as_of: string; retrieved_at: string; classification: "verified" | "derived" | "synthetic" }
export interface CarbonCredit { id: string; project_id: string; vintage: number | null; currency: string; unit_price: string | null; available_quantity: number | null; data_as_of: string; is_synthetic: boolean }
export interface RiskSignal { id: string; code: string; severity: Severity; explanation: string; evidence: string; rule_version: string; detected_at: string; human_review: boolean }
export const SCORE_COMPONENTS = [
  ["integrity", "Climate integrity and additionality", 25],
  ["permanence", "Permanence and reversal protection", 15],
  ["verification", "Verification and methodology quality", 15],
  ["co_benefits", "Social and biodiversity co-benefits", 15],
  ["value", "Price and buyer value", 10],
  ["delivery", "Delivery and developer reliability", 10],
  ["compatibility", "Regulatory and claims compatibility", 10],
] as const;
export type ComponentName = typeof SCORE_COMPONENTS[number][0];
export interface ProjectScore { overall_score: number | null; quality_score: number | null; impact_score: number | null; risk_score: number | null; confidence: number; components: Record<ComponentName, number | null>; methodology_version: string; calculated_at: string; missing_evidence: string[]; status: "scored" | "insufficient_evidence" }
export interface ProjectDocument { id: string; title: string; status: "ready" | "processing" | "failed"; url: string | null; pages: number | null }
export interface Project { id: string; name: string; developer: string; project_type: string; category: Category; country: string; registry: string | null; external_project_id: string | null; methodology: string | null; verification_status: string | null; validation_status: string | null; monitoring_status: string | null; issuance_status: string | null; retirement_status: string | null; latitude: number | null; longitude: number | null; description: string; image_url: string | null; sdgs: number[]; credits: CarbonCredit[]; score: ProjectScore | null; risk_signals: RiskSignal[]; documents: ProjectDocument[]; provenance: Provenance; is_synthetic: boolean }
export interface ProjectFilters { query: string; category: string; country: string; project_type: string; registry: string; verification_status: string; vintage: string; max_price: string; max_risk: string; sdg: string; sort: string; page: number; page_size: number }
export interface PageResult<T> { items: T[]; total: number; page: number; page_size: number }
export interface BuyerPreference { id?: string; name: string; currency: string; budget: string; required_credits: number; risk_tolerance: "low" | "medium" | "high"; countries: string[]; categories: Category[]; project_types: string[]; sdgs: number[]; minimum_quality: number; delivery_period: string; min_projects: number; max_projects: number; concentration_limit: number }
export interface RecommendationItem { project: Project; match_score: number; reasons: string[]; trade_offs: string[] }
export interface RecommendationRun { id: string; items: RecommendationItem[]; engine_version: string; data_snapshot: string; created_at: string; stale: boolean }
export interface PortfolioItem { credit_id: string; project_id: string; project_name: string; category: Category; quantity: number; unit_price_snapshot: string; allocation_percent: number; risk_score_snapshot: number | null; score_snapshot: ProjectScore | null; warnings_snapshot: RiskSignal[]; source_snapshot: Provenance; locked: boolean }
export interface Portfolio { id: string; name: string; currency: string; items: PortfolioItem[]; total_cost: string; total_credits: number; portfolio_risk: number | null; optimizer_version: string; created_at: string; is_synthetic: boolean }
export interface AssistantAnswer { answer: string; status: "supported" | "insufficient_evidence" | "conflicting_evidence" | "unavailable"; citations: { document_id: string; title: string; page: number | null; excerpt: string; url: string | null }[]; limitations: string[] }
export interface SimulatedOrder { id: string; portfolio: Portfolio; created_at: string; disclaimer: string; disclaimer_version: string }
export interface ImportBatch { id: string; status: string; accepted_rows: number; rejected_rows: number; errors: { row: number; field: string; message: string }[] }
export interface CarbonIQService {
  projects(filters: ProjectFilters, signal?: AbortSignal): Promise<PageResult<Project>>;
  project(id: string): Promise<Project>;
  compare(ids: string[]): Promise<Project[]>;
  login(email: string, password: string): Promise<User>;
  register(name: string, email: string, password: string): Promise<User>;
  logout(): void;
  preferences(): Promise<BuyerPreference[]>;
  savePreference(preference: BuyerPreference): Promise<BuyerPreference>;
  recommendations(preference: BuyerPreference): Promise<RecommendationRun>;
  optimize(preference: BuyerPreference, locked?: PortfolioItem[]): Promise<Portfolio>;
  portfolios(): Promise<Portfolio[]>;
  savePortfolio(portfolio: Portfolio): Promise<Portfolio>;
  ask(projectId: string, question: string): Promise<AssistantAnswer>;
  simulate(portfolio: Portfolio): Promise<SimulatedOrder>;
  report(order: SimulatedOrder): Promise<Blob>;
  importProjects(file: File): Promise<ImportBatch>;
  importStatus(id: string): Promise<ImportBatch>;
}
export const DEFAULT_FILTERS: ProjectFilters = { query:"",category:"",country:"",project_type:"",registry:"",verification_status:"",vintage:"",max_price:"",max_risk:"",sdg:"",sort:"score_desc",page:1,page_size:9 };
export const DEFAULT_PREFERENCE: BuyerPreference = { name:"My climate strategy",currency:"INR",budget:"1000000",required_credits:1000,risk_tolerance:"low",countries:["IN"],categories:[],project_types:[],sdgs:[],minimum_quality:65,delivery_period:"2026",min_projects:3,max_projects:5,concentration_limit:40 };
export const COUNTRY_NAMES: Record<string,string> = {IN:"India",BR:"Brazil",KE:"Kenya",ID:"Indonesia",US:"United States"};
export const DISCLAIMER = "Demonstration only. No credits were purchased, transferred or retired.";
export function money(value: string | number | null | undefined, currency = "INR") { return value == null ? "Not available" : new Intl.NumberFormat("en-IN",{style:"currency",currency,maximumFractionDigits:0}).format(Number(value)); }
export function number(value: number | null | undefined) { return value == null ? "Not available" : new Intl.NumberFormat("en-IN",{maximumFractionDigits:1}).format(value); }
export function safeUrl(value: string | null | undefined) { if (!value) return undefined; try { const url = new URL(value); return ["http:","https:"].includes(url.protocol) ? url.href : undefined; } catch { return undefined; } }
