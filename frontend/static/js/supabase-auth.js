/* Supabase authentication for the static Pages build. No local password auth. */
(() => {
  "use strict";

  const config = window.IntenseFXAuthConfig || {};
  const configured = Boolean(String(config.supabaseUrl || "").trim() || String(config.supabaseAnonKey || "").trim());
  const configValid = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(String(config.supabaseUrl || "").trim()) &&
    typeof config.supabaseAnonKey === "string" && config.supabaseAnonKey.trim().length > 20;
  const state = { client: null, session: null, profile: null, subscription: null, mode: "login", busy: false, error: "", initialized: false };
  let authClientLoad = null;
  let scopedStorageUser = null;

  function el(id) { return document.getElementById(id); }
  function notice(message, kind = "info") {
    const node = el("authNotice");
    if (!node) return;
    node.textContent = message || "";
    node.dataset.kind = kind;
    node.hidden = !message;
  }
  function busy(value) {
    state.busy = value;
    ["authSubmit", "authGoogle"].forEach((id) => { const node = el(id); if (node) node.disabled = value; });
    const button = el("authSubmit");
    if (button) button.textContent = value ? "Please wait…" : submitLabel(state.mode);
  }
  function submitLabel(mode) {
    return ({ login: "Sign in", signup: "Create account", forgot: "Send reset link", reset: "Save new password" })[mode] || "Sign in";
  }
  function showGate(message, mode) {
    const gate = el("authGate");
    if (!gate) return;
    if (mode) setMode(mode);
    gate.hidden = false;
    document.body.classList.add("auth-required");
    document.getElementById("appSplash")?.classList.add("hidden");
    if (message) notice(message, "error");
    window.setTimeout(() => (state.mode === "signup" ? el("authName") : el("authEmail"))?.focus(), 0);
  }
  function hideGate() {
    const gate = el("authGate");
    if (gate) gate.hidden = true;
    document.body.classList.remove("auth-required");
  }
  function setMode(mode) {
    state.mode = mode;
    const signup = mode === "signup", forgot = mode === "forgot", reset = mode === "reset";
    const title = el("authTitle"), name = document.querySelector(".auth-name-field"), emailField = document.querySelector(".auth-email-field"), password = document.querySelector(".auth-password-field"),
      confirm = document.querySelector(".auth-confirm-field"), terms = el("authTermsRow"), links = el("authLinks"), google = el("authGoogle"), showPassword = el("authShowPassword");
    if (title) title.textContent = signup ? "Create your account" : forgot ? "Reset your password" : reset ? "Choose a new password" : "Sign in to your workspace";
    if (name) name.hidden = !signup;
    if (emailField) emailField.hidden = reset;
    if (password) password.hidden = forgot;
    if (confirm) confirm.hidden = !signup && !reset;
    if (terms) terms.hidden = forgot || reset;
    if (links) links.hidden = signup || forgot || reset;
    if (google) google.hidden = forgot || reset;
    if (showPassword) showPassword.hidden = forgot;
    const fields = [el("authPassword"), el("authConfirmPassword")];
    if (fields[0]) fields[0].required = !forgot;
    if (fields[1]) fields[1].required = signup || reset;
    const email = el("authEmail");
    if (email) email.required = !reset;
    const submit = el("authSubmit");
    if (submit) submit.textContent = submitLabel(mode);
    const linksRow = el("authLinks");
    if (linksRow && (forgot || reset)) {
      linksRow.hidden = false;
      linksRow.innerHTML = '<button type="button" data-auth-mode="login">Back to sign in</button>';
    } else if (linksRow && !signup) {
      linksRow.innerHTML = '<button type="button" data-auth-mode="forgot">Forgot password?</button><span>New here? <button type="button" data-auth-mode="signup">Create account</button></span>';
    }
    const form = el("authForm");
    if (el("authPassword")) el("authPassword").value = "";
    if (el("authConfirmPassword")) el("authConfirmPassword").value = "";
    if (el("authTerms")) el("authTerms").checked = false;
    notice("");
  }
  function explainError(error) {
    const text = String(error?.message || error || "");
    if (/invalid login credentials/i.test(text)) return "That email and password do not match. Check them and try again.";
    if (/email not confirmed/i.test(text)) return "Verify your email using the link we sent before signing in.";
    if (/already registered|user already exists/i.test(text)) return "An account already exists for this email. Sign in or reset your password.";
    if (/password.*(weak|short|characters)/i.test(text)) return "Use a password with at least 8 characters, including a letter and a number.";
    if (/rate limit|too many requests/i.test(text)) return "Too many attempts. Wait a little and try again.";
    if (/network|fetch/i.test(text)) return "Could not reach the authentication service. Check your connection and try again.";
    return text || "Authentication could not be completed. Please try again.";
  }
  function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
  function validPassword(value) { return value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value); }
  function scopeBrowserData(userId) {
    if (!userId || scopedStorageUser === userId) return;
    scopedStorageUser = userId;
    const prefix = `tfb_user_${userId}_`;
    const proto = Storage.prototype;
    if (!proto.__iftScopedMethods) {
      const originals = { getItem: proto.getItem, setItem: proto.setItem, removeItem: proto.removeItem };
      Object.defineProperty(proto, "__iftScopedMethods", { value: originals, configurable: false });
      proto.getItem = function(key) { const value = String(key); return originals.getItem.call(this, this === window.localStorage && value.startsWith("tfb_") && !value.startsWith(prefix) ? prefix + value : value); };
      proto.setItem = function(key, value) { const name = String(key); return originals.setItem.call(this, this === window.localStorage && name.startsWith("tfb_") && !name.startsWith(prefix) ? prefix + name : name, value); };
      proto.removeItem = function(key) { const value = String(key); return originals.removeItem.call(this, this === window.localStorage && value.startsWith("tfb_") && !value.startsWith(prefix) ? prefix + value : value); };
    }
    window.TradeFXBookPages?.setUserScope?.(userId);
    window.UI?.refreshPreferences?.();
  }
  async function loadSdk() {
    if (window.supabase?.createClient) return window.supabase;
    if (authClientLoad) return authClientLoad;
    authClientLoad = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-supabase-sdk]');
      if (existing) {
        existing.addEventListener("load", () => window.supabase?.createClient ? resolve(window.supabase) : reject(new Error("Supabase Auth library did not initialize.")), { once: true });
        existing.addEventListener("error", () => reject(new Error("Supabase Auth library could not be loaded.")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/dist/umd/supabase.js";
      script.async = true;
      script.dataset.supabaseSdk = "true";
      script.onload = () => window.supabase?.createClient ? resolve(window.supabase) : reject(new Error("Supabase Auth library did not initialize."));
      script.onerror = () => reject(new Error("Supabase Auth library could not be loaded."));
      document.head.append(script);
    });
    return authClientLoad;
  }
  async function fetchAccountData() {
    if (!state.session?.user || !state.client) return;
    const user = state.session.user;
    const [profileResult, subscriptionResult] = await Promise.all([
      state.client.from("profiles").select("user_id,email,full_name,avatar_url,created_at,updated_at").eq("user_id", user.id).maybeSingle(),
      state.client.from("subscriptions").select("plan_code,status,current_period_end").eq("user_id", user.id).maybeSingle(),
    ]);
    if (profileResult.error) throw profileResult.error;
    if (subscriptionResult.error) throw subscriptionResult.error;
    state.profile = profileResult.data;
    state.subscription = subscriptionResult.data;
    renderAccount();
  }
  function renderAccount() {
    const user = state.session?.user;
    const displayName = state.profile?.full_name || user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Account";
    const pillAvatar = el("userAvatar");
    if (pillAvatar) pillAvatar.textContent = displayName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "U";
    if (el("authAccountName")) el("authAccountName").textContent = displayName;
    if (el("authAccountEmail")) el("authAccountEmail").textContent = user?.email || "";
    if (el("authProfileName")) el("authProfileName").value = state.profile?.full_name || user?.user_metadata?.full_name || "";
    if (el("authAccountAvatar")) el("authAccountAvatar").textContent = displayName[0]?.toUpperCase() || "U";
    const trustedPlan = window.SubscriptionSystem?.normalizePlan?.(state.subscription) || "blue";
    const plan = trustedPlan === "blue" ? (window.SubscriptionSystem?.getUserPlan?.().code || "blue") : trustedPlan;
    const planNames = { blue: "Blue · Free", green: "Green · Starter", purple: "Purple · Pro", red: "Red · Elite" };
    if (el("authPlanName")) el("authPlanName").textContent = planNames[plan] || "Blue · Free";
    if (el("authPlanStatus")) el("authPlanStatus").textContent = trustedPlan === "blue" && window.SubscriptionSystem?.getVipPlanCode?.() ? "VIP key · this browser" : (state.subscription?.status || "Free plan");
    document.body.dataset.authPlan = ["blue", "green", "purple", "red"].includes(plan) ? plan : "blue";
    window.dispatchEvent(new Event("intensefx:subscription-changed"));
  }
  function completeSignIn() {
    hideGate();
    document.dispatchEvent(new CustomEvent("intensefx:authenticated"));
  }
  function attachControls() {
    el("authLinks")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-auth-mode]");
      if (button) setMode(button.dataset.authMode);
    });
    el("authShowPassword")?.addEventListener("click", () => {
      const input = el("authPassword"), reveal = input.type === "password";
      input.type = reveal ? "text" : "password";
      el("authShowPassword").textContent = reveal ? "Hide" : "Show";
      el("authShowPassword").setAttribute("aria-label", reveal ? "Hide password" : "Show password");
    });
    el("authForm")?.addEventListener("submit", submitAuthForm);
    el("authGoogle")?.addEventListener("click", googleSignIn);
    const pill = el("userPill"), popover = el("authAccountPopover");
    if (pill) {
      pill.title = configured ? "Account and subscription" : "Device-local workspace · cloud sign-in is not configured";
      pill.setAttribute("aria-disabled", String(!configured));
      if (!configured) pill.style.cursor = "default";
    }
    if (configured) pill?.addEventListener("click", () => {
      if (!state.session) { showGate("Sign in to open your account."); return; }
      popover.hidden = !popover.hidden;
    });
    document.addEventListener("click", (event) => { if (popover && !popover.hidden && !popover.contains(event.target) && !pill?.contains(event.target)) popover.hidden = true; });
    el("authProfileSave")?.addEventListener("click", saveProfile);
    el("authSignout")?.addEventListener("click", signOut);
  }
  async function submitAuthForm(event) {
    event.preventDefault();
    if (!state.client || state.busy) return;
    const email = el("authEmail").value.trim().toLowerCase();
    const password = el("authPassword").value;
    const name = el("authName").value.trim();
    const confirmation = el("authConfirmPassword").value;
    const mode = state.mode;
    if (mode !== "reset" && !validEmail(email)) return notice("Enter a valid email address.", "error");
    if ((mode === "login" || mode === "signup" || mode === "reset") && !validPassword(password)) return notice("Use at least 8 characters, including a letter and a number.", "error");
    if ((mode === "signup" || mode === "reset") && password !== confirmation) return notice("The passwords do not match.", "error");
    if (mode === "signup" && !name) return notice("Enter your full name.", "error");
    if (mode === "signup" && !el("authTerms").checked) return notice("Accept the Terms of Service and Privacy Policy to create an account.", "error");
    busy(true);
    try {
      let result;
      if (mode === "signup") {
        result = await state.client.auth.signUp({ email, password, options: { data: { full_name: name, terms_accepted_at: new Date().toISOString(), terms_version: "draft-1" }, emailRedirectTo: callbackUrl() } });
        if (result.error) throw result.error;
        if (result.data.session) { state.session = result.data.session; scopeBrowserData(state.session.user.id); await fetchAccountData(); completeSignIn(); }
        else { setMode("login"); notice("Account created. Check your email and use the verification link before signing in.", "success"); }
      } else if (mode === "login") {
        result = await state.client.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        state.session = result.data.session;
        scopeBrowserData(state.session.user.id);
        await fetchAccountData();
        completeSignIn();
      } else if (mode === "forgot") {
        result = await state.client.auth.resetPasswordForEmail(email, { redirectTo: resetCallbackUrl() });
        if (result.error) throw result.error;
        setMode("login");
        notice("If an account exists for that email, a password reset link has been sent.", "success");
      } else if (mode === "reset") {
        result = await state.client.auth.updateUser({ password });
        if (result.error) throw result.error;
        state.session = (await state.client.auth.getSession()).data.session;
        if (state.session?.user?.id) scopeBrowserData(state.session.user.id);
        await fetchAccountData();
        completeSignIn();
        window.toast?.("Password updated.", "success");
      }
    } catch (error) { notice(explainError(error), "error"); }
    finally { busy(false); }
  }
  function callbackUrl() {
    const target = new URL(window.location.href);
    target.search = "";
    target.hash = "";
    return target.toString();
  }
  function resetCallbackUrl() { return `${callbackUrl()}#password-reset`; }
  async function googleSignIn() {
    if (!state.client || state.busy) return;
    if (!el("authTerms")?.checked) return notice("Accept the Terms of Service and Privacy Policy before continuing with Google.", "error");
    busy(true);
    try {
      sessionStorage.setItem("ift_google_terms_pending", "1");
      const { error } = await state.client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: callbackUrl(), queryParams: { prompt: "select_account" } } });
      if (error) throw error;
    } catch (error) { sessionStorage.removeItem("ift_google_terms_pending"); notice(explainError(error), "error"); busy(false); }
  }
  async function saveProfile() {
    const fullName = el("authProfileName")?.value.trim();
    if (!state.session?.user || !fullName) return window.toast?.("Enter a display name.", "error");
    if (fullName.length > 80) return window.toast?.("Display name must be 80 characters or fewer.", "error");
    const button = el("authProfileSave"); button.disabled = true;
    try {
      const [{ error: profileError }, { error: metadataError }] = await Promise.all([
        state.client.from("profiles").update({ full_name: fullName }).eq("user_id", state.session.user.id),
        state.client.auth.updateUser({ data: { full_name: fullName } }),
      ]);
      if (profileError) throw profileError;
      if (metadataError) throw metadataError;
      await fetchAccountData();
      el("authAccountPopover").hidden = true;
      window.toast?.("Profile updated.", "success");
    } catch (error) { window.toast?.(explainError(error), "error"); }
    finally { button.disabled = false; }
  }
  async function signOut() {
    if (!state.client) return;
    const button = el("authSignout"); button.disabled = true;
    try {
      const { error } = await state.client.auth.signOut();
      if (error) throw error;
      state.session = null; state.profile = null; state.subscription = null;
      el("authAccountPopover").hidden = true;
      window.location.reload();
    } catch (error) { window.toast?.(explainError(error), "error"); button.disabled = false; }
  }
  async function initialize() {
    attachControls();
    state.initialized = true;
    if (!configured) return { configured: false, session: null };
    if (!configValid) {
      showGate("Authentication is enabled but its public Supabase URL/key are incomplete.");
      el("authConfigHint").hidden = false;
      [el("authForm"), el("authGoogle")].forEach((node) => { if (node) node.hidden = true; });
      return { configured: true, session: null, error: "invalid-config" };
    }
    try {
      if (!window.supabase?.createClient) await loadSdk();
      if (!window.supabase?.createClient) throw new Error("Supabase Auth library could not be loaded.");
      state.client = window.supabase.createClient(config.supabaseUrl.trim(), config.supabaseAnonKey.trim(), {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
      });
      const { data, error } = await state.client.auth.getSession();
      if (error) throw error;
      state.session = data.session;
      const currentHash = new URLSearchParams(window.location.hash.slice(1));
      const callbackError = new URLSearchParams(window.location.search).get("error_description") || new URLSearchParams(window.location.hash.slice(1)).get("error_description");
      if (callbackError) showGate(explainError(callbackError), "login");
      if (currentHash.get("type") === "recovery" || window.location.hash.includes("password-reset")) { showGate("Choose a new password for your account.", "reset"); }
      if (state.session) {
        scopeBrowserData(state.session.user.id);
        if (sessionStorage.getItem("ift_google_terms_pending") === "1") {
          sessionStorage.removeItem("ift_google_terms_pending");
          await state.client.auth.updateUser({ data: { terms_accepted_at: new Date().toISOString(), terms_version: "draft-1" } });
        }
        await fetchAccountData();
        renderAccount();
      }
      state.client.auth.onAuthStateChange((event, session) => {
        state.session = session;
        if (event === "PASSWORD_RECOVERY") { showGate("Choose a new password for your account.", "reset"); return; }
        if (event === "SIGNED_OUT") { window.location.reload(); return; }
        if (event === "SIGNED_IN" && session) {
          window.setTimeout(async () => {
            try { scopeBrowserData(session.user.id); await fetchAccountData(); } catch (error) { window.console?.error("Could not load account profile", error); }
            completeSignIn();
          }, 0);
        }
      });
      if (!state.session) showGate();
      return { configured: true, session: state.session };
    } catch (error) {
      showGate(explainError(error));
      el("authConfigHint").hidden = false;
      el("authConfigHint").textContent = "Authentication could not connect. Check the Supabase URL, public key, and allowed callback URLs.";
      [el("authForm"), el("authGoogle")].forEach((node) => { if (node) node.hidden = true; });
      return { configured: true, session: null, error };
    }
  }
  window.IntenseFXAuth = { initialize, getUser: () => state.session?.user || null, getPlan: () => window.SubscriptionSystem?.getUserPlan?.().code || state.subscription?.plan_code || "blue", getSubscription: () => state.subscription, showGate, setMode };
})();
