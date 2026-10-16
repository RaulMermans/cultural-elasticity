// TEST DOUBLE for the `qloo` executable, used only by exec-transport tests.
// It never contacts Qloo. Behaviour is selected with FAKE_QLOO_MODE.
const [, , command, operation] = process.argv;
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const mode = process.env.FAKE_QLOO_MODE;
  if (command !== "exec") {
    process.stderr.write("fake qloo: only exec is supported\n");
    process.exit(2);
  }
  if (mode === "ok") {
    process.stdout.write(
      JSON.stringify({
        schema_version: "1.0-preview.1",
        operation,
        status: "ok",
        results: [],
        echo: JSON.parse(input),
        execution: { transport: "direct", transport_name: "fake", correlation_id: "fake-1", duration_ms: 0 },
      }) + "\n",
    );
    process.exit(0);
  }
  if (mode === "auth") {
    process.stdout.write(
      JSON.stringify({
        error: { code: "QLOO_AUTH", layer: "qloo", retryable: false, recovery: "Set QLOO_API_KEY." },
        operation,
        correlation_id: "fake-2",
      }) + "\n",
    );
    process.exit(4);
  }
  if (mode === "garbage") {
    process.stdout.write("this is not json\n");
    process.exit(0);
  }
  if (mode === "crash-leaky") {
    process.stderr.write(`fatal: request with key ${process.env.QLOO_API_KEY} failed\n`);
    process.exit(1);
  }
  if (mode === "hang") {
    setTimeout(() => process.exit(0), 60_000);
    return;
  }
  process.exit(9);
});
