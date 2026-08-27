import { spawn } from "node:child_process";

function launch(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      detached: true,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve({ pid: child.pid });
    });
  });
}

export class ActionRunner {
  async run(action) {
    if (action.type === "none") {
      return { executed: false, reason: "No action is assigned" };
    }
    if (action.type === "command") {
      const result = await launch(action.executable, action.args);
      return { executed: true, type: "command", executable: action.executable, ...result };
    }
    if (action.type === "url") {
      const result = await launch("xdg-open", [action.url]);
      return { executed: true, type: "url", url: action.url, ...result };
    }
    throw new Error(`Action type ${action.type} must be handled by the controller`);
  }
}
