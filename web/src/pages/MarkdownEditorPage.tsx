import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, fetchFileContent, fetchSessionMe, type FileContent, type Project } from "../api";
import { isMarkdownPath } from "../components/files/markdown/isMarkdown";
import { createProjectDocumentTransport } from "../components/files/markdown/documentTransport";
import { FullPageMessage, MarkdownEditorWorkspace } from "./MarkdownEditorWorkspace";

export default function MarkdownEditorPage() {
  const { id = "" } = useParams();
  const [search] = useSearchParams();
  const path = search.get("path")?.trim() || "";

  const me = useQuery({
    queryKey: ["me"],
    queryFn: fetchSessionMe,
    retry: 1,
  });

  const project = useQuery({
    queryKey: ["project", id],
    queryFn: () => api<Project>(`/local-api/v1/projects/${id}`),
    enabled: me.isSuccess && !!id,
  });

  const fileQuery = useQuery({
    queryKey: ["file-editor", id, path],
    queryFn: () => fetchFileContent(id, "worktree", path),
    enabled: me.isSuccess && !!id && !!path,
  });

  if (me.isError) {
    return (
      <FullPageMessage
        title="需要登录会话"
        body={me.error instanceof Error ? me.error.message : "无法建立本地会话"}
      />
    );
  }

  if (!path) {
    return <FullPageMessage title="缺少文件路径" body="请从项目文件树通过编辑按钮打开 Markdown。" />;
  }

  if (!isMarkdownPath(path)) {
    return <FullPageMessage title="仅支持 Markdown" body="独立编辑页只用于可编辑的 Markdown 文件。" />;
  }

  if (me.isLoading || fileQuery.isLoading || project.isLoading) {
    return <FullPageMessage title="加载中…" body="正在打开编辑器" />;
  }

  if (fileQuery.isError) {
    return (
      <FullPageMessage
        title="无法打开文件"
        body={fileQuery.error instanceof Error ? fileQuery.error.message : String(fileQuery.error)}
      />
    );
  }

  const file = fileQuery.data as FileContent | undefined;
  if (!file) {
    return <FullPageMessage title="文件不存在" body={path} />;
  }

  const editable = !!file.editable && file.source === "worktree" && !file.truncated;
  if (!editable) {
    return (
      <FullPageMessage
        title="文件不可编辑"
        body="仅工作区中未超限的 Markdown 文件可在独立编辑页打开。"
      />
    );
  }

  const transport = createProjectDocumentTransport({
    projectID: id,
    projectName: (project.data as Project | undefined)?.name || id,
    path: file.path,
  });

  return (
    <MarkdownEditorWorkspace
      key={transport.remountKey}
      transport={transport}
      file={file}
    />
  );
}
