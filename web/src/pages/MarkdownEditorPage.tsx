import { useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, fetchFileContent, fetchSessionMe, type FileContent, type Project } from "../api";
import { createProjectDocumentTransport } from "../components/files/markdown/documentTransport";
import { FullPageMessage, MarkdownEditorWorkspace } from "./MarkdownEditorWorkspace";
import { EditorErrorBoundary } from "./EditorErrorBoundary";

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

  const file = fileQuery.data as FileContent | undefined;
  const projectName = (project.data as Project | undefined)?.name || id;
  const transport = useMemo(() => {
    if (!id || !file?.path) return null;
    return createProjectDocumentTransport({
      projectID: id,
      projectName,
      path: file.path,
    });
  }, [id, projectName, file?.path]);

  if (me.isError) {
    return (
      <FullPageMessage
        title="需要登录会话"
        body={me.error instanceof Error ? me.error.message : "无法建立本地会话"}
      />
    );
  }

  if (!path) {
    return <FullPageMessage title="缺少文件路径" body="请从项目文件树通过编辑按钮打开文件。" />;
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

  if (!file || !transport) {
    return <FullPageMessage title="文件不存在" body={path} />;
  }

  if (file.kind === "binary" || file.kind === "image") {
    return <FullPageMessage title="暂不支持编辑" body="二进制文件暂不支持编辑。" />;
  }

  if (file.kind === "too_large" || file.truncated) {
    return <FullPageMessage title="暂不支持编辑" body="文件过大暂不支持编辑。" />;
  }

  if (file.kind !== "text") {
    return <FullPageMessage title="暂不支持编辑" body="该文件暂不支持编辑。" />;
  }

  const editable = !!file.editable && file.source === "worktree" && !file.truncated;
  if (!editable) {
    return (
      <FullPageMessage
        title="文件不可编辑"
        body="仅工作区中未超限的文本文件可在独立编辑页打开。"
      />
    );
  }

  return (
    <EditorErrorBoundary
      resetKey={transport.remountKey}
      title="项目编辑器出错"
      fallbackBody="页面发生错误。可尝试重新加载，或从项目文件树再次打开该文件。"
    >
      <MarkdownEditorWorkspace key={transport.remountKey} transport={transport} file={file} />
    </EditorErrorBoundary>
  );
}
