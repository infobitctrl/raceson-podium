/** Minimal account projection consumed by private operator services. Callers
 * must authenticate it; the type is not proof of identity or authority. This
 * avoids loading a full web session (and activating membership invitations)
 * merely to dispatch stored jobs. The runner separately requires the actual
 * authenticated session UUID and SQL rechecks current programme authority. */
export type RewardOperatorAccount = { account: { userId: string } };
