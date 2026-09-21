// Deterministic secrets for unit tests (never real keys).
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.SIGNING_SECRET ??= "unit-test-signing-secret-value";
process.env.LOG_LEVEL ??= "fatal";
