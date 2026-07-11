import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, BrowseSource, FileContent } from "../../../api";
import { resolveMarkdownImage } from "./markdownPath";

type Props = {
  src?: string;
  alt?: string;
  title?: string;
  projectID: string;
  source: BrowseSource;
  ownerPath: string;
};

const SAFE_MIME = /^(image\/(?:png|jpe?g|gif|webp))(;|$)/i;

export function MarkdownImage({ src = "", alt = "", title, projectID, source, ownerPath }: Props) {
  const resolved = resolveMarkdownImage(ownerPath, src);

  if (resolved.kind === "blocked") {
    return (
      <span className="forkly-md-img-blocked" title={resolved.reason}>
        [{alt || "图片不可用"}]
      </span>
    );
  }

  if (resolved.kind === "remote" || resolved.kind === "data") {
    return <RemoteOrDataImage href={resolved.href} alt={alt} title={title} kind={resolved.kind} />;
  }

  return (
    <RepoImage path={resolved.path} alt={alt} title={title} projectID={projectID} source={source} />
  );
}

function RemoteOrDataImage({
  href,
  alt,
  title,
  kind,
}: {
  href: string;
  alt: string;
  title?: string;
  kind: "remote" | "data";
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="forkly-md-img-blocked" title={href}>
        [{alt || (kind === "remote" ? "远程图片加载失败" : "图片不可用")}]
      </span>
    );
  }
  return (
    <img
      src={href}
      alt={alt}
      title={title}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className="forkly-md-img"
      onError={() => setFailed(true)}
    />
  );
}

function RepoImage({
  path,
  alt,
  title,
  projectID,
  source,
}: {
  path: string;
  alt: string;
  title?: string;
  projectID: string;
  source: BrowseSource;
}) {
  const query = useQuery({
    queryKey: ["file-preview", projectID, source, path],
    queryFn: () =>
      api<FileContent>(
        `/local-api/v1/projects/${projectID}/content?source=${source}&path=${encodeURIComponent(path)}`,
      ),
  });

  if (query.isLoading) {
    return <span className="forkly-md-img-loading">加载图片…</span>;
  }
  if (query.isError || !query.data) {
    return (
      <span className="forkly-md-img-blocked" title={path}>
        [{alt || "图片加载失败"}]
      </span>
    );
  }
  const file = query.data;
  if (file.kind !== "image" || !file.dataUrl || (file.mime && !SAFE_MIME.test(file.mime))) {
    return (
      <span className="forkly-md-img-blocked" title={file.message || path}>
        [{alt || file.message || "无法预览图片"}]
      </span>
    );
  }
  return (
    <img
      src={file.dataUrl}
      alt={alt}
      title={title}
      loading="lazy"
      decoding="async"
      className="forkly-md-img"
    />
  );
}
