import assert from "node:assert/strict";
import test from "node:test";

const API_BASE = "http://127.0.0.1:8000/api/v1";

test("API Health check returns ok and connected database", async () => {
  const res = await fetch(`${API_BASE}/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, "ok");
  assert.equal(data.database, "ok");
});

test("Projects catalogue returns 30 live projects with valid fields", async () => {
  const res = await fetch(`${API_BASE}/projects?page_size=50`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.total, 30);
  assert.ok(data.items.length >= 30);

  const first = data.items[0];
  assert.ok(first.id);
  assert.ok(first.name);
  assert.ok(first.category);
  assert.ok(first.carboniq_score > 0);
  assert.ok(first.confidence > 0);
});

test("Projects query filtering correctly filters by category", async () => {
  const res = await fetch(`${API_BASE}/projects?category=removal&page_size=50`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.total > 0);
  assert.ok(data.items.every((p: any) => p.category === "removal"));
});

test("AI Document Q&A assistant returns grounded citations", async () => {
  const projectsRes = await fetch(`${API_BASE}/projects?page_size=1`);
  const projectsData = await projectsRes.json();
  const projectId = projectsData.items[0].id;

  const askRes = await fetch(`${API_BASE}/projects/${projectId}/assistant/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "What supports the additionality of this project?" }),
  });

  assert.equal(askRes.status, 200);
  const answer = await askRes.json();
  assert.equal(answer.status, "supported");
  assert.ok(answer.answer.length > 20);
  assert.ok(answer.citations.length >= 1);
});

test("Portfolio optimization respects budget and credit targets", async () => {
  // First register or login test user
  const email = `testuser_${Date.now()}@example.com`;
  const regRes = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test Buyer", organization_name: "Test Org", email, password: "SecurePassword123!" }),
  });
  assert.equal(regRes.status, 201);

  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "SecurePassword123!" }),
  });
  assert.equal(loginRes.status, 200);
  const authData = await loginRes.json();
  const token = authData.access_token;

  const optRes = await fetch(`${API_BASE}/portfolios/optimize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      budget: 1000000,
      currency: "INR",
      required_credits: 500,
      min_projects: 3,
      max_projects: 5,
      concentration_limit: 40,
    }),
  });

  assert.equal(optRes.status, 200);
  const portfolio = await optRes.json();
  assert.ok(Math.abs(Number(portfolio.total_credits) - 500) < 0.05);
  assert.ok(Number(portfolio.total_cost) <= 1000000);
  assert.ok(portfolio.items.length >= 3);
  assert.ok(portfolio.items.length <= 5);
});
