import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Navigate, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { sessionInfo } from "@/api/auth";
import { Layout } from "@/components/Layout";
import ApiKeysPage from "@/pages/ApiKeysPage";
import BackupPage from "@/pages/BackupPage";
import BundleEnvLinksPage from "@/pages/BundleEnvLinksPage";
import BundleSealedSecretsPage from "@/pages/BundleSealedSecretsPage";
import BundleVariablesPage from "@/pages/BundleVariablesPage";
import BundlesPage from "@/pages/BundlesPage";
import CertificatesPage from "@/pages/CertificatesPage";
import EnvLinkHashPage from "@/pages/EnvLinkHashPage";
import { PublicDocsLayout } from "@/components/PublicDocsLayout";
import HelpPage from "@/pages/HelpPage";
import TutorialPage from "@/pages/TutorialPage";
import AccountPage from "@/pages/AccountPage";
import AppSettingsPage from "@/pages/AppSettingsPage";
import AuditTrailPage from "@/pages/AuditTrailPage";
import LoginPage from "@/pages/LoginPage";
import McpPage from "@/pages/McpPage";
import NewBundlePage from "@/pages/NewBundlePage";
import NewProjectPage from "@/pages/NewProjectPage";
import ProjectBundlesPage from "@/pages/ProjectBundlesPage";
import ProjectEnvironmentGatewayPage from "@/pages/ProjectEnvironmentGatewayPage";
import ProjectEnvironmentsPage from "@/pages/ProjectEnvironmentsPage";
import ProjectSettingsPage from "@/pages/ProjectSettingsPage";
import ProjectStacksPage from "@/pages/ProjectStacksPage";
import ProjectsPage from "@/pages/ProjectsPage";
import StackEditPage from "@/pages/StackEditPage";
import StackEnvLinksPage from "@/pages/StackEnvLinksPage";
import StackKeyGraphPage from "@/pages/StackKeyGraphPage";
import StackNewPage from "@/pages/StackNewPage";
import StacksPage from "@/pages/StacksPage";

function RequireAuth() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ["session"], queryFn: sessionInfo });

  useEffect(() => {
    if (!isLoading && !data?.admin) navigate("/login", { replace: true });
  }, [isLoading, data?.admin, navigate]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>
    );
  }
  if (!data?.admin) {
    return null;
  }
  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<PublicDocsLayout />}>
        <Route path="/help/*" element={<HelpPage />} />
        <Route path="/tutorial" element={<TutorialPage />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/projects/new" element={<NewProjectPage />} />
          <Route path="/projects/:projectSlug/settings" element={<ProjectSettingsPage />} />
          <Route path="/projects/:projectSlug/environments" element={<ProjectEnvironmentsPage />} />

          <Route path="/projects/:projectSlug/env/:environmentSlug/bundles" element={<ProjectBundlesPage />} />
          <Route path="/projects/:projectSlug/env/:environmentSlug/bundles/new" element={<NewBundlePage />} />
          <Route
            path="/projects/:projectSlug/env/:environmentSlug/bundles/:bundleName/edit"
            element={<BundleVariablesPage />}
          />
          <Route
            path="/projects/:projectSlug/env/:environmentSlug/bundles/:bundleName/env-links"
            element={<BundleEnvLinksPage />}
          />
          <Route
            path="/projects/:projectSlug/env/:environmentSlug/bundles/:bundleName/sealed-secrets"
            element={<BundleSealedSecretsPage />}
          />

          <Route path="/projects/:projectSlug/env/:environmentSlug/stacks" element={<ProjectStacksPage />} />
          <Route path="/projects/:projectSlug/env/:environmentSlug/stacks/new" element={<StackNewPage />} />
          <Route
            path="/projects/:projectSlug/env/:environmentSlug/stacks/:stackName/edit"
            element={<StackEditPage />}
          />
          <Route
            path="/projects/:projectSlug/env/:environmentSlug/stacks/:stackName/key-graph"
            element={<StackKeyGraphPage />}
          />
          <Route
            path="/projects/:projectSlug/env/:environmentSlug/stacks/:stackName/env-links"
            element={<StackEnvLinksPage />}
          />

          <Route path="/projects/:projectSlug" element={<ProjectEnvironmentGatewayPage />} />

          <Route path="/bundles" element={<BundlesPage />} />
          <Route path="/stacks" element={<StacksPage />} />
          <Route path="/keys" element={<ApiKeysPage />} />
          <Route path="/settings" element={<AppSettingsPage />} />
          <Route path="/mcp" element={<McpPage />} />
          <Route path="/audit" element={<AuditTrailPage />} />
          <Route path="/certificates" element={<CertificatesPage />} />
          <Route path="/backup" element={<BackupPage />} />
          <Route path="/tools/env-link-hash" element={<EnvLinkHashPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
