import DemoWalletEntry from "../../wallet/DemoWalletEntry";

// Only the neutral demo shell is rendered on the server. Private allocations
// are fetched through the isolated authenticated API after browser sign-in.
export default function DemoPage() {
  return <DemoWalletEntry />;
}
