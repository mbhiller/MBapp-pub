import { type FormEvent, useEffect, useState } from "react";

type PartyInput = {
  name: string;
  kind?: string;
  roles?: string[];
};

type Props = {
  initialValue?: Partial<PartyInput>;
  submitLabel?: string;
  onSubmit: (value: PartyInput) => Promise<void> | void;
};

function toCommaSeparated(roles?: string[]) {
  return roles && roles.length ? roles.join(",") : "";
}

export function PartyForm({ initialValue, submitLabel = "Save", onSubmit }: Props) {
  const [name, setName] = useState(initialValue?.name ?? "");
  const [kind, setKind] = useState(initialValue?.kind ?? "");
  const [roles, setRoles] = useState(toCommaSeparated(initialValue?.roles));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(initialValue?.name ?? "");
    setKind(initialValue?.kind ?? "");
    setRoles(toCommaSeparated(initialValue?.roles));
  }, [initialValue?.name, initialValue?.kind, initialValue?.roles]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload: PartyInput = {
        name: name.trim(),
        kind: kind.trim() || undefined,
        roles: roles
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean),
      };
      if (!payload.name) {
        throw new Error("Name is required");
      }
      if (payload.roles && payload.roles.length === 0) delete payload.roles;
      await onSubmit(payload);
    } catch (err) {
      const message = (err as any)?.message ?? "Request failed";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12, maxWidth: 480 }}>
      <label style={{ display: "grid", gap: 4 }}>
        <span>Name *</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        <span>Kind</span>
        <input
          type="text"
          value={kind}
          placeholder="person | organization"
          onChange={(e) => setKind(e.target.value)}
        />
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        <span>Roles (comma-separated)</span>
        <input
          type="text"
          value={roles}
          placeholder="owner,trainer"
          onChange={(e) => setRoles(e.target.value)}
        />
      </label>

      {error ? <div style={{ color: "#b00020" }}>{error}</div> : null}

      <button type="submit" disabled={submitting}>
        {submitting ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}
