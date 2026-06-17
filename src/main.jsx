import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";
import AdminPage from "./AdminPage.jsx";

// autoUpdate: новый SW активируется и страница перезагружается на свежую версию.
registerSW({ immediate: true });

const isAdmin = window.location.pathname === "/admin";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {isAdmin ? <AdminPage /> : <App />}
  </StrictMode>
);
