// Qualified against codex-cli 0.171.0 (Linux), including forged tool calls.
// Source catalog: openai/codex rust-v0.171.0, codex-rs/models-manager/models.json.
import catalog from './staff-qa-codex-catalog.json' with { type: 'json' };

export const CODEX_QA_VERSION = '0.171.0';
export const CODEX_QA_MODEL = 'gpt-6.2-sol';
export const CODEX_QA_TIMEOUT_MS = 120_000;
export const CODEX_QA_CATALOG = catalog;

// Capability controls only: retain credential masking and unrelated runtime protections.
export const CODEX_QA_DISABLED_FEATURES = [
  'shell_tool', 'hooks', 'plugin_hooks', 'plugins', 'apps', 'tool_suggest', 'tool_search',
  'search_tool', 'js_repl', 'in_app_browser', 'computer_use', 'image_generation', 'view_image',
  'multi_agent_v2', 'multi_agent_v2_dynamic_tools', 'memories', 'goals', 'runtime_agent_instances',
  'remote_control', 'request_permissions_tool', 'send_message_to_user_async', 'token_budget',
  'deferred_executor', 'standalone_web_search', 'shell_snapshot', 'shell_snapshot_v2',
  'external_agent_memory_import', 'chronicle', 'code_mode', 'current_time_reminder', 'sleep_tool',
] as const;

export function codexQaModelProblem(model: string | undefined): string | undefined {
  return model === CODEX_QA_MODEL ? undefined
    : `Isolated Codex Q&A is qualified only for explicitly selected ${CODEX_QA_MODEL}. This manager uses ${model ?? 'an unspecified model'}; Office will not switch models or providers automatically.`;
}

export function codexQaConfig(catalogFile: string): string {
  return [
    `model = ${JSON.stringify(CODEX_QA_MODEL)}`,
    'model_provider = "openai"',
    `model_catalog_json = ${JSON.stringify(catalogFile)}`,
    'cli_auth_credentials_store = "file"',
    'project_doc_max_bytes = 0',
    'web_search = "disabled"',
    'approval_policy = "never"',
    'sandbox_mode = "read-only"',
    '[analytics]', 'enabled = false',
    '[agents]', 'enabled = false',
    '[tools.update_plan]', 'enabled = false',
    '[tools.experimental_request_user_input]', 'enabled = false',
    '[features]', ...CODEX_QA_DISABLED_FEATURES.map((name) => `${name} = false`), '',
  ].join('\n');
}
