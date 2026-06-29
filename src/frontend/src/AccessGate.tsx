import { LoaderCircle, LogOut, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

type AppRole = 'Admin' | 'Approver' | 'Analyst';

type AuthSessionStatus = 'authorized' | 'pending' | 'database-unavailable' | 'unauthenticated';

type AuthSessionResponse = {
  status: AuthSessionStatus;
  roles?: AppRole[];
  user?: {
    appUserId?: string;
    email?: string;
    name?: string;
    providerId?: string;
  };
  message?: string;
  error?: string;
};

type GatePhase = 'checking' | 'authorized' | 'pending' | 'database-unavailable' | 'unauthenticated';

const pollIntervalMs = 2500;

function isProductionHost() {
  return window.location.hostname.includes('azurestaticapps.net');
}

async function fetchAuthSession(): Promise<{ response: Response; body: AuthSessionResponse | null }> {
  const response = await fetch('/api/auth/session', {
    headers: {
      Accept: 'application/json',
    },
  });

  const body = (await response.json().catch(() => null)) as AuthSessionResponse | null;
  return { response, body };
}

async function fetchIdentityEmail() {
  const response = await fetch('/.auth/me');
  if (!response.ok) {
    return undefined;
  }

  const payload = (await response.json()) as {
    clientPrincipal?: {
      userDetails?: string;
    };
  };

  return payload.clientPrincipal?.userDetails;
}

function redirectToLogin() {
  const redirectUri = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.assign(`/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(redirectUri || '/')}`);
}

type AccessGateProps = {
  children: ReactNode;
};

export default function AccessGate({ children }: AccessGateProps) {
  const [phase, setPhase] = useState<GatePhase>('checking');
  const [session, setSession] = useState<AuthSessionResponse | null>(null);
  const [identityEmail, setIdentityEmail] = useState<string | undefined>();
  const pollTimerRef = useRef<number | undefined>(undefined);

  const evaluateSession = useCallback(async () => {
    const { response, body } = await fetchAuthSession();

    if (response.status === 401) {
      setSession(body);
      setPhase('unauthenticated');
      if (isProductionHost()) {
        redirectToLogin();
      }
      return false;
    }

    if (!body) {
      setPhase('database-unavailable');
      setSession({
        status: 'database-unavailable',
        error: 'Unable to read the application access response.',
      });
      return false;
    }

    setSession(body);

    if (response.status === 503 || body.status === 'database-unavailable') {
      setPhase('database-unavailable');
      return false;
    }

    if (body.status === 'authorized' && (body.roles?.length ?? 0) > 0) {
      setPhase('authorized');
      return true;
    }

    setPhase('pending');
    return false;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const email = await fetchIdentityEmail().catch(() => undefined);
      if (!cancelled && email) {
        setIdentityEmail(email);
      }

      const authorized = await evaluateSession();
      if (cancelled || authorized) {
        return;
      }

      pollTimerRef.current = window.setInterval(() => {
        void evaluateSession();
      }, pollIntervalMs);
    };

    void bootstrap();

    return () => {
      cancelled = true;
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
      }
    };
  }, [evaluateSession]);

  if (phase === 'authorized') {
    return <>{children}</>;
  }

  const displayEmail = session?.user?.email ?? identityEmail;
  const displayName = session?.user?.name ?? displayEmail ?? 'Signed-in user';

  return (
    <div className="access-gate">
      <div className="access-gate-card">
        <div className="access-gate-brand">
          <span className="access-gate-mark">MH</span>
          <div>
            <p className="access-gate-kicker">MSP Harmony</p>
            <h1>Confirming your access</h1>
          </div>
        </div>

        <div className={`access-gate-status access-gate-status-${phase}`}>
          {phase === 'checking' ? <LoaderCircle className="access-gate-spinner" size={28} /> : <ShieldCheck size={28} />}
          <div>
            <strong>
              {phase === 'checking'
                ? 'Checking Microsoft sign-in'
                : phase === 'pending'
                  ? 'Waiting for application role'
                  : phase === 'database-unavailable'
                    ? 'Access verification unavailable'
                    : 'Sign-in required'}
            </strong>
            <p>
              {phase === 'checking'
                ? 'Verifying your identity and PostgreSQL application role before opening the workspace.'
                : phase === 'pending'
                  ? (session?.message ??
                    'Your Microsoft account is authenticated. An administrator must assign an active MSP Harmony role before you can continue.')
                  : phase === 'database-unavailable'
                    ? (session?.error ??
                      'The application could not reach PostgreSQL to confirm your role. Try again in a moment.')
                    : 'Sign in with your organization account to continue.'}
            </p>
          </div>
        </div>

        <dl className="access-gate-details">
          <div>
            <dt>Signed in as</dt>
            <dd>{displayName}</dd>
          </div>
          {displayEmail ? (
            <div>
              <dt>Email</dt>
              <dd>{displayEmail}</dd>
            </div>
          ) : null}
          <div>
            <dt>Application roles</dt>
            <dd>{session?.roles?.length ? session.roles.join(', ') : 'Not assigned yet'}</dd>
          </div>
        </dl>

        <div className="access-gate-actions">
          {(phase === 'pending' || phase === 'database-unavailable') && (
            <button className="button secondary" onClick={() => void evaluateSession()} type="button">
              Check again
            </button>
          )}
          {isProductionHost() ? (
            <a className="button ghost access-gate-logout" href="/.auth/logout">
              <LogOut size={16} />
              Sign out
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
