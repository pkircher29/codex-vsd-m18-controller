import { externalOpenSpec, launchDetached } from "./platform.js";

export class ActionRunner {
  constructor({ platform = process.platform, env = process.env, spawnImplementation } = {}) {
    this.platform = platform;
    this.env = env;
    this.spawnImplementation = spawnImplementation;
  }

  async run(action) {
    if (action.type === "none") {
      return { executed: false, reason: "No action is assigned" };
    }
    if (action.type === "command") {
      if (this.platform === "win32" && /\.(?:bat|cmd)$/i.test(action.executable)) {
        throw new Error(
          "Windows .bat and .cmd actions require a command shell, which M18 Foundry does not invoke. Use powershell.exe with an explicit -File argument or a native executable.",
        );
      }
      const result = await launchDetached(
        { executable: action.executable, args: action.args, env: this.env },
        { spawnImplementation: this.spawnImplementation },
      );
      return { executed: true, type: "command", executable: action.executable, ...result };
    }
    if (action.type === "url") {
      const result = await launchDetached(
        externalOpenSpec(action.url, { platform: this.platform, env: this.env }),
        { spawnImplementation: this.spawnImplementation },
      );
      return { executed: true, type: "url", url: action.url, ...result };
    }
    throw new Error(`Action type ${action.type} must be handled by the controller`);
  }
}
