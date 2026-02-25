import { startServer } from "./server.js";

const port = Number(process.env.PORT ?? "3001");

startServer(port);

console.log("@mistle/data-plane-worker listening on port " + port);
