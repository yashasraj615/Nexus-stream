import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
  );
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function dismissedRecently() {
  const raw = sessionStorage.getItem("nexus-install-dismissed");
  return raw === "1";
}

export function InstallApp({ compact = false }: { compact?: boolean }) {
  const [standalone, setStandalone] = useState(isStandalone);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [hidden, setHidden] = useState(dismissedRecently);

  useEffect(() => {
    const sync = () => setStandalone(isStandalone());
    const mq = window.matchMedia("(display-mode: standalone)");
    mq.addEventListener("change", sync);
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", sync);
    return () => {
      mq.removeEventListener("change", sync);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", sync);
    };
  }, []);

  if (standalone || hidden) return null;

  const canInstall = Boolean(deferred);
  const showIos = iosHint || (isIos() && !canInstall);
  if (!canInstall && !isIos() && compact) return null;
  if (!canInstall && !showIos && compact) return null;

  async function install() {
    if (!deferred) {
      if (isIos()) {
        window.alert("Tap Share, then Add to Home Screen.");
        setIosHint(true);
      }
      return;
    }
    await deferred.prompt();
    const choice = await deferred.userChoice;
    setDeferred(null);
    if (choice.outcome === "accepted") setStandalone(true);
  }

  function dismiss() {
    sessionStorage.setItem("nexus-install-dismissed", "1");
    setHidden(true);
  }

  if (compact) {
    return (
      <button className="ghost-btn" type="button" onClick={() => void install()}>
        {isIos() ? "Add to Home Screen" : "Install app"}
      </button>
    );
  }

  if (!canInstall && !isIos()) return null;

  return (
    <aside className="install-banner glass-strong">
      <img src="/icon-192.png" alt="" />
      <div>
        <strong>Install Nexus Stream</strong>
        {showIos && isIos() ? (
          <p>Tap Share, then Add to Home Screen for a full-screen app.</p>
        ) : (
          <p>Add it to your home screen for the same layout on phone and desktop.</p>
        )}
      </div>
      <div className="install-actions">
        {canInstall ? (
          <button className="primary-btn" type="button" onClick={() => void install()}>
            Install
          </button>
        ) : null}
        <button className="ghost-btn" type="button" onClick={dismiss}>
          Not now
        </button>
      </div>
    </aside>
  );
}
