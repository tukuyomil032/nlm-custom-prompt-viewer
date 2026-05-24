export type LanguageCode = "en" | "ja";

export interface UpdateCheckConfig {
  enabled: boolean;
  lastCheckedAt: string | null;
  latestSeenVersion: string | null;
}

export interface AppConfig {
  language: LanguageCode;
  updateCheck: UpdateCheckConfig;
  auth: {
    lastValidatedAt: string | null;
    lastSource: "keychain" | "session_file" | "none" | null;
    lastStatus: "valid" | "invalid" | "missing" | null;
  };
}

export const DEFAULT_CONFIG: AppConfig = {
  language: "en",
  updateCheck: {
    enabled: true,
    lastCheckedAt: null,
    latestSeenVersion: null,
  },
  auth: {
    lastValidatedAt: null,
    lastSource: null,
    lastStatus: null,
  },
};
