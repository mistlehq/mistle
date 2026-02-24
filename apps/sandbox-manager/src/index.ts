import { startServer } from "./server.js";

const port = Number(process.env.PORT ?? "3000");

startServer(port);

console.log("@mistle/sandbox-manager listening on port " + port);
