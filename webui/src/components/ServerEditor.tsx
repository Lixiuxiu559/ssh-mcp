import { useId, useState, type FormEvent } from "react";
import { Cable, Upload } from "lucide-react";
import {
  Button,
  Divider,
  FileButton,
  Group,
  NumberInput,
  PasswordInput,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import type { ServerEntry } from "../types";
import { api, json } from "../api";
import { Feedback } from "./Feedback";
import { AppModal } from "./AppModal";
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
  const formId = useId();
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
  async function upload(file?: File | null) {
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
    <AppModal
      opened
      onClose={() => {
        if (!busy) onClose();
      }}
      size="lg"
      title={editing ? `编辑 ${editing.alias}` : "添加服务器"}
      description="配置 SSH 连接。凭据只写不读，保存后对后续调用生效。"
      footer={
        <Group justify="space-between" w="100%" wrap="nowrap">
          <Button
            type="button"
            variant="default"
            onClick={() => void test()}
            disabled={!!busy}
            leftSection={<Cable size={15} aria-hidden="true" />}
          >
            {busy === "test" ? "正在检测…" : "测试连接"}
          </Button>
          <Group gap="sm">
            <Button
              type="button"
              variant="subtle"
              color="gray"
              onClick={onClose}
              disabled={!!busy}
            >
              取消
            </Button>
            <Button type="submit" form={formId} disabled={!!busy}>
              {busy === "save" ? "正在保存…" : "保存配置"}
            </Button>
          </Group>
        </Group>
      }
    >
      <form id={formId} onSubmit={save}>
        <Stack gap="md">
          <Feedback message={error} />
          <Feedback message={message} success />
          <Divider label="连接信息" labelPosition="left" />
          <Group grow align="flex-start" gap="md">
            <TextInput
              label="服务器别名"
              value={alias}
              onChange={(event) => setAlias(event.currentTarget.value)}
              required
              pattern="[A-Za-z0-9_-]+"
              maxLength={100}
              disabled={!!editing}
              placeholder="prod-app-01"
            />
            <TextInput
              label="目标主机"
              value={host}
              onChange={(event) => setHost(event.currentTarget.value)}
              required
              placeholder="IP 或主机名"
            />
          </Group>
          <Group grow align="flex-start" gap="md">
            <NumberInput
              label="SSH 端口"
              min={1}
              max={65535}
              value={port}
              onChange={(value) => setPort(Number(value) || 22)}
              required
            />
            <TextInput
              label="远端用户名"
              value={username}
              onChange={(event) => setUsername(event.currentTarget.value)}
              required
              autoComplete="off"
              placeholder="deploy"
            />
          </Group>
          <Divider label="身份凭据" labelPosition="left" />
          {editing && (
            <Text size="xs" c="dimmed">
              保留当前凭据类型并将内容留空，即沿用已保存凭据。
            </Text>
          )}
          <Select
            label="凭据类型"
            data={Object.entries(credentials).map(([value, label]) => ({
              value,
              label,
            }))}
            value={type}
            onChange={(value) => {
              if (!value) return;
              setType(value);
              setSecret("");
              setPassphrase("");
            }}
          />
          {type === "private_key_inline" && (
            <Textarea
              label="PEM 私钥内容"
              className="mono"
              rows={5}
              value={secret}
              onChange={(event) => setSecret(event.currentTarget.value)}
              required={
                !editing || type !== editing.credential_type || !!passphrase
              }
              placeholder="粘贴 PEM 私钥"
              spellCheck={false}
            />
          )}
          {type === "password" && (
            <PasswordInput
              label="登录密码"
              value={secret}
              onChange={(event) => setSecret(event.currentTarget.value)}
              required={
                !editing || type !== editing.credential_type || !!passphrase
              }
              autoComplete="new-password"
              placeholder={editing ? "留空沿用原凭据" : "输入 SSH 密码"}
            />
          )}
          {type === "private_key_file" && (
            <TextInput
              label="网关上的私钥文件路径"
              value={secret}
              type="text"
              onChange={(event) => setSecret(event.currentTarget.value)}
              required={
                !editing || type !== editing.credential_type || !!passphrase
              }
              autoComplete="new-password"
              placeholder={
                editing ? "留空沿用原凭据" : "/data/keys/prod-app-01.pem"
              }
            />
          )}
          {type === "private_key_file" && (
            <FileButton
              onChange={(file) => void upload(file)}
              accept=".pem,.key"
              disabled={!!busy}
            >
              {(props) => (
                <Button
                  {...props}
                  variant="default"
                  leftSection={<Upload size={15} aria-hidden="true" />}
                >
                  {busy === "upload" ? "正在上传…" : "上传本地 PEM 私钥"}
                </Button>
              )}
            </FileButton>
          )}
          {type !== "password" && (
            <PasswordInput
              label="私钥口令（可选）"
              value={passphrase}
              onChange={(event) => setPassphrase(event.currentTarget.value)}
              autoComplete="new-password"
            />
          )}
          <TextInput
            label="known_hosts 文件路径（可选）"
            description={
              editing?.has_known_hosts
                ? "当前已启用主机指纹校验；留空保留现有设置。"
                : "配置网关上的指纹文件可启用主机身份校验。"
            }
            value={knownHosts}
            onChange={(event) => setKnownHosts(event.currentTarget.value)}
            placeholder="/data/keys/known_hosts"
          />
          <Divider label="备注与分组" labelPosition="left" />
          <TextInput
            label="描述"
            value={description}
            onChange={(event) => setDescription(event.currentTarget.value)}
            maxLength={500}
            placeholder="用途、维护事项"
          />
          <TextInput
            label="标签"
            description="多个标签用逗号分隔。"
            value={tags}
            onChange={(event) => setTags(event.currentTarget.value)}
            placeholder="生产, 应用服务"
          />
        </Stack>
      </form>
    </AppModal>
  );
}
