import { describe, expect, it, vi } from "vitest";
import { api } from "../helpers.mjs";

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
