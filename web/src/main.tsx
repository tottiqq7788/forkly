import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, Outlet, RouterProvider } from "react-router-dom";
import App from "./App";
import HomePage from "./pages/HomePage";
import AddProjectPage from "./pages/AddProjectPage";
import ProjectPage from "./pages/ProjectPage";
import SettingsPage from "./pages/SettingsPage";
import MarkdownEditorPage from "./pages/MarkdownEditorPage";
import LocalMarkdownEditorPage from "./pages/LocalMarkdownEditorPage";
import RouteErrorPage from "./pages/RouteErrorPage";
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
    errorElement: <RouteErrorPage />,
    children: [
      {
        path: "/",
        element: <App />,
        errorElement: <RouteErrorPage />,
        children: [
          { index: true, element: <HomePage /> },
          { path: "add", element: <AddProjectPage variant="page" /> },
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
        errorElement: <RouteErrorPage />,
      },
      {
        path: "/editor/local/:fileId",
        element: <LocalMarkdownEditorPage />,
        errorElement: <RouteErrorPage />,
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
