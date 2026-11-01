"""Small standalone integration check, without training data or a browser."""
from __future__ import annotations
import os
for name in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    os.environ[name] = "1"
import numpy as np
from abcurves import ContinuousPlanner


def main():
    movement = ContinuousPlanner(seed=7)
    def run(chunk_ms, cadence_ms):
        movement.reset(seed=7)
        for t in range(0, 1001, cadence_ms):
            movement.update_target((120 + 0.06 * t, 25 + 0.025 * t), timestamp_us=t * 1000)
        blocks = [movement.advance(t) for t in range(chunk_ms * 1000, 1_300_000, chunk_ms * 1000)]
        blocks.append(movement.advance(1_300_000))
        return np.concatenate([b["time_us"] for b in blocks]), np.concatenate([b["xy"] for b in blocks])
    for cadence in (1, 16, 33):
        times, one = run(1, cadence)
        other_times, other = run(17, cadence)
        assert np.array_equal(times, np.arange(1000, 1_300_001, 1000))
        assert np.array_equal(times, other_times) and np.array_equal(one, other)
        assert np.isfinite(one).all()
        print(f"PASS: {cadence} ms target observations; identical 1/17 ms output chunks; 1300 finite samples")
    movement.reset(seed=7)
    movement.update_target((100, 30), timestamp_us=5000)
    assert np.array_equal(movement.advance(4000)["xy"], np.zeros((4, 2)))
    print("PASS: queued future target stays hidden until receipt time")


if __name__ == "__main__":
    main()
