export type LanguageCode = "en" | "ja";

export interface UpdateCheckConfig {
  enabled: boolean;
  lastCheckedAt: string | null;
  latestSeenVersion: string | null;
}

export interface AppConfig {
  language: LanguageCode;
  updateCheck: UpdateCheckConfig;
}

export const DEFAULT_CONFIG: AppConfig = {
  language: "en",
  updateCheck: {
    enabled: true,
    lastCheckedAt: null,
    latestSeenVersion: null
  }
};
