import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const KEYCHAIN_SERVICE = "nlm-prompt";
const KEYCHAIN_ACCOUNT = "notebooklm-session";
function sessionFilePath(): string {
  const custom = process.env.NLM_PROMPT_SESSION_FILE;
  if (custom && custom.trim().length > 0) {
    return path.resolve(custom);
  }
  return path.resolve(homedir(), ".notebooklm", "session.json");
}

interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

export interface SessionResolution {
  cookiesObject: unknown | null;
  source: "keychain" | "session_file" | "none";
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStorageState(value: unknown): boolean {
  return isRecord(value) && Array.isArray(value.cookies);
}

async function loadKeytar(): Promise<KeytarLike | null> {
  try {
    const mod = (await import("keytar")) as Partial<KeytarLike>;
    if (
      typeof mod.getPassword === "function" &&
      typeof mod.setPassword === "function" &&
      typeof mod.deletePassword === "function"
    ) {
      return mod as KeytarLike;
    }
    return null;
  } catch {
    return null;
  }
}

async function readSessionFile(): Promise<unknown | null> {
  try {
    const raw = await readFile(sessionFilePath(), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function checkSessionFilePermission(): Promise<string | null> {
  try {
    const info = await stat(sessionFilePath());
    const mode = info.mode & 0o777;
    if ((mode & 0o077) !== 0) {
      return `Session file permissions are too broad (${mode.toString(8)}). Recommended: 600.`;
    }
    return null;
  } catch {
    return null;
  }
}

export async function resolveStoredSession(): Promise<SessionResolution> {
  const warnings: string[] = [];
  const keytar = await loadKeytar();

  if (keytar) {
    try {
      const secret = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
      if (secret) {
        const parsed = JSON.parse(secret);
        if (isStorageState(parsed)) {
          return {
            cookiesObject: parsed,
            source: "keychain",
            warnings,
          };
        }
      }
    } catch {
      warnings.push("Failed to decode keychain session. Falling back to session file.");
    }
  }

  const permissionWarning = await checkSessionFilePermission();
  if (permissionWarning) warnings.push(permissionWarning);

  const fileState = await readSessionFile();
  if (isStorageState(fileState)) {
    return {
      cookiesObject: fileState,
      source: "session_file",
      warnings,
    };
  }

  return {
    cookiesObject: null,
    source: "none",
    warnings,
  };
}

export async function storeSessionSecurely(storageState: unknown): Promise<{
  storedInKeychain: boolean;
  wroteFallbackFile: boolean;
}> {
  if (!isStorageState(storageState)) {
    throw new Error("Invalid storage state payload.");
  }

  let storedInKeychain = false;
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, JSON.stringify(storageState));
      storedInKeychain = true;
    } catch {
      storedInKeychain = false;
    }
  }

  const target = sessionFilePath();
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(storageState, null, 2)}\n`, "utf8");
  await chmod(target, 0o600);

  return {
    storedInKeychain,
    wroteFallbackFile: true,
  };
}

export async function clearStoredSession(): Promise<void> {
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      await keytar.deletePassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    } catch {
      // best effort
    }
  }
  await rm(sessionFilePath(), { force: true });
}
