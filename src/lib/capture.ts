/**
 * Screen capture for step screenshots. The stream is shown in a hidden <video>, and a JPEG is grabbed from it
 * whenever a stretch of speech ends. JPEG keeps shared guides small and is a format Gemini Nano accepts.
 */
export class ScreenGrabber {
  private stream?: MediaStream;
  private video = document.createElement("video");
  onEnded?: () => void;

  get active() {
    return !!this.stream?.active;
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = this.stream;
    await this.video.play();
    this.stream.getVideoTracks()[0].addEventListener("ended", () => this.onEnded?.());
  }

  /** The current frame as a JPEG data URL, at most `maxWidth` wide. */
  grab(maxWidth = 1280, quality = 0.72): string | undefined {
    const v = this.video;
    if (!this.active || !v.videoWidth) return undefined;
    const scale = Math.min(1, maxWidth / v.videoWidth);
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality);
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
  }
}

/** A smaller copy of a screenshot, for sending to a model or into a shared link. */
export async function shrink(dataUrl: string, maxWidth: number, quality = 0.7): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const scale = Math.min(1, maxWidth / img.naturalWidth);
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}
