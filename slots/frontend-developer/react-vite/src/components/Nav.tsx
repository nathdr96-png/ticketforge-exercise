import { hrefFor, type Route } from "../lib/router";
import { useSession } from "../state/session";

export function Nav({ route }: { route: Route }): JSX.Element {
  const { user, logout, canSeeReports } = useSession();
  const active = route.name === "event" ? "events" : route.name;

  return (
    <header className="nav">
      <a className="nav__brand" href={hrefFor({ name: "events" })}>
        TicketForge
      </a>
      <nav className="nav__links">
        <a
          className={`nav__link${active === "events" ? " nav__link--active" : ""}`}
          data-testid="nav-events"
          href={hrefFor({ name: "events" })}
        >
          Events
        </a>
        <a
          className={`nav__link${active === "orders" ? " nav__link--active" : ""}`}
          data-testid="nav-orders"
          href={hrefFor({ name: "orders" })}
        >
          Orders
        </a>
        {/* Revenue reporting is organizer/admin only — a buyer never sees the link. */}
        {canSeeReports ? (
          <a
            className={`nav__link${active === "reports" ? " nav__link--active" : ""}`}
            data-testid="nav-reports"
            href={hrefFor({ name: "reports" })}
          >
            Revenue
          </a>
        ) : null}
      </nav>
      <div className="nav__user">
        <span className="nav__email" data-testid="current-user" data-role={user?.role}>
          {user?.email} · {user?.role}
        </span>
        <button className="button button--ghost" type="button" data-testid="logout" onClick={logout}>
          Sign out
        </button>
      </div>
    </header>
  );
}
