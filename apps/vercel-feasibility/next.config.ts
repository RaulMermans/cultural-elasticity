import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@qloo/qloo-harness", "workflow"],
  outputFileTracingIncludes: {
    "/api/poc": [
      "./node_modules/@qloo/qloo-harness/**/*",
      "./node_modules/typebox/**/*",
      "./node_modules/.pnpm/@qloo+qloo-harness@*/**/*",
      "./node_modules/.pnpm/typebox@*/**/*",
      "./fixtures/fake-qloo-mcp.mjs",
    ],
    "/api/workflow": ["./workflows/**/*"],
    "/.well-known/workflow": ["./workflows/**/*"],
  },
};

export default withWorkflow(nextConfig);
