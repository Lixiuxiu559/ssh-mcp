import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ArrowUp, ArrowDown, CornerDownLeft } from "lucide-react";
import { Modal } from "./ui/dialog";
import type { Page } from "../types";
export const navigation: { id: Page; label: string; description: string }[] = [
  { id: "servers", label: "服务器", description: "连接配置与目标主机" },
  { id: "tokens", label: "MCP Token", description: "独立服务凭证与客户端接入" },
  { id: "users", label: "用户管理", description: "登录账号与人员状态" },
  {
    id: "mcp-audit",
    label: "MCP 调用审计",
    description: "Token、目标与工具操作",
  },
  {
    id: "person-audit",
    label: "人员操作审计",
    description: "账号、凭证与配置变更",
  },
];
export function CommandPalette({
  open,
  onOpenChange,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (page: Page) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(
    () =>
      navigation.filter((item) =>
        `${item.label}${item.description}${item.id}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [query],
  );
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [open]);
  function navigate(page: Page) {
    onNavigate(page);
    onOpenChange(false);
  }
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="快速前往"
      description="搜索工作区页面，使用方向键选择。"
    >
      <div className="command-input">
        <Search size={18} />
        <input
          ref={input}
          className="input"
          aria-label="搜索页面"
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((i) => Math.min(i + 1, results.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((i) => Math.max(i - 1, 0));
            }
            if (e.key === "Enter" && results[selected]) {
              e.preventDefault();
              navigate(results[selected].id);
            }
          }}
          aria-controls="command-results"
          aria-activedescendant={
            results[selected] ? `command-${results[selected].id}` : undefined
          }
          role="combobox"
          aria-expanded="true"
          autoComplete="off"
        />
      </div>
      <div
        className="command-list"
        id="command-results"
        role="listbox"
        aria-label="页面搜索结果"
      >
        {results.length ? (
          results.map((item, i) => (
            <button
              type="button"
              id={`command-${item.id}`}
              key={item.id}
              role="option"
              aria-selected={i === selected}
              className={i === selected ? "selected" : ""}
              onMouseEnter={() => setSelected(i)}
              onClick={() => navigate(item.id)}
            >
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
              <CornerDownLeft size={16} />
            </button>
          ))
        ) : (
          <p className="empty-inline">没有匹配页面，尝试其他关键词。</p>
        )}
      </div>
      <div className="command-help">
        <ArrowUp size={12} />
        <ArrowDown size={12} />
        选择
        <CornerDownLeft size={12} />
        打开<kbd>Esc</kbd>关闭
      </div>
    </Modal>
  );
}
