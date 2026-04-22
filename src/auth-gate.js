/**
 * DiscoCast — password gate overlay.
 *
 * Soft gate: password is injected at build time via VITE_APP_PASSWORD and
 * is visible in the built bundle. Keeps casual visitors out; not real auth.
 * Once entered, a localStorage marker lets the user back in without re-prompt.
 */

const STORAGE_KEY = 'discocast_auth_v1';
const EXPECTED = import.meta.env.VITE_APP_PASSWORD;

/**
 * Renders the gate overlay and resolves once the user is authenticated
 * (or immediately, if no password is configured or they're already unlocked).
 */
export function initAuthGate() {
  return new Promise((resolve) => {
    // No password configured → skip the gate entirely (useful for local dev).
    if (!EXPECTED) {
      resolve();
      return;
    }

    // Previously unlocked on this device.
    try {
      if (localStorage.getItem(STORAGE_KEY) === EXPECTED) {
        resolve();
        return;
      }
    } catch {
      // localStorage unavailable — fall through and require password.
    }

    injectStyles();
    const overlay = buildOverlay();
    document.body.appendChild(overlay);

    const input = overlay.querySelector('.dc-gate-input');
    const form = overlay.querySelector('.dc-gate-form');
    const error = overlay.querySelector('.dc-gate-error');
    const eyeBtn = overlay.querySelector('.dc-gate-eye');
    const eyeShow = overlay.querySelector('.dc-gate-eye-show');
    const eyeHide = overlay.querySelector('.dc-gate-eye-hide');

    eyeBtn.addEventListener('click', () => {
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      eyeShow.style.display = isPassword ? 'none' : '';
      eyeHide.style.display = isPassword ? '' : 'none';
      eyeBtn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    });

    input.focus();

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (input.value === EXPECTED) {
        try {
          localStorage.setItem(STORAGE_KEY, EXPECTED);
        } catch {
          // Non-fatal: user will need to re-enter next visit.
        }
        overlay.classList.add('dc-gate-exit');
        setTimeout(() => {
          overlay.remove();
          resolve();
        }, 240);
      } else {
        error.textContent = 'Incorrect password';
        overlay.querySelector('.dc-gate-card').classList.remove('dc-gate-shake');
        // Force reflow so the animation can re-trigger.
        void overlay.offsetWidth;
        overlay.querySelector('.dc-gate-card').classList.add('dc-gate-shake');
        input.select();
      }
    });

    input.addEventListener('input', () => {
      if (error.textContent) error.textContent = '';
    });
  });
}

function buildOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'dc-gate-overlay';
  overlay.innerHTML = `
    <div class="dc-gate-card" role="dialog" aria-modal="true" aria-labelledby="dc-gate-title">
      <img src="/logo.png" alt="DiscoCast" class="dc-gate-logo" />
      <h1 id="dc-gate-title" class="dc-gate-title">DiscoCast</h1>
      <p class="dc-gate-subtitle">Enter password to continue</p>
      <form class="dc-gate-form" autocomplete="off">
        <div class="dc-gate-input-wrap">
          <input
            type="password"
            class="dc-gate-input"
            placeholder="Password"
            autocomplete="current-password"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            required
          />
          <button type="button" class="dc-gate-eye" aria-label="Show password">
            <svg class="dc-gate-eye-icon dc-gate-eye-show" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            <svg class="dc-gate-eye-icon dc-gate-eye-hide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:none">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          </button>
        </div>
        <button type="submit" class="dc-gate-button">Unlock</button>
        <p class="dc-gate-error" role="alert" aria-live="polite"></p>
      </form>
    </div>
  `;
  return overlay;
}

function injectStyles() {
  if (document.getElementById('dc-gate-styles')) return;
  const style = document.createElement('style');
  style.id = 'dc-gate-styles';
  style.textContent = `
    .dc-gate-overlay {
      position: fixed; inset: 0; z-index: 100000;
      background: #000;
      display: flex; align-items: center; justify-content: center;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #fff;
      animation: dc-gate-fade-in 300ms ease;
    }
    .dc-gate-overlay.dc-gate-exit { animation: dc-gate-fade-out 240ms ease forwards; }

    .dc-gate-card {
      width: min(380px, calc(100vw - 32px));
      padding: 36px 32px 28px;
      background: #0a0a0a;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.9);
      display: flex; flex-direction: column; align-items: center;
      text-align: center;
    }

    .dc-gate-logo {
      width: 140px; height: 140px; object-fit: contain;
      margin-bottom: 12px;
      user-select: none; -webkit-user-drag: none;
    }

    .dc-gate-title {
      font-size: 1.5rem; font-weight: 600;
      letter-spacing: 0.02em;
      margin: 0 0 4px;
    }

    .dc-gate-subtitle {
      font-size: 0.85rem;
      color: #888;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      margin: 0 0 24px;
    }

    .dc-gate-form {
      width: 100%;
      display: flex; flex-direction: column; gap: 10px;
    }

    .dc-gate-input-wrap {
      position: relative;
      width: 100%;
    }

    .dc-gate-input {
      width: 100%;
      padding: 12px 44px 12px 14px;
      background: #000;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      color: #fff;
      font: inherit; font-size: 0.95rem;
      outline: none;
      transition: border-color 150ms ease, background 150ms ease;
    }
    .dc-gate-input:focus {
      border-color: rgba(255, 255, 255, 0.45);
      background: #050505;
    }
    .dc-gate-input::placeholder { color: #555; }

    .dc-gate-eye {
      position: absolute;
      right: 10px; top: 50%;
      transform: translateY(-50%);
      background: none; border: none; padding: 4px;
      color: #666; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: color 150ms ease;
    }
    .dc-gate-eye:hover { color: #fff; }
    .dc-gate-eye-icon { width: 18px; height: 18px; display: block; }

    .dc-gate-button {
      width: 100%;
      padding: 12px 14px;
      background: #fff;
      color: #000;
      border: none;
      border-radius: 8px;
      font: inherit; font-size: 0.95rem; font-weight: 600;
      letter-spacing: 0.02em;
      cursor: pointer;
      transition: transform 100ms ease, opacity 150ms ease;
    }
    .dc-gate-button:hover { opacity: 0.9; }
    .dc-gate-button:active { transform: scale(0.98); }

    .dc-gate-error {
      min-height: 1.2em;
      margin: 2px 0 0;
      font-size: 0.8rem;
      color: #ff5a5a;
      letter-spacing: 0.02em;
    }

    .dc-gate-shake { animation: dc-gate-shake 360ms ease; }

    @keyframes dc-gate-fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @keyframes dc-gate-fade-out {
      from { opacity: 1; }
      to   { opacity: 0; }
    }
    @keyframes dc-gate-shake {
      0%, 100% { transform: translateX(0); }
      20% { transform: translateX(-8px); }
      40% { transform: translateX(8px); }
      60% { transform: translateX(-5px); }
      80% { transform: translateX(5px); }
    }
  `;
  document.head.appendChild(style);
}
