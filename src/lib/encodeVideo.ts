// Render the recording as MP4 / WebM directly in the browser using
// WebCodecs (Chromium / WebView2) and mediabunny's muxers. We re-use
// the same paint pipeline the Player + Zoom views run with, so the
// exported video is pixel-identical to the on-screen preview.

import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  canEncodeAudio,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
} from "mediabunny";

import { convertFileSrc, FrameThumb, InputEvent } from "./tauri";
import { FrameEdits, getFrameEdits } from "./edits";
import { SpotlightDraft } from "./prefs";
import { drawClicks, drawCursor, drawKeys, drawSpotlight, paintEdit } from "./paintEdits";

export type VideoFormat = "mp4" | "webm";

export interface EncodeOptions {
  thumbs: FrameThumb[];
  excluded: Set<number>;
  trim: { inIdx: number; outIdx: number } | null;
  edits: FrameEdits;
  inputEvents: InputEvent[];
  fps: number;
  format: VideoFormat;
  /** Path to a WAV file with the recording's mic audio. When set the
   *  encoder fetches it, decodes via Web Audio, and muxes it into the
   *  output audio track. `null` for silent recordings or imported GIFs. */
  audioPath?: string | null;
  /** Spotlight vignette. Applied after cursor overlay when enabled and cursor is known. */
  spotlight?: SpotlightDraft | null;
  /** Optional progress hook called with done/total. */
  onProgress?: (done: number, total: number) => void;
}

/** Encode the recording into a self-contained MP4 / WebM byte buffer. */
export async function encodeVideo(opts: EncodeOptions): Promise<Uint8Array> {
  const { thumbs, excluded, trim, edits, inputEvents, fps, format, audioPath, spotlight } =
    opts;

  const playable = thumbs.filter(
    (t) =>
      !excluded.has(t.index) &&
      (trim === null || (t.index >= trim.inIdx && t.index <= trim.outIdx)),
  );
  if (playable.length === 0) {
    throw new Error("Nothing to encode — no frames in the current selection.");
  }

  // Preload all source PNGs as ImageBitmaps so the encode loop stays
  // synchronous w.r.t. paint and we hit no decode latency between
  // VideoEncoder.encode() calls.
  const bitmaps: ImageBitmap[] = await Promise.all(
    playable.map(async (t) => {
      const res = await fetch(convertFileSrc(t.path));
      const blob = await res.blob();
      return await createImageBitmap(blob);
    }),
  );

  const width = bitmaps[0].width;
  const height = bitmaps[0].height;

  // Even dimensions are required by some codecs (notably H.264). Round
  // up to the nearest pair so cropping doesn't lose content.
  const out_w = width % 2 === 0 ? width : width + 1;
  const out_h = height % 2 === 0 ? height : height + 1;

  const canvas = new OffscreenCanvas(out_w, out_h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create OffscreenCanvas 2D context");

  const outputFormat =
    format === "mp4" ? new Mp4OutputFormat() : new WebMOutputFormat();
  const output = new Output({
    format: outputFormat,
    target: new BufferTarget(),
  });

  const source = new CanvasSource(canvas, {
    codec: format === "mp4" ? "avc" : "vp9",
    bitrate: QUALITY_HIGH,
  });
  output.addVideoTrack(source, { frameRate: fps });

  // Decode the recording's WAV ahead of `output.start()` so the audio
  // track is in place before any encoded packets are written. mediabunny
  // requires every track to be added before start. Decoding can fail
  // silently — the export should still produce a (silent) video.
  const baseElapsedMs = playable[0].elapsedMs;
  const lastFrameMs = playable[playable.length - 1].elapsedMs;
  // Reserve audio coverage for the last frame's duration. Without this
  // the audio cuts off slightly before the final video sample.
  const sliceEndMs = lastFrameMs + Math.round(1000 / Math.max(1, fps));

  let audioSource: AudioBufferSource | null = null;
  let audioBufferToAdd: AudioBuffer | null = null;
  if (audioPath) {
    // Fetch + decode the WAV.
    const res = await fetch(convertFileSrc(audioPath));
    if (!res.ok) throw new Error(`Could not fetch audio file: ${res.status}`);
    const buf = await res.arrayBuffer();
    const audioCtx = new AudioContext();
    const decoded = await audioCtx.decodeAudioData(buf);
    const sliced = sliceAudioBuffer(
      audioCtx,
      decoded,
      baseElapsedMs / 1000,
      sliceEndMs / 1000,
    );
    audioCtx.close().catch(() => {});

    // Pick the best available audio codec. MP4 prefers AAC but falls
    // back to Opus if AAC encoding is not supported by this WebView2
    // runtime (common on some Windows configurations). WebM always
    // uses Opus.
    const preferredCodec = format === "mp4" ? "aac" : "opus";
    const fallbackCodec = "opus";
    const audioCodec =
      (await canEncodeAudio(preferredCodec)) ? preferredCodec : fallbackCodec;

    if (!(await canEncodeAudio(audioCodec))) {
      throw new Error(
        `Audio encoding is not supported on this platform for ${format.toUpperCase()}. ` +
          `Try exporting as WebM, which uses Opus audio.`,
      );
    }

    audioSource = new AudioBufferSource({
      codec: audioCodec,
      bitrate: QUALITY_HIGH,
    });
    output.addAudioTrack(audioSource);
    audioBufferToAdd = sliced;
  }

  await output.start();

  // Push the (single) decoded audio buffer in. AudioBufferSource adds it
  // at output time 0; we shift the video timestamps below so they line
  // up with the start of the audio.
  const audioPromise =
    audioSource && audioBufferToAdd
      ? audioSource.add(audioBufferToAdd)
      : Promise.resolve();

  // Walk the playable frames, painting + encoding each. Timestamps
  // are shifted so the first playable frame lands at 0 — keeps audio
  // and video aligned when the user has trimmed the start off.
  const total = playable.length;
  for (let i = 0; i < total; i++) {
    const t = playable[i];
    const bm = bitmaps[i];
    if (out_w !== width || out_h !== height) {
      // Pad with the frame in the top-left, leaving 1-px right/bottom.
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, out_w, out_h);
    }
    ctx.drawImage(bm, 0, 0, width, height);

    const frameEdits = getFrameEdits(edits, t.index);
    for (const e of frameEdits) paintEdit(ctx as unknown as CanvasRenderingContext2D, bm, e);
    if (t.cursor) {
      drawCursor(
        ctx as unknown as CanvasRenderingContext2D,
        t.cursor.x,
        t.cursor.y,
      );
    }
    if (inputEvents.length > 0) {
      drawClicks(
        ctx as unknown as CanvasRenderingContext2D,
        inputEvents,
        t.elapsedMs,
        width,
        height,
      );
      drawKeys(
        ctx as unknown as CanvasRenderingContext2D,
        inputEvents,
        t.elapsedMs,
        width,
        height,
      );
    }
    if (spotlight?.enabled && t.cursor) {
      drawSpotlight(
        ctx as unknown as CanvasRenderingContext2D,
        t.cursor.x,
        t.cursor.y,
        spotlight.radius,
        spotlight.dimOpacity,
      );
    }

    const timestampSec = (t.elapsedMs - baseElapsedMs) / 1000;
    // Duration: distance to the next playable frame, or 1/fps for the
    // last one. Mediabunny snaps to the track frameRate when set.
    const next = playable[i + 1];
    const durationSec = next
      ? Math.max(0.001, (next.elapsedMs - t.elapsedMs) / 1000)
      : 1 / fps;
    await source.add(timestampSec, durationSec);

    opts.onProgress?.(i + 1, total);
  }

  await audioPromise;
  await output.finalize();

  // Free the decoded bitmaps eagerly.
  for (const b of bitmaps) b.close();

  const buf = (output.target as BufferTarget).buffer;
  if (!buf) throw new Error("Encoder finished without producing a buffer");
  return new Uint8Array(buf);
}

/** Cut an AudioBuffer to the [startSec, endSec] range and downmix to
 *  stereo. AAC/Opus encoders reliably accept 1–2 channels; 4+ channels
 *  (common with some Windows audio devices) cause silent failures in
 *  WebCodecs. We average all source channels into 2 output channels. */
function sliceAudioBuffer(
  ctx: AudioContext,
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const startSample = Math.max(0, Math.floor(startSec * sampleRate));
  const endSample = Math.max(
    startSample + 1,
    Math.min(buffer.length, Math.ceil(endSec * sampleRate)),
  );
  const length = endSample - startSample;

  // Cap at stereo — encoders beyond 2ch are unreliable in WebCodecs.
  const srcChannels = buffer.numberOfChannels;
  const outChannels = Math.min(srcChannels, 2);
  const out = ctx.createBuffer(outChannels, length, sampleRate);

  if (srcChannels <= 2) {
    // Fast path: copy as-is.
    for (let ch = 0; ch < outChannels; ch++) {
      const src = buffer.getChannelData(ch);
      const dst = out.getChannelData(ch);
      const available = Math.min(length, src.length - startSample);
      if (available > 0) dst.set(src.subarray(startSample, startSample + available), 0);
    }
  } else {
    // Downmix: average pairs of source channels into each output channel.
    // e.g. 4ch → L_out = avg(ch0, ch2), R_out = avg(ch1, ch3).
    for (let outCh = 0; outCh < outChannels; outCh++) {
      const dst = out.getChannelData(outCh);
      // Collect all source channels that map to this output channel.
      const srcs: Float32Array[] = [];
      for (let srcCh = outCh; srcCh < srcChannels; srcCh += outChannels) {
        srcs.push(buffer.getChannelData(srcCh));
      }
      const scale = 1 / srcs.length;
      for (let i = 0; i < length; i++) {
        let sum = 0;
        for (const src of srcs) sum += src[startSample + i] ?? 0;
        dst[i] = sum * scale;
      }
    }
  }
  return out;
}
