import express from "express";
import { router } from "./routes.js";

const app = express();
app.use(express.json());
app.use(router);

const PORT = Number(process.env.PORT ?? 4006);
app.listen(PORT, () => {
  console.log(`E2B API running on http://localhost:${PORT}`);
});
