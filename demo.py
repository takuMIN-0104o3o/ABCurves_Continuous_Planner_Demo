"""Run the local ABCurves Continuous Planner demo: python demo.py.

The only model input is a timestamped target receipt. The browser describes a
test target; it does not supply a prepacked future target history to the model.
The released runtime itself enforces when queued receipts become observable.
"""
from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import threading
import time
import webbrowser
from urllib.parse import parse_qs

# A standalone process can set these before importing any numeric library.
# Hosting applications should make their own thread-policy decision.
for _name in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    os.environ[_name] = "1"

import numpy as np
from abcurves import ContinuousPlanner, ContinuousPipeline, CountTransform
from abcurves.continuous import COMMON_RADIANS_PER_COUNT

ROOT = Path(__file__).resolve().parent
MAX_DURATION_US = 60_000_000
DEFAULTS = dict(update_ms=33, output_ms=1, speed=1.0, cycles=1,
                hold_ms=2000, seed=7, draws=4, radius=35.0,
                only_changed=True, render=False,
                radians_per_count=COMMON_RADIANS_PER_COUNT, y_down=True)
DRAW_OFFSETS = (0, 16, 94, 990)


def number(value, name, low, high):
    if (isinstance(value, bool) or not isinstance(value, (int, float))
            or not math.isfinite(value) or not low <= value <= high):
        raise ValueError(f"{name} must be a finite number in [{low}, {high}]")
    return float(value)


def integer(value, name, low, high):
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ValueError(f"{name} must be an integer in [{low}, {high}]")
    return value


def pair(value, name):
    point = np.asarray(value, dtype=np.float64)
    if point.shape != (2,) or not np.isfinite(point).all() or np.max(np.abs(point)) > 1e6:
        raise ValueError(f"{name} must be a finite [x, y] pair in common counts")
    return point


def target_schedule(request):
    """Convert a demo path OR an exact receipt recording to a test schedule.

    Path knots are [time_ms, x, y] in common counts. Interpolation here describes
    the simulated target, not the planner's knowledge. Exact receipts are
    [timestamp_us, x, y]; they bypass resampling, speed and repeat controls.
    """
    if not isinstance(request, dict):
        raise ValueError("Supply a JSON object")
    if set(request) - {"schema", "path", "receipts", "duration_us", "initial_xy", "options", "profile"}:
        raise ValueError("Unknown scenario field")
    if ("path" in request) == ("receipts" in request):
        raise ValueError("Supply either 'path' or 'receipts', never both")
    supplied = request.get("options", {})
    if not isinstance(supplied, dict) or set(supplied) - set(DEFAULTS):
        raise ValueError("Unknown demo option")
    options = DEFAULTS | supplied
    for key, low, high in (("update_ms", 1, 100), ("output_ms", 1, 100),
                          ("cycles", 1, 10), ("hold_ms", 0, 30000),
                          ("seed", 0, 2_147_480_000), ("draws", 1, 4)):
        options[key] = integer(options[key], key, low, high)
    options["speed"] = number(options["speed"], "speed", 0.1, 8)
    options["radius"] = number(options["radius"], "radius", 0.1, 500)
    options["radians_per_count"] = number(options["radians_per_count"], "radians_per_count", 1e-7, 0.1)
    for key in ("only_changed", "render", "y_down"):
        if not isinstance(options[key], bool):
            raise ValueError(f"{key} must be true or false")
    initial = pair(request.get("initial_xy", [0, 0]), "initial_xy")

    if "path" in request:
        path = np.asarray(request["path"], dtype=np.float64)
        if (path.ndim != 2 or path.shape[1] != 3 or not 2 <= len(path) <= 30000
                or not np.isfinite(path).all() or np.max(np.abs(path[:, 1:])) > 1e6):
            raise ValueError("path must contain 2–30000 finite [time_ms, x, y] knots")
        if path[0, 0] != 0 or np.any(np.diff(path[:, 0]) <= 0) or not 1 <= path[-1, 0] <= 30000:
            raise ValueError("Path times must increase from 0 and end within 30000 ms")
        cycle_ms = math.ceil(path[-1, 0] / options["speed"])
        active_ms = cycle_ms * options["cycles"]
        duration_us = (active_ms + options["hold_ms"]) * 1000
        if duration_us > MAX_DURATION_US:
            raise ValueError("Limit the complete demo to 60 seconds")
        clock_ms = np.arange(duration_us // 1000 + 1)
        phase = (clock_ms % cycle_ms) * options["speed"]
        phase[clock_ms >= active_ms] = path[-1, 0]
        target = np.column_stack([np.interp(phase, path[:, 0], path[:, axis]) for axis in (1, 2)])
        # Always receive the actual final target, even off the chosen cadence.
        ticks = np.unique(np.r_[np.arange(0, len(clock_ms), options["update_ms"]), active_ms])
        receipts = []
        previous = None
        for tick in ticks:
            xy = target[tick]
            if options["only_changed"] and previous is not None and np.array_equal(xy, previous):
                continue
            receipts.append((int(tick) * 1000, xy.copy()))
            previous = xy.copy()
        mode = "drawn path: sampled target observations"
    else:
        rows = request["receipts"]
        if not isinstance(rows, list) or not 1 <= len(rows) <= 60001:
            raise ValueError("receipts must contain 1–60001 [timestamp_us, x, y] rows")
        receipts = []
        previous_time = -1
        for row in rows:
            if not isinstance(row, list) or len(row) != 3:
                raise ValueError("Each receipt must be [timestamp_us, x, y]")
            at = integer(row[0], "timestamp_us", 0, MAX_DURATION_US)
            if at < previous_time:
                raise ValueError("Receipt timestamps must be nondecreasing")
            receipts.append((at, pair(row[1:], "target")))
            previous_time = at
        duration_us = integer(request.get("duration_us", receipts[-1][0] + options["hold_ms"] * 1000),
                              "duration_us", 1000, MAX_DURATION_US)
        if receipts[-1][0] > duration_us:
            raise ValueError("duration_us must include the last receipt")
        clock_us = np.arange(duration_us // 1000 + 1) * 1000
        indices = np.searchsorted([t for t, _ in receipts], clock_us, side="right") - 1
        target = np.repeat(initial[None], len(clock_us), axis=0)
        known = indices >= 0
        target[known] = np.array([xy for _, xy in receipts])[indices[known]]
        active_ms = receipts[-1][0] / 1000
        mode = "exact receipts: no resampling"
    return options, initial, receipts, target, duration_us, active_ms, mode


def replay(stream, receipts, duration_us, *, output_ms=1):
    """Replay a recorded/simulated schedule, retaining every 1 ms endpoint.

    Queuing future receipts is ONLY for offline replay. The runtime hides them
    until their timestamps. A live app calls update_target when it actually
    receives a target; see example_targets.py for that integration boundary.
    output_ms changes call/chunk size, not model cadence or sampling frequency.
    """
    for timestamp_us, xy in receipts:
        stream.update_target(xy, timestamp_us=timestamp_us)
    for end_us in range(output_ms * 1000, duration_us, output_ms * 1000):
        yield stream.advance(end_us)
    yield stream.advance(duration_us)


class DemoEngine:
    def __init__(self):
        self.movement = ContinuousPlanner(seed=7)  # load, verify and prewarm once
        self.lock = threading.Lock()

    def run(self, request):
        options, initial, receipts, target, duration_us, active_ms, mode = target_schedule(request)
        with self.lock:  # One instance owns one stream and is not thread-safe.
            if options["render"]:
                if "profile" not in request:
                    raise ValueError("Integer reports require your own 256-report profile JSON")
                stream = ContinuousPipeline(
                    request["profile"],
                    transform=CountTransform(options["radians_per_count"], y_down=options["y_down"]),
                    seed=options["seed"], initial_xy=initial)
            else:
                stream = self.movement
            results = []
            total_start = time.perf_counter()
            for draw in range(options["draws"]):
                seed = options["seed"] + DRAW_OFFSETS[draw]
                if options["render"]:
                    stream.reset(seed=seed, renderer_seed=seed, initial_xy=initial)
                else:
                    stream.reset(seed=seed, initial_xy=initial)
                outputs, timings = [], []
                iterator = iter(replay(stream, receipts, duration_us, output_ms=options["output_ms"]))
                while True:
                    start = time.perf_counter_ns()
                    try:
                        block = next(iterator)
                    except StopIteration:
                        break
                    timings.append((time.perf_counter_ns() - start) / 1000)
                    outputs.append(block)
                xy = np.vstack([initial[None]] + [b["xy"] for b in outputs])
                times = np.r_[0, np.concatenate([b["time_us"] for b in outputs])]
                movement = stream.movement if options["render"] else stream
                error = np.linalg.norm(xy - target, axis=1)
                row = dict(seed=seed, xy=xy.tolist(),
                           mean_error=float(error[1:].mean()), final_error=float(error[-1]),
                           within_radius_fraction=float(np.mean(error[1:] <= options["radius"])),
                           output_samples=len(xy) - 1, calls=len(outputs),
                           fresh_plans=movement.fresh_decisions,
                           call_us_median=float(np.median(timings)), call_us_max=float(max(timings)))
                if options["render"]:
                    row["reports"] = np.concatenate([b["reports"] for b in outputs]).tolist()
                    row["rendered_xy"] = np.vstack([initial[None]] + [b["rendered_xy"] for b in outputs]).tolist()
                results.append(row)
            return dict(schema="abcurves.demo_result.v1", model="Continuous Planner", options=options,
                        mode=mode, time_us=times.tolist(), target_xy=target.tolist(),
                        receipts=[[t, *map(float, xy)] for t, xy in receipts],
                        duration_us=duration_us, active_ms=active_ms, draws=results,
                        compute_seconds=time.perf_counter() - total_start)


def serve(port, *, open_browser=True):
    print("Loading and warming the released Continuous Planner. First use may compile kernels...", flush=True)
    engine = DemoEngine()
    static = {"/": ("index.html", "text/html; charset=utf-8"),
              "/app.js": ("app.js", "text/javascript; charset=utf-8"),
              "/style.css": ("style.css", "text/css; charset=utf-8")}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def send_bytes(self, status, body, content_type="application/json; charset=utf-8", filename=None):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            if filename:
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.end_headers()
            self.wfile.write(body)

        def send_json(self, status, value):
            self.send_bytes(status, json.dumps(value, allow_nan=False, separators=(",", ":")).encode())

        def do_GET(self):
            route = self.path.split("?", 1)[0]
            if route in static:
                name, content_type = static[route]
                self.send_bytes(200, (ROOT / "static" / name).read_bytes(), content_type)
            elif route == "/api/info":
                self.send_json(200, dict(model="Continuous Planner", release="2.0.0", sample_ms=1,
                                         decision_ms=32, forecast_ms=128, defaults=DEFAULTS,
                                         common_radians_per_count=COMMON_RADIANS_PER_COUNT))
            else:
                self.send_json(404, dict(error="Not found"))

        def do_POST(self):
            if self.path not in ("/api/run", "/api/export"):
                self.send_json(404, dict(error="Not found"))
                return
            origin = self.headers.get("Origin")
            if origin and origin not in {f"http://127.0.0.1:{port}", f"http://localhost:{port}"}:
                self.send_json(403, dict(error="Use this demo from its local page"))
                return
            try:
                size = int(self.headers.get("Content-Length", 0))
                limit = 64_000_000 if self.path == "/api/export" else 8_000_000
                if not 0 < size <= limit:
                    raise ValueError("Request is too large")
                def reject_constant(value):
                    raise ValueError(f"Nonfinite JSON number: {value}")
                body = self.rfile.read(size)
                if self.path == "/api/export":
                    fields = parse_qs(body.decode("utf-8"), strict_parsing=True)
                    filename = fields.get("filename", [""])[0]
                    if filename not in ("abcurves_targets.json", "abcurves_continuous_result.json"):
                        raise ValueError("Unknown export filename")
                    data = json.loads(fields.get("data", [""])[0], parse_constant=reject_constant)
                    encoded = json.dumps(data, allow_nan=False, separators=(",", ":")).encode()
                    self.send_bytes(200, encoded, filename=filename)
                    return
                request = json.loads(body, parse_constant=reject_constant)
                result = engine.run(request)
                self.send_json(200, result)
            except (ValueError, TypeError, OverflowError) as exc:
                self.send_json(400, dict(error=str(exc)))
            except Exception as exc:
                print(f"Run failed: {type(exc).__name__}: {exc}", flush=True)
                self.send_json(500, dict(error="Run failed. See the local terminal for details."))

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    url = f"http://127.0.0.1:{port}/"
    print(f"Ready: {url}   Stop with Ctrl+C.", flush=True)
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8784)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("port must be in 1..65535")
    serve(args.port, open_browser=not args.no_browser)
