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
import HelpPage from "@/pages/HelpPage";
import LoginPage from "@/pages/LoginPage";
import NewBundlePage from "@/pages/NewBundlePage";
import NewProjectPage from "@/pages/NewProjectPage";
import ProjectBundlesPage from "@/pages/ProjectBundlesPage";
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
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/new" element={<NewProjectPage />} />
          <Route path="/projects/:projectSlug/settings" element={<ProjectSettingsPage />} />
          <Route path="/projects/:projectSlug/bundles" element={<ProjectBundlesPage />} />
          <Route path="/projects/:projectSlug/bundles/new" element={<NewBundlePage />} />
          <Route
            path="/projects/:projectSlug/bundles/:bundleName/edit"
            element={<BundleVariablesPage />}
          />
          <Route
            path="/projects/:projectSlug/bundles/:bundleName/env-links"
            element={<BundleEnvLinksPage />}
          />
          <Route
            path="/projects/:projectSlug/bundles/:bundleName/sealed-secrets"
            element={<BundleSealedSecretsPage />}
          />
          <Route path="/projects/:projectSlug/stacks" element={<ProjectStacksPage />} />
          <Route path="/projects/:projectSlug/stacks/new" element={<StackNewPage />} />
          <Route
            path="/projects/:projectSlug/stacks/:stackName/edit"
            element={<StackEditPage />}
          />
          <Route
            path="/projects/:projectSlug/stacks/:stackName/key-graph"
            element={<StackKeyGraphPage />}
          />
          <Route
            path="/projects/:projectSlug/stacks/:stackName/env-links"
            element={<StackEnvLinksPage />}
          />
          <Route path="/bundles" element={<BundlesPage />} />
          <Route path="/bundles/:bundleName/edit" element={<BundleVariablesPage />} />
          <Route path="/bundles/:bundleName/env-links" element={<BundleEnvLinksPage />} />
          <Route
            path="/bundles/:bundleName/sealed-secrets"
            element={<BundleSealedSecretsPage />}
          />
          <Route path="/stacks" element={<StacksPage />} />
          <Route path="/stacks/:stackName/edit" element={<StackEditPage />} />
          <Route path="/stacks/:stackName/key-graph" element={<StackKeyGraphPage />} />
          <Route path="/stacks/:stackName/env-links" element={<StackEnvLinksPage />} />
          <Route path="/keys" element={<ApiKeysPage />} />
          <Route path="/certificates" element={<CertificatesPage />} />
          <Route path="/backup" element={<BackupPage />} />
          <Route path="/help" element={<HelpPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
