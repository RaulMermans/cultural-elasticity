import { describe, expect, it } from "vitest";
import {
  harnessChildEnv,
  interpretDoctorOutput,
  LIVE_QLOO_HOST_NOT_VERIFIED,
  LIVE_QLOO_HOST_VERIFIED,
  QLOO_HACKATHON_ORIGIN,
  QlooEnvironmentError,
  requireHackathonBaseUrl,
} from "../src/qloo/environment.js";
import { assertHackathonRouting, HarnessExecTransport } from "../src/qloo/transport.js";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof QlooEnvironmentError ? error.code : `unexpected: ${String(error)}`;
  }
  return "no error";
};

describe("hackathon base URL validation", () => {
  it("accepts exactly the documented hackathon origin", () => {
    expect(requireHackathonBaseUrl("https://hackathon.api.qloo.com")).toBe(QLOO_HACKATHON_ORIGIN);
    expect(requireHackathonBaseUrl(" https://hackathon.api.qloo.com/ ")).toBe(QLOO_HACKATHON_ORIGIN);
  });

  it("fails closed when unset instead of defaulting to production", () => {
    expect(code(() => requireHackathonBaseUrl(undefined))).toBe("QLOO_HACKATHON_BASE_URL_REQUIRED");
    expect(code(() => requireHackathonBaseUrl("  "))).toBe("QLOO_HACKATHON_BASE_URL_REQUIRED");
  });

  it("rejects the production host", () => {
    expect(code(() => requireHackathonBaseUrl("https://api.qloo.com"))).toBe("QLOO_WRONG_ENVIRONMENT");
  });

  it("rejects the staging host", () => {
    expect(code(() => requireHackathonBaseUrl("https://staging.api.qloo.com"))).toBe("QLOO_WRONG_ENVIRONMENT");
  });

  it("rejects look-alikes, plain http, other ports, paths and embedded credentials", () => {
    expect(code(() => requireHackathonBaseUrl("https://hackathon.api.qloo.com.evil.example"))).toBe("QLOO_WRONG_ENVIRONMENT");
    expect(code(() => requireHackathonBaseUrl("http://hackathon.api.qloo.com"))).toBe("QLOO_WRONG_ENVIRONMENT");
    expect(code(() => requireHackathonBaseUrl("https://hackathon.api.qloo.com:8443"))).toBe("QLOO_WRONG_ENVIRONMENT");
    expect(code(() => requireHackathonBaseUrl("https://hackathon.api.qloo.com/v2"))).toBe("QLOO_BASE_URL_INVALID");
    expect(code(() => requireHackathonBaseUrl("https://u:p@hackathon.api.qloo.com"))).toBe("QLOO_BASE_URL_INVALID");
    expect(code(() => requireHackathonBaseUrl("not a url"))).toBe("QLOO_BASE_URL_INVALID");
  });
});

describe("harness child environment", () => {
  it("pins the harness upstream and replaces inherited routing variables", () => {
    const env = harnessChildEnv(
      { QLOO_BASE_URL: "https://api.qloo.com", QLOO_TRUSTED_BASE_URL: "https://api.qloo.com", TASTE_RESOLVER_URL: "https://x.example", QLOO_HOME: "/elsewhere", KEEP: "1" },
      QLOO_HACKATHON_ORIGIN,
      "/tmp/isolated",
    );
    expect(env).toMatchObject({ QLOO_BASE_URL: QLOO_HACKATHON_ORIGIN, QLOO_TRUSTED_BASE_URL: QLOO_HACKATHON_ORIGIN, QLOO_HOME: "/tmp/isolated", QLOO_RESOLUTION_PROVIDER: "native", KEEP: "1" });
    expect(env.TASTE_RESOLVER_URL).toBeUndefined();
  });

  it("the transport refuses an environment that would let the harness default to production", () => {
    expect(code(() => assertHackathonRouting({}))).toBe("QLOO_HACKATHON_BASE_URL_REQUIRED");
    expect(code(() => assertHackathonRouting({ QLOO_BASE_URL: "https://api.qloo.com" }))).toBe("QLOO_WRONG_ENVIRONMENT");
    expect(code(() => assertHackathonRouting({ QLOO_BASE_URL: QLOO_HACKATHON_ORIGIN }))).toBe("QLOO_WRONG_ENVIRONMENT");
    expect(code(() => new HarnessExecTransport({ env: { QLOO_API_KEY: "x" } }))).toBe("QLOO_HACKATHON_BASE_URL_REQUIRED");
    expect(code(() => new HarnessExecTransport({ env: harnessChildEnv({}, QLOO_HACKATHON_ORIGIN, "/tmp/x") }))).toBe("no error");
  });
});

describe("LIVE_QLOO_HOST_VERIFIED gate (offline doctor output)", () => {
  // [harness 0.1.26] doctor line formats, as observed offline on 2026-10-16.
  const trusted = "ok  qloo-endpoint-trust — Qloo API endpoint is explicitly trusted via QLOO_TRUSTED_BASE_URL: https://hackathon.api.qloo.com/";
  const production = "ok  qloo-endpoint-trust — Qloo API endpoint is official: https://api.qloo.com/";
  const untrusted = "warn  qloo-endpoint-trust — Custom Qloo API endpoint https://hackathon.api.qloo.com/ is not trusted. Run `qloo config set base-url <url>`";

  it("verifies only when the harness itself reports the hackathon origin", () => {
    expect(interpretDoctorOutput(`x\n${trusted}\ny`, QLOO_HACKATHON_ORIGIN)).toMatchObject({ status: LIVE_QLOO_HOST_VERIFIED, effectiveOrigin: QLOO_HACKATHON_ORIGIN, trustSource: "QLOO_TRUSTED_BASE_URL" });
  });

  it("does not verify when the harness would use production", () => {
    expect(interpretDoctorOutput(production, QLOO_HACKATHON_ORIGIN).status).toBe(LIVE_QLOO_HOST_NOT_VERIFIED);
  });

  it("does not verify an untrusted endpoint or missing output", () => {
    expect(interpretDoctorOutput(untrusted, QLOO_HACKATHON_ORIGIN).status).toBe(LIVE_QLOO_HOST_NOT_VERIFIED);
    expect(interpretDoctorOutput("", QLOO_HACKATHON_ORIGIN).status).toBe(LIVE_QLOO_HOST_NOT_VERIFIED);
  });
});
