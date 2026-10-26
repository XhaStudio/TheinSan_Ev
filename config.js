"use strict";

// Where the Mini App finds the admin API.
//
// • Serve the UI and the API from the same FastAPI process  → leave "" (default).
// • Host this folder on GitHub Pages (or any static host)   → set the public
//   HTTPS address of the API, e.g. "https://admin.example.com".
//
// The address must be HTTPS: GitHub Pages is HTTPS, and browsers block a
// plain-http request from an https:// page.
window.MINIAPP_API_BASE = "https://github.com/XhaStudio/TheinSan_Ev";
