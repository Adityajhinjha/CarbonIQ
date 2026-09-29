import type { CarbonIQService, User, Project, ProjectFilters, PageResult, BuyerPreference, RecommendationRun, Portfolio, PortfolioItem, AssistantAnswer, SimulatedOrder, ImportBatch, Category } from "./domain";

export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 0, public details: unknown = null, public requestId?: string) {
    super(message);
    this.name = "ApiError";
  }
}

const DEFAULT_PROJECT_PHOTOS: Record<string, string> = {
  "Mangrove Restoration": "https://images.unsplash.com/photo-1718661934073-ecfd78710651?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85&w=900",
  "Reforestation": "https://images.unsplash.com/photo-1631006995557-9866a74ee05c?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85&w=900",
  "Forest conservation": "https://images.unsplash.com/photo-1448375240586-882707db888b?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85&w=900",
  "REDD+ Avoided Deforestation": "https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85&w=900",
  "Improved Forest Management": "https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85&w=900",
  "Wind energy": "https://images.unsplash.com/photo-1543419163-155ebaf80730?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85&w=900",
  "Grid-Connected Wind": "https://images.unsplash.com/photo-1543419163-155ebaf80730?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85&w=900",
  "Biochar": "https://images.unsplash.com/photo-1500382017468-9049fed747ef?crop=entropy&cs=srgb&fm=jpg&w=900",
  "Biochar & Agroforestry": "https://images.unsplash.com/photo-1500382017468-9049fed747ef?crop=entropy&cs=srgb&fm=jpg&w=900",
  "Clean Cookstoves": "https://images.unsplash.com/photo-1544717305-2782549b5136?crop=entropy&cs=srgb&fm=jpg&w=900",
  "Peatland Restoration": "https://images.unsplash.com/photo-1718661934073-ecfd78710651?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85&w=900",
  "Agricultural Methane Capture": "https://images.unsplash.com/photo-1500382017468-9049fed747ef?crop=entropy&cs=srgb&fm=jpg&w=900",
};

function getProjectImage(raw: any): string | null {
  if (raw.image_url) return raw.image_url;
  const type = String(raw.project_type || "");
  for (const [key, photo] of Object.entries(DEFAULT_PROJECT_PHOTOS)) {
    if (type.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(type.toLowerCase())) {
      return photo;
    }
  }
  if (raw.category === "removal") return DEFAULT_PROJECT_PHOTOS["Mangrove Restoration"];
  if (raw.category === "reduction") return DEFAULT_PROJECT_PHOTOS["Clean Cookstoves"];
  return DEFAULT_PROJECT_PHOTOS["Improved Forest Management"];
}

export function normalizeProject(raw: any): Project {
  if (!raw) return raw;
  const id = String(raw.id || "");
  const creditsList = Array.isArray(raw.credits) && raw.credits.length > 0
    ? raw.credits
    : Array.isArray(raw.inventory) && raw.inventory.length > 0
      ? raw.inventory.map((c: any) => ({
          id: String(c.id || ""),
          project_id: id,
          vintage: c.vintage ?? raw.vintage_start ?? 2024,
          currency: c.currency || raw.currency || "INR",
          unit_price: String(c.price_per_credit ?? c.unit_price ?? raw.price_per_credit ?? "1200"),
          available_quantity: Number(c.quantity_available ?? c.available_quantity ?? raw.available_quantity ?? 10000),
          data_as_of: c.data_as_of || raw.data_as_of || new Date().toISOString().slice(0, 10),
          is_synthetic: Boolean(raw.is_synthetic),
        }))
      : [{
          id: `credit_${id}`,
          project_id: id,
          vintage: raw.vintage_start || 2024,
          currency: raw.currency || "INR",
          unit_price: String(raw.price_per_credit || "1200"),
          available_quantity: Number(raw.available_quantity || 10000),
          data_as_of: raw.data_as_of || new Date().toISOString().slice(0, 10),
          is_synthetic: Boolean(raw.is_synthetic),
        }];

  const scoreObj = raw.score || raw.latest_score || null;
  const score = scoreObj
    ? {
        id: String(scoreObj.id || `score_${id}`),
        project_id: id,
        methodology_version: scoreObj.methodology_version || "1.0.0",
        status: scoreObj.status || (scoreObj.carboniq_score != null || scoreObj.overall_score != null ? "scored" : "insufficient_evidence"),
        overall_score: scoreObj.overall_score ?? scoreObj.carboniq_score ?? null,
        quality_score: scoreObj.quality_score ?? scoreObj.carboniq_score ?? null,
        impact_score: scoreObj.impact_score ?? scoreObj.carboniq_score ?? null,
        risk_score: scoreObj.risk_score ?? 20,
        confidence: Number(scoreObj.confidence ?? 0.85),
        calculated_at: scoreObj.calculated_at || new Date().toISOString(),
        missing_evidence: scoreObj.missing_evidence || [],
        components: scoreObj.components || {
          integrity: scoreObj.carboniq_score ?? 75,
          permanence: scoreObj.carboniq_score ?? 75,
          verification: scoreObj.carboniq_score ?? 75,
          co_benefits: scoreObj.impact_score ?? 75,
          value: 80,
          delivery: 80,
          compatibility: 80,
        },
      }
    : (raw.carboniq_score != null
        ? {
            id: `score_${id}`,
            project_id: id,
            methodology_version: "1.0.0",
            status: "scored" as const,
            overall_score: Number(raw.carboniq_score),
            quality_score: Number(raw.carboniq_score),
            impact_score: Number(raw.impact_score ?? raw.carboniq_score),
            risk_score: Number(raw.risk_score ?? 20),
            confidence: Number(raw.confidence ?? 0.85),
            calculated_at: new Date().toISOString(),
            missing_evidence: [],
            components: {
              integrity: Number(raw.carboniq_score),
              permanence: Number(raw.carboniq_score),
              verification: Number(raw.carboniq_score),
              co_benefits: Number(raw.impact_score ?? raw.carboniq_score),
              value: 80,
              delivery: 80,
              compatibility: 80,
            },
          }
        : null);

  const rawSignals = raw.risk_signals || raw.active_risk_signals || [];
  const risk_signals = Array.isArray(rawSignals)
    ? rawSignals.map((s: any) => ({
        id: String(s.id || ""),
        code: s.code || "RISK_INFO",
        severity: (s.severity?.value || s.severity || "low").toLowerCase(),
        explanation: s.explanation || s.title || "Observation noted in verification report",
        evidence: s.evidence || s.message || "Detailed in registry filings",
        rule_version: s.rule_version || "1.0.0",
        detected_at: s.detected_at || new Date().toISOString(),
        human_review: Boolean(s.human_review ?? s.requires_review),
      }))
    : [];

  const rawDocs = raw.documents || [];
  const documents = Array.isArray(rawDocs)
    ? rawDocs.map((d: any) => ({
        id: String(d.id || ""),
        title: d.title || "Project Validation Document",
        status: d.status || "ready",
        url: d.source_url || d.url || null,
        pages: d.pages ?? d.page_count ?? 1,
      }))
    : [];

  return {
    id,
    name: raw.name || "Untitled Project",
    developer: raw.developer || raw.developer_name || "Unknown Developer",
    project_type: raw.project_type || "Carbon Abatement",
    category: (raw.category?.value || raw.category || "avoidance").toLowerCase() as Category,
    country: raw.country || raw.country_code || "IN",
    registry: raw.registry || "Verra",
    external_project_id: raw.external_project_id || raw.registry_project_id || raw.external_id || null,
    methodology: raw.methodology || null,
    verification_status: raw.verification_status?.value || raw.verification_status || "verified",
    validation_status: raw.validation_status || "completed",
    monitoring_status: raw.monitoring_status || "active",
    issuance_status: raw.issuance_status || "issued",
    retirement_status: raw.retirement_status || "none",
    latitude: raw.latitude != null ? Number(raw.latitude) : null,
    longitude: raw.longitude != null ? Number(raw.longitude) : null,
    description: raw.description || "",
    image_url: getProjectImage(raw),
    sdgs: Array.isArray(raw.sdgs) ? raw.sdgs : [],
    credits: creditsList,
    score,
    risk_signals,
    documents,
    provenance: raw.provenance || {
      source_organization: raw.registry || "Carbon Registry",
      source_url: raw.source_url || null,
      data_as_of: raw.data_as_of ? String(raw.data_as_of).slice(0, 10) : new Date().toISOString().slice(0, 10),
      retrieved_at: raw.created_at || new Date().toISOString(),
      classification: raw.is_synthetic ? "synthetic" : "verified",
    },
    is_synthetic: Boolean(raw.is_synthetic),
  };
}

export function normalizePortfolio(p: any): Portfolio {
  const items = Array.isArray(p.items) && p.items.length > 0 ? p.items : (p.holdings || []);
  return {
    id: String(p.id || ""),
    name: p.name || "Portfolio",
    currency: p.currency || "INR",
    total_cost: String(p.total_cost || "0"),
    total_credits: Number(p.total_credits || 0),
    portfolio_risk: p.portfolio_risk != null ? Number(p.portfolio_risk) : null,
    optimizer_version: p.optimizer_version || "1.0.0",
    created_at: p.created_at || new Date().toISOString(),
    is_synthetic: Boolean(p.is_synthetic),
    items: items.map((it: any) => ({
      credit_id: String(it.credit_id || ""),
      project_id: String(it.project_id || ""),
      project_name: it.project_name || "Project",
      category: (it.category || "avoidance").toLowerCase() as Category,
      quantity: Number(it.quantity || 0),
      unit_price_snapshot: String(it.unit_price_snapshot || it.price_per_credit || "0"),
      allocation_percent: Number(it.allocation_percent || 0),
      risk_score_snapshot: it.risk_score_snapshot != null ? Number(it.risk_score_snapshot) : null,
      score_snapshot: it.score_snapshot || null,
      warnings_snapshot: it.warnings_snapshot || [],
      source_snapshot: it.source_snapshot || {
        source_organization: "Registry",
        source_url: null,
        data_as_of: new Date().toISOString().slice(0, 10),
        retrieved_at: new Date().toISOString(),
        classification: "verified",
      },
      locked: Boolean(it.locked || it.is_locked),
    })),
  };
}

export function normalizePreference(p: any): BuyerPreference {
  return {
    id: String(p.id || ""),
    name: p.name || "Climate Strategy",
    currency: p.currency || "INR",
    budget: String(p.budget || "1000000"),
    required_credits: Number(p.required_credits || 1000),
    risk_tolerance: (p.risk_tolerance || "low").toLowerCase(),
    countries: p.preferred_countries || p.countries || ["IN"],
    categories: p.preferred_category ? [p.preferred_category] : (p.categories || []),
    project_types: p.preferred_project_types || p.project_types || [],
    sdgs: p.sdg_priorities || p.sdgs || [],
    minimum_quality: Number(p.minimum_quality_score ?? p.minimum_quality ?? 60),
    delivery_period: "2026",
    min_projects: 3,
    max_projects: 5,
    concentration_limit: 40,
  };
}

/** Live FastAPI backend adapter with request normalization and error envelopes. */
export function createApiService(baseUrl: string, onUnauthorized?: () => void): CarbonIQService {
  let token: string | null = typeof window !== "undefined" ? localStorage.getItem("carboniq_token") : null;
  const base = baseUrl.replace(/\/+$/, "");

  async function request<T>(path: string, options: RequestInit = {}, blob = false): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) controller.abort();

    try {
      const response = await fetch(`${base}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          Accept: blob ? "application/pdf" : "application/json",
          ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers,
        },
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const error = payload.error || (typeof payload.detail === "object" && !Array.isArray(payload.detail) ? payload.detail : payload);
        if (response.status === 401) {
          token = null;
          onUnauthorized?.();
        }
        const message =
          typeof error.message === "string"
            ? error.message
            : typeof payload.detail === "string"
              ? payload.detail
              : response.status === 422
                ? "Some fields were rejected by the API. Review your inputs."
                : `Request failed (${response.status}).`;

        throw new ApiError(
          error.code || "API_ERROR",
          message,
          response.status,
          error.details || payload.detail,
          error.request_id || response.headers.get("x-request-id") || undefined
        );
      }

      if (blob) return (await response.blob()) as T;
      return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (options.signal?.aborted) throw error;
      throw new ApiError(
        "CONNECTION_UNAVAILABLE",
        controller.signal.aborted
          ? "The API took too long to respond. Please try again."
          : "The CarbonIQ API could not be reached. Check the API address and allowed frontend origins."
      );
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    }
  }

  const post = <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

  return {
    async login(email: string, password: string): Promise<User> {
      const auth = await post<{ access_token: string }>("/auth/login", { email, password });
      token = auth.access_token;
      if (typeof window !== "undefined") {
        localStorage.setItem("carboniq_token", token);
      }
      const rawUser = await request<any>("/auth/me");
      const user: User = {
        id: String(rawUser.id),
        name: rawUser.name || rawUser.organization_name || "Buyer",
        email: rawUser.email,
        role: rawUser.role,
      };
      if (typeof window !== "undefined") {
        localStorage.setItem("carboniq_user", JSON.stringify(user));
      }
      return user;
    },

    async register(name: string, email: string, password: string): Promise<User> {
      await post<any>("/auth/register", {
        name,
        email,
        password,
        organization_name: name || "Individual Buyer",
      });
      return this.login(email, password);
    },

    logout(): void {
      token = null;
      if (typeof window !== "undefined") {
        localStorage.removeItem("carboniq_token");
        localStorage.removeItem("carboniq_user");
      }
    },

    async projects(filters: ProjectFilters, signal?: AbortSignal): Promise<PageResult<Project>> {
      const query = new URLSearchParams();
      if (filters.query) query.set("q", filters.query);
      if (filters.category) query.set("category", filters.category);
      if (filters.country) query.set("country", filters.country);
      if (filters.project_type) query.set("project_type", filters.project_type);
      if (filters.registry) query.set("registry", filters.registry);
      if (filters.verification_status) query.set("verification_status", filters.verification_status);
      if (filters.vintage) query.set("vintage_year", String(filters.vintage));
      if (filters.max_price) query.set("price_max", String(filters.max_price));
      if (filters.max_risk) query.set("risk_max", String(filters.max_risk));
      if (filters.sdg) query.set("sdg", String(filters.sdg));

      if (filters.sort) {
        if (filters.sort.includes("score")) {
          query.set("sort", "carboniq_score");
          query.set("order", filters.sort.endsWith("asc") ? "asc" : "desc");
        } else if (filters.sort.includes("price")) {
          query.set("sort", "price");
          query.set("order", filters.sort.endsWith("asc") ? "asc" : "desc");
        } else {
          query.set("sort", "name");
          query.set("order", filters.sort.endsWith("desc") ? "desc" : "asc");
        }
      }
      query.set("page", String(filters.page || 1));
      query.set("page_size", String(filters.page_size || 9));

      const pageResult = await request<any>(`/projects?${query}`, { signal });
      return {
        items: (pageResult.items || []).map(normalizeProject),
        total: pageResult.total || 0,
        page: pageResult.page || 1,
        page_size: pageResult.page_size || 9,
      };
    },

    async project(id: string): Promise<Project> {
      const proj = await request<any>(`/projects/${encodeURIComponent(id)}`);
      let score = null;
      let risk_signals = [];
      try {
        [score, risk_signals] = await Promise.all([
          request<any>(`/projects/${encodeURIComponent(id)}/score`),
          request<any[]>(`/projects/${encodeURIComponent(id)}/risk-signals`),
        ]);
      } catch {
        // Fall back gracefully to properties embedded in project detail
      }
      return normalizeProject({
        ...proj,
        score: score || proj.latest_score || proj.score,
        risk_signals: risk_signals && risk_signals.length > 0 ? risk_signals : (proj.active_risk_signals || proj.risk_signals),
      });
    },

    async compare(ids: string[]): Promise<Project[]> {
      const res = await post<any>("/projects/compare", { project_ids: ids });
      const items = Array.isArray(res) ? res : (res.items || []);
      return items.map(normalizeProject);
    },

    async preferences(): Promise<BuyerPreference[]> {
      const list = await request<any[]>("/preferences");
      return list.map(normalizePreference);
    },

    async savePreference(preference: BuyerPreference): Promise<BuyerPreference> {
      const payload = {
        name: preference.name || "Default Climate Strategy",
        budget: Number(preference.budget) || 1000000,
        currency: (preference.currency || "INR").toUpperCase(),
        required_credits: Number(preference.required_credits) || 1000,
        risk_tolerance: (preference.risk_tolerance || "low").toLowerCase(),
        preferred_countries: preference.countries && preference.countries.length > 0 ? preference.countries : ["IN"],
        preferred_category: preference.categories && preference.categories.length > 0 ? preference.categories[0] : null,
        preferred_project_types: preference.project_types || [],
        sdg_priorities: preference.sdgs || [],
        minimum_quality_score: Number(preference.minimum_quality) || 60,
      };

      const res = preference.id
        ? await request<any>(`/preferences/${encodeURIComponent(preference.id)}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await post<any>("/preferences", payload);

      return normalizePreference(res);
    },

    async recommendations(preference: BuyerPreference): Promise<RecommendationRun> {
      const res = await post<any>("/recommendations", { preference_id: preference.id });
      return {
        ...res,
        items: (res.items || []).map((it: any) => ({
          ...it,
          project: normalizeProject(it.project),
        })),
      };
    },

    async optimize(preference: BuyerPreference, locked: PortfolioItem[] = []): Promise<Portfolio> {
      const res = await post<any>("/portfolios/optimize", {
        preference_id: preference.id,
        budget: Number(preference.budget) || 1000000,
        currency: (preference.currency || "INR").toUpperCase(),
        required_credits: Number(preference.required_credits) || 1000,
        min_projects: preference.min_projects || 3,
        max_projects: preference.max_projects || 5,
        concentration_limit: preference.concentration_limit || 40,
        locked_allocations: locked.map(item => ({ credit_id: item.credit_id, quantity: item.quantity })),
      });
      return normalizePortfolio(res);
    },

    async portfolios(): Promise<Portfolio[]> {
      const list = await request<any[]>("/portfolios");
      return list.map(normalizePortfolio);
    },

    async savePortfolio(portfolio: Portfolio): Promise<Portfolio> {
      const res = await request<any>(`/portfolios/${encodeURIComponent(portfolio.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ name: portfolio.name }),
      });
      return normalizePortfolio(res);
    },

    async ask(id: string, question: string): Promise<AssistantAnswer> {
      return post<AssistantAnswer>(`/projects/${encodeURIComponent(id)}/assistant/ask`, { question });
    },

    async simulate(portfolio: Portfolio): Promise<SimulatedOrder> {
      const res = await post<any>("/orders/simulate", { portfolio_id: portfolio.id });
      return {
        id: String(res.id),
        portfolio: normalizePortfolio(res.portfolio),
        created_at: res.created_at || new Date().toISOString(),
        disclaimer: res.disclaimer || "Demonstration only. No credits were purchased, transferred or retired.",
        disclaimer_version: res.disclaimer_version || "1.0.0",
      };
    },

    async report(order: SimulatedOrder): Promise<Blob> {
      return request<Blob>(`/orders/${encodeURIComponent(order.id)}/report`, {}, true);
    },

    async importProjects(file: File): Promise<ImportBatch> {
      const form = new FormData();
      form.append("file", file);
      return request<ImportBatch>("/imports/projects", { method: "POST", body: form });
    },

    async importStatus(id: string): Promise<ImportBatch> {
      return request<ImportBatch>(`/imports/${encodeURIComponent(id)}`);
    },
  };
}
