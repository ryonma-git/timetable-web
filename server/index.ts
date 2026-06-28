import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { handleRefresh, actionFromPath } from "./refreshEngine";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  // 年間指導計画「取得ブラウザ」API（本番）。scripts/ が同梱されている場合に動作。
  app.get("/api/refresh/:action", async (req, res) => {
    const action = actionFromPath(`/${req.params.action}`);
    if (!action) {
      res.status(404).json({ ok: false, error: "unknown_action" });
      return;
    }
    const { status, json } = await handleRefresh(action);
    res.status(status).json(json);
  });

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
