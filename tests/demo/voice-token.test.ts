import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/deepgram-token/route";
import { getSession, allGatesSet } from "../../lib/session/store";
import { demoSession } from "../../lib/demo/scenario";

vi.mock("../../lib/session/store", () => ({ getSession: vi.fn(), allGatesSet: vi.fn() }));

const request = () => new Request("http://localhost/api/deepgram-token", { method: "POST", body: JSON.stringify({ callId: "call-spouse-01" }) });

describe("voice session credentials", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockReturnValue(demoSession("spouse"));
    vi.mocked(allGatesSet).mockReturnValue(true);
    vi.stubEnv("DEEPGRAM_API_KEY", "test-server-credential");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("refuses provider access before the transfer gates", async () => {
    vi.mocked(allGatesSet).mockReturnValue(false);
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await POST(request())).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("never returns the server credential when the provider rejects a grant", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("denied", { status: 403 })));
    const response = await POST(request());
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.token).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("test-server-credential");
  });
  it("returns only the short-lived provider grant", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ access_token: "test-short-lived-grant", expires_in: 600 })));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ token: "test-short-lived-grant", scheme: "bearer", expiresIn: 600 });
  });
  it("refuses a malformed grant response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ expires_in: 600 })));
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect((await response.json()).token).toBeUndefined();
  });
});
