import {adjustmentKeys, limits} from './editor-engine.js';

export class PhotoError extends Error {
  constructor(code, message, details) { super(message); this.code = code; if (details) this.details = details; }
}
export const fail = (code, message, details) => { throw new PhotoError(code, message, details); };
export const settingsBounds = key => limits[key] || (['sharpen', 'denoise'].includes(key) ? [0, 75] : [-75, 75]);
export function object(value, allowed, code = 'INVALID_PLAN') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    fail(code, '包含不支持的字段或对象格式不正确。', {allowed});
  }
  return value;
}
export function cleanSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_SETTINGS', '调整必须是参数对象。');
  const result = {};
  for (const [key, n] of Object.entries(value)) {
    if (!adjustmentKeys.includes(key)) fail('UNKNOWN_PARAMETER', `不支持参数 ${key}。请先查看工具参数说明。`);
    const [a, b] = settingsBounds(key);
    if (typeof n !== 'number' || !Number.isFinite(n) || n < a || n > b) fail('PARAMETER_RANGE', `${key} 应在 ${a}～${b} 之间。`);
    result[key] = n;
  }
  return result;
}
export function cleanRect(value) {
  if (!value || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(value[k])) || value.x < 0 || value.y < 0 || value.width < .005 || value.height < .005 || value.x + value.width > 1.00001 || value.y + value.height > 1.00001) {
    fail('INVALID_REGION', '标记范围应在原片内，且不能为空。');
  }
  return Object.fromEntries(['x', 'y', 'width', 'height'].map(k => [k, value[k]]));
}
export function ids(value, code = 'INVALID_SELECTION') {
  if (!Array.isArray(value) || value.length > 32 || value.some(v => typeof v !== 'string' || !/^[-\w]{1,80}$/.test(v)) || new Set(value).size !== value.length) {
    fail(code, '编号列表必须是不重复的有效编号。');
  }
  return [...value];
}
export function bounded(value, min, max, code) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(code, `数值应在 ${min}～${max} 之间。`);
  return value;
}
// Canonical object keys make hashes independent of JSON property order.
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])]));
  return value;
}
export const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
