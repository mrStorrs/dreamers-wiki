#!/usr/bin/env node
import { runServer } from "./server.js";

runServer().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
