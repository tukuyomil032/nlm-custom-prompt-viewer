import type { AppConfig } from "../config/types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface UpdateCheckResult {
  checked: boolean;
  latestVersion: string | null;
  hasUpdate: boolean;
  nextConfig: AppConfig;
}

function parseVersion(version: string): number[] {
  return version
    .split(".")
    .slice(0, 3)
    .map((part) => {
      const n = Number(part.replace(/[^0-9].*$/, ""));
      return Number.isFinite(n) ? n : 0;
    });
}

export function isNewerVersion(current: string, latest: string): boolean {
  const a = parseVersion(current);
  const b = parseVersion(latest);
  for (let i = 0; i < 3; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (right > left) return true;
    if (right < left) return false;
  }
  return false;
}

export function shouldSkipCachedCheck(lastCheckedAt: string | null): boolean {
  if (!lastCheckedAt) return false;
  const ts = Date.parse(lastCheckedAt);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < DAY_MS;
}

export async function fetchLatestVersion(
  packageName: string,
  fetcher: typeof fetch = fetch
): Promise<string | null> {
  try {
    const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`;
    const response = await fetcher(url, {
      headers: {
        accept: "application/json"
      }
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { version?: unknown };
    return typeof payload.version === "string" ? payload.version : null;
  } catch {
    return null;
  }
}

export async function checkForUpdates(params: {
  packageName: string;
  currentVersion: string;
  config: AppConfig;
  force?: boolean;
  fetcher?: typeof fetch;
}): Promise<UpdateCheckResult> {
  const { packageName, currentVersion, config, force = false, fetcher } = params;
  if (!config.updateCheck.enabled && !force) {
    return {
      checked: false,
      latestVersion: config.updateCheck.latestSeenVersion,
      hasUpdate: false,
      nextConfig: config
    };
  }

  if (!force && shouldSkipCachedCheck(config.updateCheck.lastCheckedAt)) {
    return {
      checked: false,
      latestVersion: config.updateCheck.latestSeenVersion,
      hasUpdate:
        config.updateCheck.latestSeenVersion !== null &&
        isNewerVersion(currentVersion, config.updateCheck.latestSeenVersion),
      nextConfig: config
    };
  }

  const latestVersion = await fetchLatestVersion(packageName, fetcher);
  const now = new Date().toISOString();
  const nextConfig: AppConfig = {
    ...config,
    updateCheck: {
      ...config.updateCheck,
      lastCheckedAt: now,
      latestSeenVersion: latestVersion
    }
  };

  if (!latestVersion) {
    return {
      checked: true,
      latestVersion: null,
      hasUpdate: false,
      nextConfig
    };
  }

  return {
    checked: true,
    latestVersion,
    hasUpdate: isNewerVersion(currentVersion, latestVersion),
    nextConfig
  };
}
