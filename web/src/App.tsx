import { api } from "./api";
import { usePolling, useRoute } from "./hooks";
import { Nav } from "./components/Nav";
import { Monitors } from "./views/Monitors";
import { Groups } from "./views/Groups";
import { Issues } from "./views/Issues";
import { Issue } from "./views/Issue";
import { Integrations } from "./views/Integrations";
import { Audit } from "./views/Audit";

export function App() {
  const route = useRoute();
  // Session first: an existing session identifies the user; only a 401 leads to the sign-in prompt.
  const me = usePolling(() => api.whoami(), 60000);
  const signedOut = me.error !== undefined && me.data === undefined;

  if (signedOut) {
    return (
      <div className="shell">
        <main>
          <section className="signin">
            <h1>Integration monitor</h1>
            <p className="muted">Sign in with your Microsoft account to see issues and approve actions.</p>
            <a className="button primary" href="/auth/login">
              Sign in with Microsoft
            </a>
          </section>
        </main>
      </div>
    );
  }

  let view;
  const issue = route.match(/^\/issues\/([^/]+)$/);
  if (issue) view = <Issue id={decodeURIComponent(issue[1])} />;
  else if (route.startsWith("/issues")) view = <Issues />;
  else if (route.startsWith("/groups")) view = <Groups />;
  else if (route.startsWith("/integrations")) view = <Integrations />;
  else if (route.startsWith("/audit")) view = <Audit />;
  else view = <Monitors />;

  return (
    <div className="shell">
      <Nav route={route} user={me.data?.user} />
      <main>{view}</main>
    </div>
  );
}
