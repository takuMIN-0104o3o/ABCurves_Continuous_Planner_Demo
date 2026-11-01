"""Minimal target integration and an exact recorded-receipt replay.

python example_targets.py --targets example_receipts.json --output movement.csv
Read on_target/on_tick first: these are the complete live integration boundary.
"""
from __future__ import annotations
import argparse
import csv
import json
from itertools import chain
import os
from pathlib import Path

for name in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    os.environ[name] = "1"

from abcurves import ContinuousPlanner


def on_target(movement, x, y, elapsed_us):
    """Call at receipt time; x right/y up, in common angular counts."""
    movement.update_target((x, y), timestamp_us=elapsed_us)


def on_tick(movement, elapsed_us):
    """Returns EVERY newly closed 1 ms endpoint; never drop rows of a chunk.

    xy is absolute position. If your output layer needs deltas, subtract the
    previous absolute position, including across call boundaries. The library
    computes samples; your application owns wall-clock pacing and execution.
    """
    block = movement.advance(elapsed_us)
    for timestamp_us, (x, y) in zip(block["time_us"], block["xy"]):
        yield int(timestamp_us), float(x), float(y)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--targets", type=Path, default=Path(__file__).with_name("example_receipts.json"))
    parser.add_argument("--output", type=Path, default=Path("movement.csv"))
    parser.add_argument("--chunk-ms", type=int, default=1)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()
    if not 1 <= args.chunk_ms <= 100:
        parser.error("chunk-ms must be in 1..100")
    data = json.loads(args.targets.read_text(encoding="utf-8"))
    duration_us = data["duration_us"]
    if isinstance(duration_us, bool) or not isinstance(duration_us, int) or duration_us < 1000:
        parser.error("duration_us must be an integer of at least 1000")
    movement = ContinuousPlanner(seed=args.seed, initial_xy=data.get("initial_xy", (0., 0.)))
    # This is a RECORDED replay. Queue the recording, not a live prediction.
    # Queued future receipts remain hidden from the model until their timestamps.
    previous_time = -1
    for timestamp_us, x, y in data["receipts"]:
        if timestamp_us < previous_time or timestamp_us > duration_us:
            parser.error("Receipt times must be nondecreasing and within duration_us")
        on_target(movement, x, y, timestamp_us)
        previous_time = timestamp_us
    with args.output.open("w", newline="", encoding="utf-8") as output:
        writer = csv.writer(output)
        writer.writerow(("timestamp_us", "x_common", "y_common", "dx_common", "dy_common"))
        previous = tuple(data.get("initial_xy", (0., 0.)))
        ends = range(args.chunk_ms * 1000, duration_us, args.chunk_ms * 1000)
        emitted = 0
        for end in chain(ends, (duration_us,)):
            for timestamp_us, x, y in on_tick(movement, end):
                writer.writerow((timestamp_us, x, y, x - previous[0], y - previous[1]))
                previous = x, y
                emitted += 1
    print(f"Wrote {emitted} 1 ms samples to {args.output.name}; {movement.fresh_decisions} fresh plans.")


if __name__ == "__main__":
    main()
