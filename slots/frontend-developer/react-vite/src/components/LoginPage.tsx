import { useState, type FormEvent } from "react";
import { useSession } from "../state/session";
import { ErrorBanner, toDisplayError, type DisplayError } from "./ErrorBanner";

export function LoginPage(): JSX.Element {
  const { login, loggingIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<DisplayError | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(toDisplayError(err));
    }
  }

  return (
    <main className="login">
      <div className="card login__card">
        <h1 className="login__title">TicketForge</h1>
        <p className="login__subtitle">Sign in to browse events and buy seats.</p>
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        <form className="login__form" onSubmit={onSubmit} noValidate>
          <label className="field">
            <span className="field__label">Email</span>
            <input
              className="field__input"
              data-testid="login-email"
              type="email"
              name="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="buyer01@ticketforge.test"
            />
          </label>
          <label className="field">
            <span className="field__label">Password</span>
            <input
              className="field__input"
              data-testid="login-password"
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password123"
            />
          </label>
          <button className="button button--primary" data-testid="login-submit" type="submit" disabled={loggingIn}>
            {loggingIn ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
