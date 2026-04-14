import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { login } from "@/api/auth";
import { Button } from "@/components/ui";

export default function LoginPage() {
  const navigate = useNavigate();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: async () => {
      setError(null);
      await login(key.trim());
    },
    onSuccess: () => navigate("/projects", { replace: true }),
    onError: (e: unknown) => {
      if (e instanceof ApiError) {
        const d = e.detail;
        setError(typeof d === "string" ? d : JSON.stringify(d));
      } else {
        setError(e instanceof Error ? e.message : "Sign-in failed");
      }
    },
  });

  return (
    <div className="mx-auto max-w-md pt-16">
      <h1 className="mb-2 text-2xl font-semibold text-white">Sign in</h1>
      <p className="mb-6 text-sm text-slate-400">
        Enter an admin API key. The session is stored in a signed browser cookie.
      </p>
      <form
        className="space-y-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          m.mutate();
        }}
      >
        <div>
          <label htmlFor="apikey" className="mb-1 block text-sm text-slate-400">
            API key
          </label>
          <input
            id="apikey"
            type="password"
            autoComplete="off"
            className="w-full rounded-lg border border-border bg-[#0b0f14] px-3 py-2 font-mono text-sm text-slate-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </div>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <Button type="submit" disabled={m.isPending || !key.trim()}>
          {m.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
