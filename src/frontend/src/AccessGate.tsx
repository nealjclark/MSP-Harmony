import { LoaderCircle, LogIn, LogOut, ShieldCheck } from 'lucide-react';
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

function loginHref(selectAccount = false) {
  const redirectUri = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const searchParams = new URLSearchParams({
    post_login_redirect_uri: redirectUri || '/',
  });

  if (selectAccount) {
    searchParams.set('prompt', 'select_account');
  }

  return `/.auth/login/aad?${searchParams.toString()}`;
}

function redirectToLogin() {
  window.location.assign(loginHref(true));
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
  const statusTitle =
    phase === 'checking'
      ? 'Signing you in...'
      : phase === 'pending'
        ? 'Access pending'
        : phase === 'database-unavailable'
          ? 'Sign-in paused'
          : 'Sign in to continue';
  const statusBody =
    phase === 'checking'
      ? undefined
      : phase === 'pending'
        ? 'This email is signed in, but it does not have access to MSP Harmony yet.'
        : phase === 'database-unavailable'
          ? 'We could not finish signing you in. Try again in a moment.'
          : 'Choose your Microsoft account to continue.';

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
            <strong>{statusTitle}</strong>
            {statusBody ? <p>{statusBody}</p> : null}
          </div>
        </div>

        {displayEmail ? (
          <div className="access-gate-account">
            <span>Signed in as</span>
            <strong>{displayEmail}</strong>
          </div>
        ) : null}

        <div className="access-gate-actions">
          {(phase === 'pending' || phase === 'database-unavailable') && (
            <button className="button secondary" onClick={() => void evaluateSession()} type="button">
              Check again
            </button>
          )}
          {isProductionHost() ? (
            <a className="button primary access-gate-login" href={loginHref(true)}>
              <LogIn size={16} />
              Use another account
            </a>
          ) : null}
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
