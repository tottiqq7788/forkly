import { useRouteError, isRouteErrorResponse } from "react-router-dom";

/** Top-level router error UI — never leave users on a blank white page. */
export default function RouteErrorPage() {
  const err = useRouteError();
  let title = "页面出错了";
  let body = "发生未知错误。";

  if (isRouteErrorResponse(err)) {
    title = `${err.status} ${err.statusText || "错误"}`.trim();
    body = typeof err.data === "string" && err.data ? err.data : body;
  } else if (err instanceof Error) {
    body = err.message || body;
  } else if (typeof err === "string") {
    body = err;
  }

  return (
    <div className="flex h-full items-center justify-center p-8 bg-[var(--color-canvas)] text-[var(--color-text)]">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold mb-2">{title}</h1>
        <p className="text-[var(--color-text-secondary)] mb-4 break-words">{body}</p>
        <button
          type="button"
          className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-canvas)] px-3 py-1.5 text-sm font-medium"
          onClick={() => window.location.assign("/")}
        >
          返回首页
        </button>
        <button
          type="button"
          className="ml-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm"
          onClick={() => window.location.reload()}
        >
          重新加载
        </button>
      </div>
    </div>
  );
}
