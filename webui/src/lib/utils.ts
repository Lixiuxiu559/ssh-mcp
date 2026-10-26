import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export function formatTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", { hour12: false });
}
export function errorText(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试";
}
export async function copyText(value: string) {
  if (navigator.clipboard && window.isSecureContext)
    return navigator.clipboard.writeText(value);
  throw new Error("当前环境不支持自动复制，请选中文本后复制");
}
