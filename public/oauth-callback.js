"use strict";

const result = document.getElementById("oauthResult");
const returnButton = document.getElementById("oauthReturnButton");

if (result) {
  const provider = result.dataset.provider || "";
  const connectionId = result.dataset.connectionId || "";
  const status = result.dataset.status || "error";
  const error = result.dataset.error || "OAuth sign-in was not completed";
  const message = {
    source: "m18-ai-oauth",
    provider,
    status,
    ...(connectionId ? { connectionId } : {}),
    ...(status === "error" ? { error } : {}),
  };

  if (status === "success" && provider && connectionId) {
    try {
      localStorage.setItem(`m18-ai-oauth:${provider}`, connectionId);
    } catch {
      // The opener receives the connection even when storage is unavailable.
    }
  }
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage(message, window.location.origin);
    window.setTimeout(() => window.close(), 900);
  }
}

returnButton?.addEventListener("click", () => {
  if (window.opener && !window.opener.closed) {
    window.opener.focus();
    window.close();
    return;
  }
  window.location.assign("/");
});
