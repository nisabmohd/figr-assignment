// One command: mock backend (API :4000, pages :4001) + the board app (:5173).
import { createRequire } from "node:module";
import { createServer } from "vite";

const require = createRequire(import.meta.url);
require("../backend/server.js"); // CommonJS; listens on import

const server = await createServer({ configFile: "frontend/vite.config.mts" });
await server.listen();
server.printUrls();
