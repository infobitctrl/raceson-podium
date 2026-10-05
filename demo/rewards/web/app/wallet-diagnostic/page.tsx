import { notFound } from "next/navigation";
import WalletDiagnostic from "../../wallet/WalletDiagnostic";

export default function WalletDiagnosticPage() {
  if (process.env.NODE_ENV !== "development" || process.env.RACESON_REWARD_PORTAL_MODE !== "local-testnet") notFound();
  return <WalletDiagnostic />;
}
