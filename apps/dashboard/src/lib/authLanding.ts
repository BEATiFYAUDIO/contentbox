export type AuthBootstrapStatus = {
  hasUsers: boolean;
  hasOwner: boolean;
  recoveryAvailable: boolean;
};

export function normalizeAuthBootstrapStatus(input: unknown): AuthBootstrapStatus {
  const raw = (input ?? {}) as Record<string, unknown>;
  const hasUsers = typeof raw.hasUsers === "boolean" ? raw.hasUsers : true;
  const hasOwner = typeof raw.hasOwner === "boolean" ? raw.hasOwner : hasUsers;
  const recoveryAvailable = typeof raw.recoveryAvailable === "boolean" ? raw.recoveryAvailable : false;
  return { hasUsers, hasOwner, recoveryAvailable };
}

export function shouldShowBootstrapCreate(status: AuthBootstrapStatus | null): boolean {
  return Boolean(status && status.hasUsers === false);
}
