import jsQR from 'jsqr';
import { ApiError, type Attendee } from './api';
import { drawQr } from './qr';

// Rebuilds a banner ticket in the browser after a name or student ID is
// corrected. It follows the layout of `npm run tickets -- render`: the QR fills
// the white square, the name sits above it in capitals and the ID below it.

const FONT = 'Arial, "Helvetica Neue", Helvetica, sans-serif';
type Template = { source: CanvasImageSource; width: number; height: number };
let templateImage: Promise<Template> | null = null;

function loadTemplate() {
  templateImage ??= (async () => {
    const response = await fetch('/api/tm/ticket-template', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new ApiError(data.error || 'Could not load the ticket template', response.status);
    }
    const blob = await response.blob();
    // createImageBitmap does not wait for the page to paint, unlike image.decode().
    try {
      const bitmap = await createImageBitmap(blob);
      return { source: bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Could not read the ticket template'));
        image.src = URL.createObjectURL(blob);
      });
      return { source: image, width: image.naturalWidth, height: image.naturalHeight };
    }
  })();
  templateImage.catch(() => { templateImage = null; });
  return templateImage;
}

// Finds the white square by its long straight edges, like the render script.
function findBox(context: CanvasRenderingContext2D, width: number, height: number) {
  const { data } = context.getImageData(0, 0, width, height);
  const white = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    return data[offset] > 215 && data[offset + 1] > 215 && data[offset + 2] > 215;
  };
  const columns: number[] = [];
  for (let x = Math.floor(width * 0.5); x < width; x += 1) {
    let count = 0;
    for (let y = 0; y < height; y += 1) if (white(x, y)) count += 1;
    if (count > height * 0.3) columns.push(x);
  }
  if (columns.length < 2) throw new Error('Could not find the QR square on the ticket template');
  const left = columns[0];
  const right = columns[columns.length - 1];
  const rows: number[] = [];
  for (let y = 0; y < height; y += 1) {
    let count = 0;
    for (let x = left; x <= right; x += 1) if (white(x, y)) count += 1;
    if (count > (right - left) * 0.8) rows.push(y);
  }
  if (rows.length < 2) throw new Error('Could not find the QR square on the ticket template');
  return { left, top: rows[0], width: right - left + 1, height: rows[rows.length - 1] - rows[0] + 1 };
}

function wrap(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && context.measureText(next).width > maxWidth) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderBanner(attendee: Attendee): Promise<Blob> {
  const template = await loadTemplate();
  const { width, height } = template;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(template.source, 0, 0);
  const box = findBox(context, width, height);

  context.fillStyle = '#ffffff';
  context.fillRect(box.left, box.top, box.width, box.height);
  const border = Math.max(4, Math.round(box.width * 0.02));
  const qrSize = box.width - border * 2;
  const qrLeft = box.left + Math.round((box.width - qrSize) / 2);
  const qrTop = box.top + Math.round((box.height - qrSize) / 2);
  drawQr(context, attendee.token, qrLeft, qrTop, qrSize);

  const centreX = box.left + box.width / 2;
  const nameWidth = Math.floor(Math.min(box.width * 1.85, (width - centreX) * 2 - 90));
  const nameHeight = Math.floor(Math.min(box.top - 24, box.height * 0.42));
  let size = Math.round(box.height * 0.137);
  let lines: string[] = [];
  for (; size >= box.height * 0.07; size -= 2) {
    context.font = `bold ${size}px ${FONT}`;
    lines = wrap(context, attendee.name.toUpperCase(), nameWidth);
    if (lines.length * size * 1.17 <= nameHeight) break;
  }
  const lineHeight = size * 1.17;
  const bottom = box.top - Math.round(box.height * 0.07);
  context.fillStyle = '#ffffff';
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  lines.forEach((line, index) => {
    const baseline = bottom - (lines.length - 1 - index) * lineHeight - size * 0.22;
    context.fillText(line, centreX, baseline);
  });

  if (attendee.studentId) {
    context.font = `${Math.round(box.height * 0.07)}px ${FONT}`;
    context.fillStyle = '#f3d9de';
    context.textBaseline = 'top';
    context.fillText(`ID ${attendee.studentId}`, centreX, box.top + box.height + Math.round(box.height * 0.08));
  }

  // Never upload a ticket whose QR code does not read back as this person's code.
  const area = context.getImageData(box.left, box.top, box.width, box.height);
  if (jsQR(area.data, area.width, area.height)?.data !== attendee.token) throw new Error('The rebuilt ticket QR did not verify. Nothing was changed.');

  return new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Could not create the ticket image'))), 'image/jpeg', 0.92));
}

export async function uploadBanner(attendee: Attendee): Promise<Attendee> {
  const image = await renderBanner(attendee);
  const response = await fetch(`/api/tm/attendees/${attendee.id}/ticket`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'image/jpeg' },
    body: image,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error || 'Could not save the new ticket', response.status);
  return data.attendee as Attendee;
}

export async function downloadBanner(attendee: Attendee, filename: string) {
  const response = await fetch(`/api/tm/attendees/${attendee.id}/ticket`, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(data.error || 'Could not load the ticket', response.status);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
