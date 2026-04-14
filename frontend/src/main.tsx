import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient();

/** When built for production under FastAPI `/app`, set `VITE_ADMIN_BASENAME=/app` at build time (see Dockerfile). */
const routerBasename = (import.meta.env.VITE_ADMIN_BASENAME as string | undefined)?.replace(/\/$/, "") ?? "";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={routerBasename}>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
