// This page renders App itself, so the mock follows the current components,
// styles and interaction rules. Only the clock and API transport are replaced.
import { installMockApi } from "./ui-mock-api";

installMockApi();

document.getElementById("reset-mock").addEventListener("click", () => {
  localStorage.setItem("ui-mock-token", "ui-mock-token");
  window.location.reload();
});

await import("./main.jsx");

import "./ui-mock.css";
