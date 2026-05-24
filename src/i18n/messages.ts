import type { LanguageCode } from "../config/types.js";

type Dict = Record<string, string>;

const en: Dict = {
  "cli.description": "NotebookLM custom prompt helper CLI",
  "prompt.description": "Read and export custom prompts from NotebookLM Studio artifacts.",
  "prompt.empty": "No supported artifacts found, or prompt extraction failed.",
  "prompt.table.header": "artifactId\ttype\tmethod\tprompt",
  "prompt.field.artifactId": "artifactId",
  "prompt.field.type": "type",
  "prompt.field.method": "method",
  "prompt.field.prompt": "prompt",
  "prompt.field.warnings": "warnings",
  "prompt.saved": "saved",
  "errors.unsupportedType": "Unsupported --type '{value}'. Supported: {supported}",
  "errors.badFormat": "`--format` must be `json` or `md`.",
  "errors.badLimit": "`--limit` must be an integer >= 1.",
  "errors.helpHint": "(Run with --help for usage.)",
  "config.description": "Read or update CLI configuration.",
  "config.current": "Current config",
  "config.saved": "Configuration saved.",
  "config.reset": "Configuration reset to defaults.",
  "config.language.prompt": "Choose display language",
  "config.language.changed": "Language changed to {value}.",
  "config.key.unknown": "Unknown config key: {key}. Supported keys: language",
  "config.value.invalidLanguage": "Invalid language: {value}. Use en or ja.",
  "update.description": "Check package update status.",
  "update.latest": "You are using the latest version ({current}).",
  "update.available": "Update available: {current} -> {latest}. Run `bun add -g {pkg}`.",
  "update.unreachable": "Could not reach npm registry. Skipping update check.",
  "auth.description": "Authentication commands.",
  "auth.status.valid": "Authentication status: valid ({source}).",
  "auth.status.missing": "Authentication status: missing. Run `nlm auth login`.",
  "auth.status.invalid": "Authentication status: invalid or expired.",
  "auth.login.start": "Opening browser for Google sign-in...",
  "auth.login.done": "Session saved securely.",
  "auth.logout.done": "Local authentication data has been cleared.",
};

const ja: Dict = {
  "cli.description": "NotebookLMカスタムプロンプト補助CLI",
  "prompt.description": "NotebookLM Studio成果物のカスタムプロンプトを取得・保存します。",
  "prompt.empty": "対応成果物が見つからないか、プロンプト抽出に失敗しました。",
  "prompt.table.header": "artifactId\ttype\tmethod\tprompt",
  "prompt.field.artifactId": "artifactId",
  "prompt.field.type": "type",
  "prompt.field.method": "method",
  "prompt.field.prompt": "prompt",
  "prompt.field.warnings": "warnings",
  "prompt.saved": "saved",
  "errors.unsupportedType": "未対応の --type '{value}' です。対応: {supported}",
  "errors.badFormat": "`--format` は `json` または `md` を指定してください。",
  "errors.badLimit": "`--limit` は1以上の整数を指定してください。",
  "errors.helpHint": "（使い方は --help を参照）",
  "config.description": "CLI設定の表示・更新を行います。",
  "config.current": "現在の設定",
  "config.saved": "設定を保存しました。",
  "config.reset": "設定を初期化しました。",
  "config.language.prompt": "表示言語を選択してください",
  "config.language.changed": "表示言語を {value} に変更しました。",
  "config.key.unknown": "不明な設定キーです: {key}。対応キー: language",
  "config.value.invalidLanguage": "不正な言語です: {value}。en または ja を指定してください。",
  "update.description": "パッケージの更新状況を確認します。",
  "update.latest": "最新バージョンを利用中です（{current}）。",
  "update.available":
    "更新があります: {current} -> {latest}。`bun add -g {pkg}` を実行してください。",
  "update.unreachable": "npmレジストリに接続できなかったため、更新確認をスキップしました。",
  "auth.description": "認証関連コマンドです。",
  "auth.status.valid": "認証状態: 有効（{source}）。",
  "auth.status.missing": "認証状態: 未設定です。`nlm auth login` を実行してください。",
  "auth.status.invalid": "認証状態: 無効または期限切れです。",
  "auth.login.start": "Googleサインイン用ブラウザを起動しています...",
  "auth.login.done": "セッションを安全に保存しました。",
  "auth.logout.done": "ローカル認証情報を削除しました。",
};

const dictionaries: Record<LanguageCode, Dict> = { en, ja };

export type MessageKey = keyof typeof en;

function format(template: string, vars?: Record<string, string>): string {
  if (!vars) return template;
  return Object.entries(vars).reduce(
    (acc, [key, value]) => acc.replaceAll(`{${key}}`, value),
    template,
  );
}

export function t(language: LanguageCode, key: MessageKey, vars?: Record<string, string>): string {
  const dict = dictionaries[language] ?? dictionaries.en;
  const template = dict[key] ?? dictionaries.en[key] ?? key;
  return format(template, vars);
}
