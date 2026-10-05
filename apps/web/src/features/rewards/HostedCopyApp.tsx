import { useState, type FormEvent } from "react";
import { AuthProvider, useAuth } from "@/lib/auth";
import HostedSponsorDrafts from "./screens/HostedSponsorDrafts";
import HostedCopyPreview from "./screens/HostedCopyPreview";
import "./HostedCopyApp.css";

/** The hosted preview exposes only the operations enabled by the matching API gate. */
export default function HostedCopyRoot() {
  // AuthProvider remounts its children when an account changes. Keep the action
  // lock outside that boundary so the new login form waits for session revocation.
  const [busy, setBusy] = useState(false);
  return <AuthProvider><HostedCopyApp busy={busy} setBusy={setBusy} /></AuthProvider>;
}

function HostedCopyApp({ busy, setBusy }: { busy: boolean; setBusy: (busy: boolean) => void }) {
  const auth = useAuth();
  const [view, setView] = useState<"results" | "campaigns">("results");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await auth.signIn({ identifier: identifier.trim(), password });
      setPassword("");
    } catch {
      setPassword("");
      setError("Sign-in failed. Check your demo username and password, or try again later.");
    } finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true);
    setError("");
    try { await auth.signOut(); }
    catch { setError("Sign-out could not finish. Close this browser before using another account."); }
    finally { setPassword(""); setBusy(false); }
  }

  return <div className="hosted-copy">
    <header className="hosted-header">
      <a className="hosted-brand" href="/">RacesOn <strong>Podium</strong></a>
      <span className="hosted-badge">Committee preview</span>
      {auth.user && <div className="hosted-account">
        <span>{auth.account?.displayName ?? "Demo account"}<small>{auth.account?.loginUsername}</small></span>
        <button type="button" disabled={busy} onClick={signOut}>Sign out</button>
      </div>}
    </header>
    <main>
      {auth.isLoading ? <p className="hosted-loading" role="status">Loading your account…</p>
        : auth.user ? <>{auth.account?.defaultRole === "sponsor" && <nav className="hosted-view-tabs" aria-label="Workspace"><button aria-pressed={view === "results"} onClick={() => setView("results")}>Results</button><button aria-pressed={view === "campaigns"} onClick={() => setView("campaigns")}>Campaigns</button></nav>}{view === "campaigns" && auth.account?.defaultRole === "sponsor" ? <HostedSponsorDrafts /> : <HostedCopyPreview />}{error && <p className="hosted-error" role="alert">{error}</p>}</>
        : <section className="hosted-login" aria-labelledby="login-title">
          <div className="hosted-intro">
            <p className="hosted-kicker">Šibenik Trail League · five completed rounds</p>
            <h1 id="login-title">Sporting results.<br />Ready for review.</h1>
            <p>Explore the league's published times and standings with fictional athlete and club names.</p>
            <p className="hosted-note">This isolated demo uses test accounts. Reward distributions and claims are not enabled yet.</p>
          </div>
          <form className="hosted-login-card" onSubmit={signIn}>
            <h2>Sign in to the demo</h2>
            <p>Use the committee credentials provided by the project team.</p>
            <label htmlFor="demo-username">Username</label>
            <input id="demo-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={identifier} disabled={busy} onChange={e => setIdentifier(e.target.value)} />
            <label htmlFor="demo-password">Password</label>
            <input id="demo-password" name="password" type="password" autoComplete="current-password" required value={password} disabled={busy} onChange={e => setPassword(e.target.value)} />
            {error && <p className="hosted-error" role="alert">{error}</p>}
            <button className="hosted-submit" type="submit" disabled={busy || !auth.hasSupabase}>{busy ? "Please wait…" : "Sign in"}</button>
          </form>
        </section>}
    </main>
    <footer className="hosted-footer">RacesOn Podium · Monad testnet demo · Fictional profiles, exact public results</footer>
  </div>;
}
