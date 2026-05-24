import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  clearStoredSession,
  resolveStoredSession,
  storeSessionSecurely,
} from "../src/auth/sessionStore.js";

const storageState = {
  cookies: [
    {
      name: "SID",
      value: "dummy",
      domain: ".google.com",
    },
  ],
};

describe("session store", () => {
  it("stores and loads fallback session file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nlm-auth-"));
    process.env.NLM_PROMPT_SESSION_FILE = path.join(dir, "session.json");

    await clearStoredSession();
    await storeSessionSecurely(storageState);

    const resolved = await resolveStoredSession();
    expect(resolved.source).toBe("session_file");
    expect(resolved.cookiesObject).not.toBeNull();

    await rm(dir, { recursive: true, force: true });
    delete process.env.NLM_PROMPT_SESSION_FILE;
  });

  it("warns when session file permissions are too broad", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nlm-auth-"));
    const target = path.join(dir, "session.json");
    process.env.NLM_PROMPT_SESSION_FILE = target;

    await clearStoredSession();
    await storeSessionSecurely(storageState);
    await chmod(target, 0o644);

    const resolved = await resolveStoredSession();
    expect(resolved.warnings.length).toBeGreaterThan(0);

    await rm(dir, { recursive: true, force: true });
    delete process.env.NLM_PROMPT_SESSION_FILE;
  });
});
