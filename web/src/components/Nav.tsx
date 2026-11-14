const ITEMS = [
  { path: "/monitors", label: "Monitors" },
  { path: "/groups", label: "Groups" },
  { path: "/issues", label: "Issues" },
  { path: "/integrations", label: "Integrations" },
  { path: "/audit", label: "Audit log" },
];

export function Nav({ route, user }: { route: string; user?: string }) {
  const active = (path: string) => (route === path || route.startsWith(`${path}/`) ? "active" : "");
  return (
    <aside className="nav">
      <div className="brand">Integration monitor</div>
      <nav>
        {ITEMS.map((item) => (
          <a key={item.path} href={`#${item.path}`} className={active(item.path)}>
            {item.label}
          </a>
        ))}
      </nav>
      <div className="who">
        {user ? (
          <>
            <span>Signed in as {user}</span>
            <form method="post" action="/auth/logout">
              <button type="submit" className="ghost">
                Sign out
              </button>
            </form>
          </>
        ) : (
          "Not signed in"
        )}
      </div>
    </aside>
  );
}
