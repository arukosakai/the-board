import { FONTS, hexToRgba } from "/static/board.js";

const BOARD_FILE_FORMAT = "the-board";

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`couldn't load ${src}`));
    img.src = src;
  });
}

// Mirrors the .obj-text CSS (padding .15em .45em, radius .2em, line-height 1.2).
function drawText(ctx, obj) {
  const fs = obj.fontSize;
  const padX = 0.45 * fs;
  const padY = 0.15 * fs;
  const lineHeight = 1.2 * fs;
  const left = -obj.w / 2;
  const top = -obj.h / 2;

  ctx.fillStyle = hexToRgba(obj.bg, obj.bgOpacity);
  ctx.beginPath();
  ctx.roundRect(left, top, obj.w, obj.h, 0.2 * fs);
  ctx.fill();

  ctx.font = `${obj.italic ? "italic " : ""}${obj.bold ? 700 : 400} ${fs}px ${FONTS[obj.font] || FONTS.sans}`;
  ctx.fillStyle = obj.color;
  ctx.textBaseline = "alphabetic";
  const align = obj.align || "left";
  ctx.textAlign = align;
  const x = { left: left + padX, center: 0, right: -left - padX }[align];
  // CSS centers the font's ascent+descent box within each line, then sits text on the baseline.
  const { fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent } = ctx.measureText(obj.text);
  const baseline = (lineHeight - ascent - descent) / 2 + ascent;
  obj.text.split("\n").forEach((line, i) => ctx.fillText(line, x, top + padY + lineHeight * i + baseline));
}

// Animated GIFs come out as their first frame — PNG has no animation.
export async function renderPng(state, width, height) {
  const images = new Map();
  await Promise.all(
    state.objects
      .filter((o) => o.type === "image")
      .map(async (o) => images.set(o.src, await loadImage(o.src))),
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = state.board.bg;
  ctx.fillRect(0, 0, width, height);

  for (const obj of state.objects) {
    ctx.save();
    ctx.translate(obj.cx, height - obj.cy);
    ctx.rotate((obj.rot * Math.PI) / 180);
    ctx.globalAlpha = obj.opacity ?? 1;
    if (obj.type === "image") ctx.drawImage(images.get(obj.src), -obj.w / 2, -obj.h / 2, obj.w, obj.h);
    else drawText(ctx, obj);
    ctx.restore();
  }
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Self-contained: image bytes are embedded, so the file survives server restarts.
export async function exportBoardFile(state) {
  const assets = {};
  for (const src of new Set(state.objects.filter((o) => o.type === "image").map((o) => o.src))) {
    assets[src] = await blobToDataUrl(await (await fetch(src)).blob());
  }
  const file = { format: BOARD_FILE_FORMAT, version: 1, board: state.board, objects: state.objects, assets };
  return new Blob([JSON.stringify(file)], { type: "application/json" });
}

export function isBoardFile(file) {
  return file.type === "application/json" || file.name?.endsWith(".json");
}

// Re-uploads embedded images and returns { board, objects } pointing at the new asset URLs.
export async function importBoardFile(file, uploadBlob) {
  const parsed = JSON.parse(await file.text());
  if (parsed.format !== BOARD_FILE_FORMAT) throw new Error("not a the-board file");
  const remapped = {};
  for (const [oldSrc, dataUrl] of Object.entries(parsed.assets || {})) {
    remapped[oldSrc] = await uploadBlob(await (await fetch(dataUrl)).blob());
  }
  const objects = parsed.objects.map((o) => (o.type === "image" ? { ...o, src: remapped[o.src] ?? o.src } : o));
  return { board: parsed.board, objects };
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
