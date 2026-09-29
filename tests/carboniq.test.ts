import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../apps/web/src/carboniq/api";
import { DEFAULT_FILTERS, DEFAULT_PREFERENCE, SCORE_COMPONENTS } from "../apps/web/src/carboniq/domain";
import { DEMO_PROJECTS, demoPortfolio, filterProjects, validatePreference } from "../apps/web/src/carboniq/demo";

test("the documented seven score weights total 100 percent", () => {
  assert.equal(SCORE_COMPONENTS.reduce((total, [, , weight]) => total + weight, 0), 100);
});

test("synthetic fixtures use the documented weighted CarbonIQ score", () => {
  const scored = DEMO_PROJECTS[0].score!;
  const expected = SCORE_COMPONENTS.reduce(
    (total, [key, , weight]) => total + (scored.components[key] ?? 0) * weight / 100,
    0,
  );
  assert.equal(scored.overall_score, Number(expected.toFixed(1)));
  assert.equal(DEMO_PROJECTS[13].score?.status, "insufficient_evidence");
  assert.equal(DEMO_PROJECTS[13].score?.overall_score, null);
});

test("catalogue filtering preserves documented search and sorting behavior", () => {
  const result = filterProjects({ ...DEFAULT_FILTERS, query: "wind", sort: "price_asc" });
  assert.ok(result.total >= 1);
  assert.ok(result.items.every(project => project.name.toLowerCase().includes("wind") || project.project_type.toLowerCase().includes("wind")));
  assert.deepEqual(
    result.items.map(project => Number(project.credits[0].unit_price)),
    [...result.items].map(project => Number(project.credits[0].unit_price)).sort((a, b) => a - b),
  );
});

test("illustrative portfolio allocation respects quantity, budget and concentration", () => {
  const portfolio = demoPortfolio({ ...DEFAULT_PREFERENCE });
  assert.equal(portfolio.total_credits, DEFAULT_PREFERENCE.required_credits);
  assert.ok(Number(portfolio.total_cost) <= Number(DEFAULT_PREFERENCE.budget));
  assert.ok(portfolio.items.length >= DEFAULT_PREFERENCE.min_projects);
  assert.ok(portfolio.items.length <= DEFAULT_PREFERENCE.max_projects);
  assert.ok(portfolio.items.every(item => item.allocation_percent <= DEFAULT_PREFERENCE.concentration_limit));
});

test("incompatible diversification rules return NO_FEASIBLE_PORTFOLIO", () => {
  assert.throws(
    () => validatePreference({ ...DEFAULT_PREFERENCE, min_projects: 2, max_projects: 2, concentration_limit: 40 }),
    (error: unknown) => error instanceof ApiError && error.code === "NO_FEASIBLE_PORTFOLIO",
  );
});
