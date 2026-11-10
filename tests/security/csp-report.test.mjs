import { describe, expect, it, vi } from "vitest";
import { api, asAdmin } from "../helpers.mjs";

// SEC-02: relatórios da CSP do site viram uma linha [CSP] no log
describe("POST /api/csp-report", () => {
  const report = {
    "csp-report": {
      "document-uri": "https://blog.marck0101.com.br/cancelar-inscricao?t=segredo",
      "violated-directive": "script-src-elem",
      "blocked-uri": "https://evil.example/x.js?token=abc",
    },
  };

  it("formato report-uri: registra sem a query string (pode ter token)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await api().post("/api/csp-report").set("Content-Type", "application/csp-report").send(JSON.stringify(report));
    expect(res.status).toBe(204);
    const line = warn.mock.calls.map((c) => c[0]).find((l) => l.startsWith("[CSP]"));
    expect(line).toBe("[CSP] script-src-elem bloquearia https://evil.example/x.js em https://blog.marck0101.com.br/cancelar-inscricao");
  });

  it("formato Reporting API (lista)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = [{ type: "csp-violation", body: { effectiveDirective: "connect-src", blockedURL: "https://x.dev/api", documentURL: "https://blog.marck0101.com.br/blog" } }];
    const res = await api().post("/api/csp-report").set("Content-Type", "application/reports+json").send(JSON.stringify(body));
    expect(res.status).toBe(204);
    expect(warn.mock.calls.some((c) => c[0] === "[CSP] connect-src bloquearia https://x.dev/api em https://blog.marck0101.com.br/blog")).toBe(true);
  });

  it("guarda no banco agrupado, sem a query string (os logs da Vercel somem em ~1h)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 3; i++) {
      await api().post("/api/csp-report").set("Content-Type", "application/csp-report").send(JSON.stringify(report));
    }
    const admin = await asAdmin();
    const res = await admin.get("/api/csp-report");
    expect(res.status).toBe(200);
    expect(res.body.reports).toHaveLength(1);
    expect(res.body.reports[0]).toMatchObject({
      directive: "script-src-elem",
      blocked: "https://evil.example/x.js",
      page: "https://blog.marck0101.com.br/cancelar-inscricao",
      count: 3,
    });
  });

  it("lista do painel exige login", async () => {
    const res = await api().get("/api/csp-report");
    expect(res.status).toBe(401);
  });

  it("lixo no corpo: 204 sem quebrar", async () => {
    const res = await api().post("/api/csp-report").set("Content-Type", "application/json").send('{"qualquer":1}');
    expect(res.status).toBe(204);
  });

  it("limite por IP: depois de 30 relatórios em 10 min, para de logar", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 32; i++) {
      await api().post("/api/csp-report").set("Content-Type", "application/csp-report").send(JSON.stringify(report));
    }
    expect(warn.mock.calls.filter((c) => String(c[0]).startsWith("[CSP]"))).toHaveLength(30);
  });
});
