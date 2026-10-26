import { useState, type FormEvent } from "react";
import { Upload, Cable } from "lucide-react";
import type { ServerEntry } from "../types";
import { api, json } from "../api";
import { Modal } from "./ui/dialog";
import { Field, Input } from "./ui/field";
import { Button } from "./ui/button";
import { Feedback } from "./ui/feedback";
import { errorText } from "../lib/utils";
const credentials = {
  private_key_file: "私钥文件",
  private_key_inline: "内嵌私钥",
  password: "密码",
};
export function ServerEditor({
  editing,
  onClose,
  onSaved,
}: {
  editing: ServerEntry | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [alias, setAlias] = useState(editing?.alias || "");
  const [host, setHost] = useState(editing?.host || "");
  const [port, setPort] = useState(editing?.port || 22);
  const [username, setUsername] = useState(editing?.username || "");
  const [description, setDescription] = useState(editing?.description || "");
  const [tags, setTags] = useState(editing?.tags.join(", ") || "");
  const [knownHosts, setKnownHosts] = useState("");
  const [type, setType] = useState(
    editing?.credential_type || "private_key_file",
  );
  const [secret, setSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "upload" | "">("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  function entry() {
    const result: Record<string, unknown> = {
      alias,
      host,
      port,
      username,
      description,
      tags: tags
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
    };
    if (knownHosts.trim()) result.known_hosts = knownHosts.trim();
    const fields: Record<string, string> = {};
    if (secret)
      fields[
        type === "password"
          ? "password"
          : type === "private_key_file"
            ? "path"
            : "private_key"
      ] = secret;
    if (passphrase && type !== "password") fields.passphrase = passphrase;
    if (
      !editing ||
      type !== editing.credential_type ||
      Object.keys(fields).length
    )
      result.credential = { type, ...fields };
    return result;
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy("save");
    setError("");
    setMessage("");
    try {
      await api(
        editing
          ? `/api/servers/${encodeURIComponent(editing.alias)}`
          : "/api/servers",
        json(editing ? "PUT" : "POST", entry()),
      );
      onSaved();
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy("");
    }
  }
  async function test() {
    setBusy("test");
    setError("");
    setMessage("");
    try {
      const value = await api<{
        ok: boolean;
        message?: string;
        error?: string;
      }>("/api/servers/test", json("POST", entry()));
      if (value.ok) setMessage(value.message || "连接成功");
      else setError(value.error || "连接失败");
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy("");
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    if (!alias.trim()) {
      setError("请先填写服务器别名，再上传私钥");
      return;
    }
    if (file.size > 65536) {
      setError("私钥文件不能超过 64 KiB");
      return;
    }
    setBusy("upload");
    setError("");
    setMessage("");
    try {
      const value = await api<{ path: string }>(
        "/api/keys",
        json("POST", { alias, content: await file.text() }),
      );
      setSecret(value.path);
      setMessage("私钥已上传到网关，请保存服务器配置以关联。");
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy("");
    }
  }
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      wide
      title={editing ? `编辑 ${editing.alias}` : "添加服务器"}
      description="配置 SSH 连接。凭据只写不读，保存后对后续调用生效。"
    >
      <form onSubmit={save} className="form-stack">
        <Feedback message={error} />
        <Feedback message={message} success />
        <div className="form-section">
          <h3>连接信息</h3>
          <div className="form-grid">
            <Field label="服务器别名">
              <Input
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                required
                pattern="[A-Za-z0-9_-]+"
                maxLength={100}
                disabled={!!editing}
                placeholder="prod-app-01"
              />
            </Field>
            <Field label="目标主机">
              <Input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                required
                placeholder="IP 或主机名"
              />
            </Field>
            <Field label="SSH 端口">
              <Input
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                required
              />
            </Field>
            <Field label="远端用户名">
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="off"
                placeholder="deploy"
              />
            </Field>
          </div>
        </div>
        <div className="form-section">
          <h3>身份凭据</h3>
          {editing && (
            <p className="muted small">
              保留当前凭据类型并将内容留空，即沿用已保存凭据。
            </p>
          )}
          <Field label="凭据类型">
            <select
              className="input"
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setSecret("");
                setPassphrase("");
              }}
            >
              {Object.entries(credentials).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={
              type === "password"
                ? "登录密码"
                : type === "private_key_file"
                  ? "网关上的私钥文件路径"
                  : "PEM 私钥内容"
            }
          >
            {type === "private_key_inline" ? (
              <textarea
                className="input textarea mono"
                rows={5}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                required={
                  !editing || type !== editing.credential_type || !!passphrase
                }
                placeholder="粘贴 PEM 私钥"
                spellCheck={false}
              />
            ) : (
              <Input
                value={secret}
                type={type === "password" ? "password" : "text"}
                onChange={(e) => setSecret(e.target.value)}
                required={
                  !editing || type !== editing.credential_type || !!passphrase
                }
                autoComplete="new-password"
                placeholder={
                  editing
                    ? "留空沿用原凭据"
                    : type === "password"
                      ? "输入 SSH 密码"
                      : "/data/keys/prod-app-01.pem"
                }
              />
            )}
          </Field>
          {type === "private_key_file" && (
            <label className={`upload-button ${busy ? "disabled" : ""}`}>
              <Upload size={15} />
              {busy === "upload" ? "正在上传…" : "上传本地 PEM 私钥"}
              <input
                type="file"
                accept=".pem,.key"
                disabled={!!busy}
                onChange={(e) => {
                  void upload(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
          )}
          {type !== "password" && (
            <Field label="私钥口令（可选）">
              <Input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
          )}
          <Field
            label="known_hosts 文件路径（可选）"
            hint={
              editing?.has_known_hosts
                ? "当前已启用主机指纹校验；留空保留现有设置。"
                : "配置网关上的指纹文件可启用主机身份校验。"
            }
          >
            <Input
              value={knownHosts}
              onChange={(e) => setKnownHosts(e.target.value)}
              placeholder="/data/keys/known_hosts"
            />
          </Field>
        </div>
        <div className="form-section">
          <h3>备注与分组</h3>
          <Field label="描述">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              placeholder="用途、维护事项"
            />
          </Field>
          <Field label="标签" hint="多个标签用逗号分隔。">
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="生产, 应用服务"
            />
          </Field>
        </div>
        <div className="dialog-actions">
          <Button type="button" onClick={() => void test()} disabled={!!busy}>
            <Cable size={16} />
            {busy === "test" ? "正在检测…" : "测试连接"}
          </Button>
          <div className="button-row">
            <Button
              type="button"
              variant="quiet"
              onClick={onClose}
              disabled={!!busy}
            >
              取消
            </Button>
            <Button type="submit" variant="primary" disabled={!!busy}>
              {busy === "save" ? "正在保存…" : "保存配置"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
