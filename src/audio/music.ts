/**
 * `CSoundPlayer`'s music side — menu music and per-level game music.
 *
 * The original picks a track by trying a set of filename extensions under
 * either a forced soundtrack directory (`ForceSoundTrack`) or the selected
 * theme (`music/<theme>/`), falling back to song 0 when the numbered track is
 * missing. Tracks loop forever until stopped.
 */

/** `KMusicFilenameExtensions` (`texts.cpp`). */
export const KMusicExtensions: readonly string[] = [".s3m", ".xm", ".ogg", ".it", ".mp3"];

export const MENU_MUSIC = "music/menu.ogg";

/**
 * `CSoundPlayer::GetSongFilename` candidate paths (extension order). The caller
 * tries each until one loads.
 */
export function songCandidates(soundtrackDir: string, theme: string, songNumber: number): string[] {
  const no = songNumber >= 0 ? songNumber : 0;
  const base = soundtrackDir.length > 0 ? `${soundtrackDir}/${no}` : `music/${theme}/${no}`;
  return KMusicExtensions.map((ext) => `${base}${ext}`);
}

export type MusicLoader = (path: string) => Promise<AudioBuffer | null>;

/** `CSoundPlayer` music playback (looping `BufferSource`, fades). */
export class MusicPlayer {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private volume = 1;
  private theme = "Default";
  private songCounter = 0;
  private generation = 0;

  /** Uses the same `AudioContext` as the effect player. */
  attach(ctx: AudioContext | null): void {
    this.ctx = ctx;
  }

  get currentTheme(): string {
    return this.theme;
  }

  /** `CSoundPlayer::SetMusicVolume` (clamped 0..1). */
  setMusicVolume(value: number): void {
    this.volume = value < 0 ? 0 : value > 1 ? 1 : value;
    if (this.gain && this.ctx) this.gain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
  }

  /** `CSoundPlayer::SetTheme`. */
  setTheme(theme: string): void {
    this.theme = theme;
  }

  /** `CSoundPlayer::GetSongFilename` — increments the counter when `songNumber == -1`. */
  nextSong(songNumber: number): number {
    if (songNumber !== -1) return songNumber;
    const no = this.songCounter;
    this.songCounter++;
    return no;
  }

  private async loadFirst(candidates: string[], load: MusicLoader): Promise<void> {
    this.stop();
    if (!this.ctx) return;
    const generation = ++this.generation;
    let buffer: AudioBuffer | null = null;
    for (const path of candidates) {
      buffer = await load(path);
      if (this.generation !== generation) return;
      if (buffer) break;
    }
    if (!buffer || !this.ctx) return;
    this.start(buffer);
  }

  private start(buffer: AudioBuffer): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    gain.gain.linearRampToValueAtTime(this.volume, now + 0.3); // KFadeInTime
    source.start();
    this.source = source;
    this.gain = gain;
  }

  /** `CSoundPlayer::StopMusic` (600 ms fade-out). `stop(true)` cuts immediately. */
  stop(immediate = false): void {
    this.generation++;
    const ctx = this.ctx;
    const source = this.source;
    const gain = this.gain;
    this.source = null;
    this.gain = null;
    if (!source) return;
    if (immediate || !ctx || !gain) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
      return;
    }
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.6); // KFadeOutTime
    source.stop(now + 0.6);
  }

  /** `CSoundPlayer::MenuMusic`. */
  menuMusic(load: MusicLoader): Promise<void> {
    this.songCounter = 0;
    return this.loadFirst([MENU_MUSIC], load);
  }

  /** `CSoundPlayer::GameMusic`. */
  gameMusic(soundtrackDir: string, songNumber: number, load: MusicLoader): Promise<void> {
    const no = this.nextSong(songNumber);
    const candidates = songCandidates(soundtrackDir, this.theme, no);
    // Fall back to song 0 when the numbered track is missing.
    if (no !== 0) candidates.push(...songCandidates(soundtrackDir, this.theme, 0));
    return this.loadFirst(candidates, load);
  }
}
