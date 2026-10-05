// Display follows recorded participation and race completion, never wall-clock expiry.
export function statusFromRegistration(input: {
  registrationStatus: string;
  paymentStatus: string;
  participationStatus: string;
  resultStatus: string;
  eventStatus: string | null | undefined;
  confirmedAt?: string | null;
  hasBib?: boolean;
}) {
  const isOperationallyConfirmed =
    Boolean(input.hasBib) ||
    Boolean(input.confirmedAt) ||
    ["checked_in", "started", "finished", "dnf", "dsq"].includes(input.participationStatus);

  if (input.participationStatus === "dns") return "dns";
  if (
    input.participationStatus === "finished" ||
    input.participationStatus === "dnf" ||
    input.participationStatus === "dsq" ||
    input.resultStatus === "official" ||
    input.resultStatus === "corrected" ||
    input.resultStatus === "void"
  ) {
    return "completed";
  }
  if (["completed", "archived"].includes(input.eventStatus ?? "") && ["pending", "confirmed"].includes(input.registrationStatus)) {
    return "dns";
  }
  if (input.registrationStatus === "waitlisted") return "waitlisted";
  if (input.registrationStatus === "offered") return "offered";
  if (input.registrationStatus === "cancelled") return "cancelled";
  if (input.registrationStatus === "expired") return "expired";
  if (input.paymentStatus === "unpaid" || !isOperationallyConfirmed) {
    return "pending";
  }
  return "confirmed";
}
