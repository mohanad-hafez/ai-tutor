import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import readline from 'readline';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const WORKER_SCRIPT = path.join(REPO_ROOT, 'server', 'manim_worker.py');

interface RenderRequest {
  scenePath: string;
  mediaDir: string;
  outputFile: string;
  resolve: (r: { videoPath: string | null; stderr: string }) => void;
  // backref so callers can SIGTERM if user cancels
  registerProcess?: (proc: ChildProcessWithoutNullStreams) => void;
}

class ManimWorker {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private rl: readline.Interface | null = null;
  private ready = false;
  private starting: Promise<void> | null = null;
  private queue: RenderRequest[] = [];
  private current: RenderRequest | null = null;
  private disabled = false;

  private async ensureReady(): Promise<void> {
    if (this.ready) return;
    if (this.starting) return this.starting;
    this.starting = this.start();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.proc = spawn('python3', ['-u', WORKER_SCRIPT], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        this.disabled = true;
        reject(err);
        return;
      }
      const proc = this.proc;
      proc.on('error', (err) => {
        this.handleDeath(`worker spawn error: ${err.message}`);
      });
      proc.on('exit', (code) => {
        this.handleDeath(`worker exited (code ${code})`);
      });
      this.rl = readline.createInterface({ input: proc.stdout });
      this.rl.on('line', (line) => this.onLine(line, resolve));
      // Time out warmup — if worker doesn't say "ready" within 30s, give up.
      const t = setTimeout(() => {
        if (!this.ready) {
          this.disabled = true;
          this.kill();
          reject(new Error('manim worker warmup timeout'));
        }
      }, 30_000);
      proc.stderr.on('data', () => { /* ignored — we use stdout for protocol */ });
      const onReady = () => clearTimeout(t);
      this.onReadyOnce = () => { onReady(); resolve(); };
    });
  }

  private onReadyOnce: (() => void) | null = null;

  private onLine(line: string, resolveStart: () => void) {
    if (!line.trim()) return;
    let msg: { status?: string; video_path?: string; message?: string };
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.status === 'ready') {
      this.ready = true;
      if (this.onReadyOnce) { this.onReadyOnce(); this.onReadyOnce = null; }
      else resolveStart();
      this.pump();
      return;
    }
    if (!this.current) return;
    const cur = this.current;
    this.current = null;
    if (msg.status === 'done' && msg.video_path) {
      cur.resolve({ videoPath: msg.video_path, stderr: '' });
    } else {
      cur.resolve({ videoPath: null, stderr: msg.message || 'worker error' });
    }
    this.pump();
  }

  private handleDeath(reason: string) {
    this.ready = false;
    if (this.current) {
      this.current.resolve({ videoPath: null, stderr: reason });
      this.current = null;
    }
    while (this.queue.length) {
      const q = this.queue.shift()!;
      q.resolve({ videoPath: null, stderr: reason });
    }
    this.proc = null;
    this.rl = null;
  }

  private pump() {
    if (!this.ready || this.current || !this.proc) return;
    const next = this.queue.shift();
    if (!next) return;
    this.current = next;
    next.registerProcess?.(this.proc);
    const cmd = JSON.stringify({
      action: 'render',
      scene_path: next.scenePath,
      media_dir: next.mediaDir,
      output_file: next.outputFile,
    }) + '\n';
    this.proc.stdin.write(cmd);
  }

  async render(scenePath: string, mediaDir: string, outputFile: string, registerProcess?: (p: ChildProcessWithoutNullStreams) => void) {
    if (this.disabled) {
      return { videoPath: null as string | null, stderr: 'manim worker disabled' };
    }
    try {
      await this.ensureReady();
    } catch (err) {
      return { videoPath: null as string | null, stderr: `worker unavailable: ${(err as Error).message}` };
    }
    return new Promise<{ videoPath: string | null; stderr: string }>((resolve) => {
      this.queue.push({ scenePath, mediaDir, outputFile, resolve, registerProcess });
      this.pump();
    });
  }

  kill() {
    try { this.proc?.kill('SIGTERM'); } catch { /* ignore */ }
    this.proc = null;
    this.ready = false;
  }
}

export const manimWorker = new ManimWorker();

process.on('exit', () => manimWorker.kill());
process.on('SIGINT', () => { manimWorker.kill(); process.exit(0); });
process.on('SIGTERM', () => { manimWorker.kill(); process.exit(0); });
