import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchLocalFileContent, fetchSessionMe, type LocalFileContent } from "../api";
import { isMarkdownPath } from "../components/files/markdown/isMarkdown";
import { createLocalDocumentTransport } from "../components/files/markdown/documentTransport";
import { FullPageMessage, MarkdownEditorWorkspace } from "./MarkdownEditorWorkspace";
import { EditorErrorBoundary } from "./EditorErrorBoundary";

export default function LocalMarkdownEditorPage() {
  const { fileId = "" } = useParams();

  const me = useQuery({
    queryKey: ["me"],
    queryFn: fetchSessionMe,
    retry: 1,
  });

  const fileQuery = useQuery({
    queryKey: ["local-file-editor", fileId],
    queryFn: () => fetchLocalFileContent(fileId),
    enabled: me.isSuccess && !!fileId,
  });

  const file = fileQuery.data as LocalFileContent | undefined;
  const transport = useMemo(
    () => (fileId && file ? createLocalDocumentTransport({ fileId, file }) : null),
    // Remount identity is fileId + path; content/revision refreshes should not rebuild transport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fileId, file?.path, file?.name, file?.displayPath, file?.absPath, file?.parentName],
  );

  if (me.isError) {
    return (
      <FullPageMessage
        title="需要登录会话"
        body={me.error instanceof Error ? me.error.message : "无法建立本地会话"}
      />
    );
  }

  if (!fileId) {
    return <FullPageMessage title="缺少文件会话" body="请重新从本地 Markdown 文件打开编辑器。" />;
  }

  if (me.isLoading || fileQuery.isLoading) {
    return <FullPageMessage title="加载中…" body="正在打开本地文件编辑器" />;
  }

  if (fileQuery.isError) {
    return (
      <FullPageMessage
        title="无法打开本地文件"
        body={fileQuery.error instanceof Error ? fileQuery.error.message : String(fileQuery.error)}
      />
    );
  }

  if (!file || !transport) {
    return <FullPageMessage title="文件不存在" body={fileId} />;
  }

  if (!isMarkdownPath(file.path || file.name || file.displayPath)) {
    return <FullPageMessage title="仅支持 Markdown" body="独立编辑页只用于可编辑的 Markdown 文件。" />;
  }

  if (!file.editable || file.truncated) {
    return (
      <FullPageMessage
        title="文件不可编辑"
        body="仅未超限的本地 Markdown 文件可在独立编辑页打开。"
      />
    );
  }

  return (
    <EditorErrorBoundary
      resetKey={transport.remountKey}
      title="本地编辑器出错"
      fallbackBody="页面发生错误。可尝试重新加载；若仍失败请从文件管理器再次打开该 Markdown 文件。"
    >
      <MarkdownEditorWorkspace key={transport.remountKey} transport={transport} file={file} />
    </EditorErrorBoundary>
  );
}
