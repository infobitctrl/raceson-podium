import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { assertPublicEnvironmentOrigin } from "../../../apps/web/src/lib/public-env";
import HostedCopyApp from "../../../apps/web/src/features/rewards/HostedCopyApp";

assertPublicEnvironmentOrigin();
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}><BrowserRouter><HostedCopyApp /></BrowserRouter></QueryClientProvider>,
);
