#!/usr/bin/env node
import { instanceUiUrl } from "../src/instance-session.js";
import { openExternal } from "../src/platform.js";
import { ServiceClient } from "../src/service-client.js";
import { errorMessage } from "../src/util.js";

async function main() {
  const client = new ServiceClient();
  await client.ensureReady();
  await openExternal(instanceUiUrl(client.instanceDescriptor));
}

main().catch((error) => {
  console.error(`M18 Foundry could not open: ${errorMessage(error)}`);
  process.exitCode = 1;
});
