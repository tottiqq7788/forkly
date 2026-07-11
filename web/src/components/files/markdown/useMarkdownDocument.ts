import { useCallback, useEffect, useRef, useState } from "react";
import {
  APIError,
  BrowseSource,
  CONTENT_NOT_MODIFIED,
  ContentConflictDetails,
  FileContent,
  fetchFileContent,
  putFileContent,
} from "../../../api";

export type SaveStatus = "clean" | "dirty" | "saving" | "conflict" | "error";

export type MarkdownSerializer = {
  flush: () => void;
  getMarkdown: () => string;
};

const AUTOSAVE_MS = 1500;
const POLL_MS = 3000;

type Args = {
  projectID: string;
  source: BrowseSource;
  path: string;
  initial: FileContent;
  enabled: boolean;
};

export function useMarkdownDocument({ projectID, source, path, initial, enabled }: Args) {
  const [draftMarkdown, setDraftMarkdown] = useState(initial.content ?? "");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("clean");
  const [conflictDiskContent, setConflictDiskContent] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const baseRevisionRef = useRef(initial.revision ?? "");
  const etagRef = useRef(initial.revision ? `"${initial.revision}"` : "");
  const editVersionRef = useRef(0);
  const savedVersionRef = useRef(0);
  const draftRef = useRef(initial.content ?? "");
  const statusRef = useRef<SaveStatus>("clean");
  const serializerRef = useRef<MarkdownSerializer | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInFlightRef = useRef(false);
  const pendingResaveRef = useRef(false);
  const cancelledRef = useRef(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const setStatus = useCallback((next: SaveStatus) => {
    statusRef.current = next;
    setSaveStatus(next);
  }, []);

  const serializeDraft = useCallback((): string => {
    const ser = serializerRef.current;
    if (ser) {
      ser.flush();
      const md = ser.getMarkdown();
      draftRef.current = md;
      setDraftMarkdown(md);
      return md;
    }
    return draftRef.current;
  }, []);

  const runSaveRef = useRef<() => Promise<boolean>>(async () => true);

  runSaveRef.current = async (): Promise<boolean> => {
    if (!enabledRef.current) return true;
    if (statusRef.current === "conflict") return false;
    if (saveInFlightRef.current) {
      pendingResaveRef.current = true;
      return false;
    }

    const version = editVersionRef.current;
    if (version === savedVersionRef.current && statusRef.current === "clean") {
      return true;
    }

    const content = serializeDraft();
    const revision = baseRevisionRef.current;
    if (!revision) {
      setLastError("缺少文件版本信息，无法保存");
      setStatus("error");
      return false;
    }

    saveInFlightRef.current = true;
    setStatus("saving");
    setLastError(null);

    try {
      const result = await putFileContent(projectID, { path, content, revision });
      if (cancelledRef.current) return false;

      baseRevisionRef.current = result.revision;
      etagRef.current = `"${result.revision}"`;
      savedVersionRef.current = version;

      if (editVersionRef.current !== version || pendingResaveRef.current) {
        pendingResaveRef.current = false;
        setStatus("dirty");
        scheduleSaveRef.current();
      } else {
        setStatus("clean");
      }
      return editVersionRef.current === version;
    } catch (err) {
      if (cancelledRef.current) return false;
      if (err instanceof APIError && err.status === 409 && err.code === "content_conflict") {
        setStatus("conflict");
        setLastError("文件已在外部被修改");
        const details = err.details as ContentConflictDetails | undefined;
        try {
          const disk = await fetchFileContent(projectID, source, path);
          if (disk !== CONTENT_NOT_MODIFIED) {
            setConflictDiskContent(disk.content ?? "");
            if (disk.revision) {
              baseRevisionRef.current = disk.revision;
              etagRef.current = `"${disk.revision}"`;
            }
          }
        } catch {
          setConflictDiskContent(null);
          if (details?.currentRevision) {
            baseRevisionRef.current = details.currentRevision;
            etagRef.current = `"${details.currentRevision}"`;
          }
        }
        return false;
      }
      const message = err instanceof Error ? err.message : String(err);
      setLastError(message);
      setStatus("error");
      return false;
    } finally {
      saveInFlightRef.current = false;
      if (pendingResaveRef.current && statusRef.current === "dirty") {
        pendingResaveRef.current = false;
        scheduleSaveRef.current();
      }
    }
  };

  const scheduleSaveRef = useRef<() => void>(() => undefined);
  scheduleSaveRef.current = () => {
    if (!enabledRef.current) return;
    if (statusRef.current === "conflict") return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void runSaveRef.current();
    }, AUTOSAVE_MS);
  };

  // Reset when switching files / initial payload identity.
  useEffect(() => {
    cancelledRef.current = false;
    const content = initial.content ?? "";
    draftRef.current = content;
    setDraftMarkdown(content);
    baseRevisionRef.current = initial.revision ?? "";
    etagRef.current = initial.revision ? `"${initial.revision}"` : "";
    editVersionRef.current = 0;
    savedVersionRef.current = 0;
    saveInFlightRef.current = false;
    pendingResaveRef.current = false;
    setConflictDiskContent(null);
    setLastError(null);
    setStatus("clean");
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    return () => {
      cancelledRef.current = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [projectID, source, path, initial.revision, initial.content, setStatus]);

  const setDraftFromEditor = useCallback(() => {
    if (!enabledRef.current) return;
    if (statusRef.current === "conflict") return;
    editVersionRef.current += 1;
    setStatus("dirty");
    scheduleSaveRef.current();
  }, [setStatus]);

  const registerSerializer = useCallback((ser: MarkdownSerializer | null) => {
    serializerRef.current = ser;
  }, []);

  const flush = useCallback(async (): Promise<boolean> => {
    if (!enabledRef.current) return true;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (statusRef.current === "clean" && editVersionRef.current === savedVersionRef.current) {
      return true;
    }
    if (statusRef.current === "conflict") return false;
    while (saveInFlightRef.current) {
      await new Promise((r) => setTimeout(r, 50));
      if (cancelledRef.current) return false;
    }
    if (statusRef.current === "clean" && editVersionRef.current === savedVersionRef.current) {
      return true;
    }
    return runSaveRef.current();
  }, []);

  const retry = useCallback(async () => {
    if (statusRef.current === "conflict") return false;
    setStatus("dirty");
    return flush();
  }, [flush, setStatus]);

  const discardDraft = useCallback(async () => {
    try {
      const disk = await fetchFileContent(projectID, source, path);
      if (disk === CONTENT_NOT_MODIFIED) return;
      const content = disk.content ?? "";
      draftRef.current = content;
      setDraftMarkdown(content);
      if (disk.revision) {
        baseRevisionRef.current = disk.revision;
        etagRef.current = `"${disk.revision}"`;
      }
      editVersionRef.current = 0;
      savedVersionRef.current = 0;
      setConflictDiskContent(null);
      setLastError(null);
      setStatus("clean");
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, [path, projectID, setStatus, source]);

  const overwriteWithDraft = useCallback(async (): Promise<boolean> => {
    setStatus("dirty");
    editVersionRef.current += 1;
    setConflictDiskContent(null);
    return flush();
  }, [flush, setStatus]);

  useEffect(() => {
    if (!enabled) return;

    const poll = async () => {
      if (cancelledRef.current) return;
      if (statusRef.current !== "clean") return;
      if (!etagRef.current) return;
      try {
        const result = await fetchFileContent(projectID, source, path, {
          etag: etagRef.current,
        });
        if (cancelledRef.current || statusRef.current !== "clean") return;
        if (result === CONTENT_NOT_MODIFIED) return;
        if (result.revision && result.revision !== baseRevisionRef.current) {
          const content = result.content ?? "";
          draftRef.current = content;
          setDraftMarkdown(content);
          baseRevisionRef.current = result.revision;
          etagRef.current = `"${result.revision}"`;
          editVersionRef.current = 0;
          savedVersionRef.current = 0;
        }
      } catch {
        // Ignore poll errors.
      }
    };

    const id = setInterval(() => void poll(), POLL_MS);
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, path, projectID, source]);

  return {
    draftMarkdown,
    saveStatus,
    lastError,
    conflictDiskContent,
    flush,
    retry,
    discardDraft,
    overwriteWithDraft,
    setDraftFromEditor,
    registerSerializer,
  };
}
