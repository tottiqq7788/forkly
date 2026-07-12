import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, Outlet, RouterProvider } from "react-router-dom";
import App from "./App";
import HomePage from "./pages/HomePage";
import ProjectPage from "./pages/ProjectPage";
import SettingsPage from "./pages/SettingsPage";
import MarkdownEditorPage from "./pages/MarkdownEditorPage";
import LocalMarkdownEditorPage from "./pages/LocalMarkdownEditorPage";
import { MarkdownSaveGuardProvider } from "./components/files/markdown/MarkdownSaveGuard";
import "./index.css";

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});

const router = createBrowserRouter([
  {
    element: (
      <MarkdownSaveGuardProvider>
        <Outlet />
      </MarkdownSaveGuardProvider>
    ),
    children: [
      {
        path: "/",
        element: <App />,
        children: [
          { index: true, element: <HomePage /> },
          { path: "add", element: <HomePage /> },
          { path: "projects/:id", element: <ProjectPage /> },
          { path: "projects/:id/files", element: <ProjectPage /> },
          { path: "projects/:id/changes", element: <ProjectPage /> },
          { path: "projects/:id/history", element: <ProjectPage /> },
          { path: "settings", element: <SettingsPage /> },
        ],
      },
      {
        path: "/projects/:id/editor",
        element: <MarkdownEditorPage />,
      },
      {
        path: "/editor/local/:fileId",
        element: <LocalMarkdownEditorPage />,
      },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
