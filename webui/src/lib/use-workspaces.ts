import type { WorkspaceEntry } from "../console-types";
import { useResource } from "./use-resource";

export function useWorkspaces() {
  return useResource<{ workspaces: WorkspaceEntry[] }>("/api/workspaces", {
    workspaces: [],
  });
}
