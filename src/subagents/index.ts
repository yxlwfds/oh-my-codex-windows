/**
 * 执行子代理模块导出
 */

export { ExecutionSubagent, createExecutionSubagentFromEnv } from './execution-subagent.js';
export { SubagentCache, createSubagentCacheFromEnv } from './cache.js';
export {
  getSubagentMode,
  isSubagentEnabled,
  isNativeMode,
  getModeDescription
} from './mode.js';
export {
  EXECUTION_SUBAGENT_SYSTEM_PROMPT_BASIC,
  EXECUTION_SUBAGENT_SYSTEM_PROMPT_THINKING,
  MAIN_AGENT_SUBAGENT_INSTRUCTION,
  getSubagentSystemPrompt
} from './prompts.js';

export type {
  ThinkingMode,
  SubagentQuery,
  SubagentResponse,
  CommandSummary,
  CommandResult,
  ExecutionSubagentOptions,
  CacheOptions
} from './types.js';

export type { SubagentMode } from './mode.js';
