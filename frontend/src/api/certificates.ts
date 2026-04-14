import { apiFetch, getCsrfHeader } from "./client";
import { fetchCsrf } from "./auth";

export type CertificateRow = {
  id: number;
  name: string;
  fingerprint_sha256: string;
  created_at: string;
};

export async function listCertificates(): Promise<CertificateRow[]> {
  return apiFetch<CertificateRow[]>("/certificates", { method: "GET" });
}

export async function createCertificate(body: {
  name: string;
  certificate_pem: string;
}): Promise<CertificateRow> {
  const csrf = await fetchCsrf();
  return apiFetch("/certificates", {
    method: "POST",
    headers: getCsrfHeader(csrf),
    json: body,
  });
}

export async function deleteCertificate(certificateId: number): Promise<void> {
  const csrf = await fetchCsrf();
  await apiFetch(`/certificates/${encodeURIComponent(String(certificateId))}`, {
    method: "DELETE",
    headers: getCsrfHeader(csrf),
  });
}
