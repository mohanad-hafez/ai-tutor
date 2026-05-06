"""
Long-lived Manim render worker.

Reads one JSON command per line on stdin and writes one JSON result per line on
stdout. Imports manim once at startup so subsequent renders skip the ~3-5s cold
start that the `manim` CLI pays each invocation.

Protocol:
  command:  {"action": "render", "scene_path": "...", "media_dir": "...", "output_file": "lesson.mp4"}
  result:   {"status": "done", "video_path": "/abs/path.mp4"}
            {"status": "error", "message": "..."}
            {"status": "ready"}  (sent once after warmup)
"""
import json
import sys
import os
import importlib.util
import traceback
import glob
import uuid
import io
import contextlib

# Pre-import manim so subsequent renders skip the cold start.
from manim import config, tempconfig  # noqa: F401
import manim  # noqa: F401

try:
    import manim_voiceover  # noqa: F401
except ImportError:
    pass


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def find_mp4(media_dir, prefer_name=None):
    if prefer_name:
        for path in glob.iglob(os.path.join(media_dir, "**", prefer_name), recursive=True):
            return path
    for path in glob.iglob(os.path.join(media_dir, "**", "*.mp4"), recursive=True):
        return path
    return None


def render_scene(scene_path, media_dir, output_file):
    if not os.path.isfile(scene_path):
        return {"status": "error", "message": f"scene file not found: {scene_path}"}

    mod_name = f"scene_{uuid.uuid4().hex[:12]}"
    spec = importlib.util.spec_from_file_location(mod_name, scene_path)
    if spec is None or spec.loader is None:
        return {"status": "error", "message": "failed to load scene module"}
    mod = importlib.util.module_from_spec(spec)

    # Capture noisy manim output so we don't pollute the JSON pipe.
    captured = io.StringIO()

    try:
        with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
            spec.loader.exec_module(mod)
            scene_cls = getattr(mod, "Lesson", None)
            if scene_cls is None:
                return {"status": "error", "message": "Scene class 'Lesson' not found"}

            with tempconfig({
                "media_dir": media_dir,
                "output_file": output_file,
                "quality": "low_quality",
                "disable_caching": True,
                "verbosity": "ERROR",
                "write_to_movie": True,
            }):
                scene = scene_cls()
                scene.render()
    except Exception as e:
        tb = traceback.format_exc()
        msg = f"{e}\n\nWorker captured output:\n{captured.getvalue()[-4000:]}\n\nTraceback:\n{tb}"
        return {"status": "error", "message": msg[-6000:]}

    found = find_mp4(media_dir, prefer_name=output_file)
    if not found:
        return {"status": "error", "message": "render finished but no mp4 produced. Output: " + captured.getvalue()[-2000:]}
    return {"status": "done", "video_path": found}


def main():
    emit({"status": "ready"})
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except Exception as e:
            emit({"status": "error", "message": f"bad JSON: {e}"})
            continue

        action = cmd.get("action")
        if action == "render":
            try:
                result = render_scene(
                    cmd["scene_path"],
                    cmd["media_dir"],
                    cmd.get("output_file", "lesson.mp4"),
                )
            except Exception as e:
                result = {"status": "error", "message": f"worker exception: {e}\n{traceback.format_exc()}"}
            emit(result)
        elif action == "ping":
            emit({"status": "pong"})
        elif action == "shutdown":
            emit({"status": "bye"})
            return
        else:
            emit({"status": "error", "message": f"unknown action: {action}"})


if __name__ == "__main__":
    main()
