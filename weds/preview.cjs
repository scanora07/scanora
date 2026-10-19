const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mp4": "video/mp4", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };

http.createServer((request, response) => {
  let file;
  try {
    file = path.resolve(root, "." + decodeURIComponent(new URL(request.url, "http://localhost").pathname));
  } catch (error) {
    console.error("Invalid preview URL:", error.message);
    response.writeHead(400).end("Invalid URL");
    return;
  }
  if (!/^\/weds\/(?:index\.html|gift\.js|weds\.(?:css|js)|shared\/calendar\.js|assets\/[a-z-]+\.(?:png|jpg|svg|mp4))?$/.test(new URL(request.url, "http://localhost").pathname)) {
    response.writeHead(404).end("Not found");
    return;
  }
  if (file !== root && !file.startsWith(root + path.sep)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  fs.stat(file, (error, stat) => {
    if (!error && stat.isDirectory()) file = path.join(file, "index.html");
    fs.readFile(file, (readError, data) => {
      if (readError) {
        response.writeHead(404).end("Not found");
        return;
      }
      response.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
        "Content-Length": data.length,
        "Cache-Control": "no-store"
      }).end(data);
    });
  });
}).listen(4173, "127.0.0.1", () => {
  console.log("Preview: http://127.0.0.1:4173/weds/");
});
