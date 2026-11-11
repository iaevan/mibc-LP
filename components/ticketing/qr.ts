import { encode } from 'uqr';
import type { Attendee } from './api';

// Version 1 QR (21 x 21 modules) at error correction Q. Tiny codes scan fastest.
export function qrMatrix(token: string) {
  return encode(token, { ecc: 'Q' }).data;
}

export function drawQr(context: CanvasRenderingContext2D, token: string, x: number, y: number, size: number) {
  const matrix = qrMatrix(token);
  const quiet = 2;
  const cells = matrix.length + quiet * 2;
  const cell = Math.floor(size / cells);
  const offset = Math.floor((size - cell * cells) / 2);
  context.fillStyle = '#ffffff';
  context.fillRect(x, y, size, size);
  context.fillStyle = '#000000';
  matrix.forEach((row, rowIndex) => row.forEach((dark, columnIndex) => {
    if (dark) context.fillRect(x + offset + (columnIndex + quiet) * cell, y + offset + (rowIndex + quiet) * cell, cell, cell);
  }));
}

function wrapLines(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width > maxWidth && line) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// A plain printable pass for people added from the dashboard. The full banner
// tickets are made locally with `npm run tickets:render`.
export function ticketCard(attendee: Attendee, eventName: string) {
  const width = 720;
  const qrSize = 520;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  context.font = '700 44px "DM Sans Variable", system-ui, sans-serif';
  const nameLines = wrapLines(context, attendee.name, width - 96).slice(0, 3);
  const height = 120 + nameLines.length * 54 + qrSize + 150;
  canvas.width = width;
  canvas.height = height;

  context.fillStyle = '#23090f';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#f5efdf';
  context.textAlign = 'center';
  context.font = '600 22px "DM Sans Variable", system-ui, sans-serif';
  context.fillStyle = '#e5a1ad';
  context.fillText(eventName.toUpperCase(), width / 2, 70, width - 96);
  context.font = '700 44px "DM Sans Variable", system-ui, sans-serif';
  context.fillStyle = '#ffffff';
  nameLines.forEach((line, index) => context.fillText(line, width / 2, 136 + index * 54));
  const qrTop = 120 + nameLines.length * 54;
  drawQr(context, attendee.token, (width - qrSize) / 2, qrTop, qrSize);
  context.font = '500 26px "DM Sans Variable", system-ui, sans-serif';
  context.fillStyle = '#f5efdf';
  if (attendee.studentId) context.fillText(`ID ${attendee.studentId}`, width / 2, qrTop + qrSize + 60);
  context.font = '500 20px "DM Sans Variable", system-ui, sans-serif';
  context.fillStyle = '#c99aa3';
  context.fillText('MIBC, North South University', width / 2, qrTop + qrSize + 104);
  return canvas;
}

export function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  canvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, 'image/png');
}

export function fileSafe(text: string) {
  return text.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'ticket';
}
