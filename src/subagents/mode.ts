/**
 * 子代理模式检查工具
 * 
 * 提供模式判断和统一执行接口
 */

export type SubagentMode = 'subagent' | 'native';

/**
 * 获取当前子代理模式
 * 
 * @returns 'subagent' (DeepSeek 子代理) 或 'native' (本地执行)
 */
export function getSubagentMode(): SubagentMode {
  const mode = process.env.OMX_SUBAGENT_MODE?.trim().toLowerCase();
  if (mode === 'subagent') {
    return 'subagent';
  }
  return 'native'; // 默认使用原生模式
}

/**
 * 检查是否启用了子代理模式
 * 
 * @returns true 如果使用子代理模式
 */
export function isSubagentEnabled(): boolean {
  return getSubagentMode() === 'subagent';
}

/**
 * 检查是否启用了原生模式
 * 
 * @returns true 如果使用原生模式
 */
export function isNativeMode(): boolean {
  return getSubagentMode() === 'native';
}

/**
 * 获取模式的人类可读描述
 * 
 * @returns 模式描述字符串
 */
export function getModeDescription(): string {
  const mode = getSubagentMode();
  if (mode === 'subagent') {
    return '子代理模式 (DeepSeek V4 Flash)';
  }
  return '原生模式 (本地 Shell 执行)';
}
