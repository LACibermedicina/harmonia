// Exportação MIDI no navegador (SMF tipo 1) — instantânea, sem servidor.
import { Score } from "./types";
import { audibleLayers } from "./audio";

const vlq = (n: number) => { const o = [n & 0x7f]; while ((n >>= 7)) o.unshift((n & 0x7f) | 0x80); return o; };
const txt = (t: number, s: string) => { const b = [...new TextEncoder().encode(s)]; return [0xff, t, ...vlq(b.length), ...b]; };
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

function track(evs: [number, number, number[]][]) {
  evs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const d: number[] = []; let last = 0;
  for (const [t, , m] of evs) { d.push(...vlq(t - last), ...m); last = t; }
  d.push(0, 0xff, 0x2f, 0);
  return [0x4d, 0x54, 0x72, 0x6b, ...u32(d.length), ...d];
}

export function scoreToMidi(s: Score): Blob {
  const PPQ = 480;
  const us = Math.round(60_000_000 / s.tempo);
  const tracks = [track([
    [0, 0, txt(3, s.title)], [0, 0, [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255]],
    [0, 0, [0xff, 0x58, 4, s.timeSig[0], Math.log2(s.timeSig[1]), 24, 8]], [0, 0, [0xff, 0x59, 2, s.keySig & 255, 0]],
  ])];
  let ch = 0;
  for (const l of audibleLayers(s)) {
    if (!l.notes.length) continue;
    const e: [number, number, number[]][] = [[0, 0, txt(3, l.name)], [0, 0, [0xc0 | ch, l.program || 0]], [0, 0, [0xb0 | ch, 7, Math.round(l.volume * 127)]]];
    for (const n of l.notes) {
      const on = Math.round(n.start * PPQ), off = Math.round((n.start + n.dur) * PPQ);
      if (n.lyric && n.lyric !== "_") e.push([on, 0, txt(5, n.lyric)]);
      e.push([on, 2, [0x90 | ch, n.pitch, n.vel ?? 80]], [off, 1, [0x80 | ch, n.pitch, 0]]);
    }
    tracks.push(track(e));
    ch = (ch + 1) % 16; if (ch === 9) ch = 10;
  }
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, (PPQ >> 8) & 255, PPQ & 255];
  return new Blob([new Uint8Array([...head, ...tracks.flat()])], { type: "audio/midi" });
}
