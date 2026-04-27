import { apiFetch, getCsrfHeader } from "./client";
import { fetchCsrf } from "./auth";

export async function approveCliDevice(body: {
  user_code: string;
  name: string;
  scopes: string[];
  expires_at?: string;
}): Promise<void> {
  const csrf = await fetchCsrf();
  await apiFetch("/auth/device/approve", {
    method: "POST",
    headers: getCsrfHeader(csrf),
    json: body,
  });
}
