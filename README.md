# ABCurves Continuous Planner: drawing demo and target integration

A compact local demo of the released ABCurves Continuous Planner.
One released planner, its weights, readable runtime code and an optional standard
Renderer. No training code, research candidates, recordings or saved user runs.

## Run

Use **64-bit Python 3.11 or later**, unpack the ZIP, and open a terminal in its folder:

```bash
python -m pip install -r requirements.txt
python demo.py
```

The first run can take longer while Numba compiles the kernels. The server loads,
verifies and warms the model before opening `http://127.0.0.1:8784/`.
It works locally after installing dependencies; it uses no CDN or external service.
Stop it with Ctrl+C. To choose another port or keep the browser closed:

```bash
python demo.py --port 8785 --no-browser
```

Draw a timed target path, or choose a synthetic preset, then **Run planner**.
Playback opens automatically. Four seeded draws share the same target.
Play, pause, scrub and export the result.
The page runs inference first and then plays its recorded samples; browser frames
are display frames, not a 1 kHz hardware scheduler.

The target stays beside the movement views. Click a draw to open a larger
comparison; **All draws** restores the grid and **Close** (or Esc) returns to the
page. **Expand** also opens the whole grid in a larger workspace.
The **− / +** buttons zoom every view together; click the percentage to reset.
Ctrl/Cmd + mouse wheel over a view also zooms. **Overview** keeps the camera fixed;
**Follow target** centers every view on the current target, including while zoomed.
These are viewing controls and never change generated movement. Additional run
statistics and unit guidance are available under **Run details**.

## The three timings are different

| Control / quantity | What it changes |
| --- | --- |
| Target update interval (1, 16, 33 ms, or any 1–100 ms) | How often the demo samples and sends a target observation |
| Output call size (1–100 ms) | How much numerical time each `advance` call requests |
| Output sample interval | Always **1 ms**; a larger call returns every intervening sample |
| Internal planning | A committed **32 ms** action, using the original **128 ms** motor forecast |

New target receipts do not rewrite an action already committed by the model.
Changing output chunk size preserves the seeded stream. Changing target updates
can change behavior because the observations differ. Output arrays have no sleep
or device pacing built in. Load/prewarm before a live clock starts.

Default controls: target observations every 33 ms, 1 ms output calls, one cycle,
2 seconds final hold, four draws with seeds 7/23/101/997, and only changed targets.
The default display/scoring target radius is **35 counts**.
The sample seed changes a stochastic draw; it does **not** choose another model.
The final target continues to apply even when no more observations arrive.
Uncheck "Send only changed targets" to keep reporting stationary observations.

The radius affects the **display and scoring only**. It is not a planner input.
Counts per canvas pixel converts a drawing into model coordinates; it is not a
device DPI or an automatic sensitivity calibration.

## Feed your own targets

The integration boundary is deliberately small:

```python
from abcurves import ContinuousPlanner

movement = ContinuousPlanner(seed=7, initial_xy=(0.0, 0.0))  # load/prewarm once
movement.update_target((120.0, 30.0), timestamp_us=0)
block = movement.advance(1_000)  # first closed 1 ms endpoint

movement.update_target((150.0, 40.0), timestamp_us=33_000)
block = movement.advance(34_000)  # returns ALL remaining endpoints through 34 ms
for time_us, xy in zip(block["time_us"], block["xy"]):
    pass  # hand each absolute position to your application
```

`example_targets.py` exposes `on_target` and `on_tick`, and writes a complete CSV
with positions and deltas. Its default example is synthetic:

```bash
python example_targets.py --targets example_receipts.json --output movement.csv
python example_targets.py --targets your_targets.json --chunk-ms 16 --output movement.csv
python check_install.py
```

Target recordings use this format and can also be imported into the page:

```json
{
  "initial_xy": [0, 0],
  "receipts": [[0, 120, 30], [33000, 150, 40], [1000000, 200, 10]],
  "duration_us": 3000000
}
```

Each row is `[timestamp_us, x, y]`. Imported **exact receipts bypass target
resampling, playback-speed scaling and cycles**; the output chunk and sample seed
still apply. A drawn-path export instead has `path` rows `[time_ms, x, y]` in
common counts and `options`; the demo interpolates that target and samples it at
the selected observation interval. Do not mix milliseconds with microseconds.

For a live stream, use one time origin shared by target receipts and output calls.
Supply a target when the application actually receives it. Receipts must be
nondecreasing and cannot precede already emitted output. Before any target,
the model holds the initial position. Keep the instance alive through movement,
braking, holding and target changes. `reset(seed=7)` deliberately starts a new
stream at time zero. One instance is not thread-safe.

The example and demo may queue a whole **recording** for offline replay; the
runtime hides queued future observations until their stated times. This is not
a prediction interface or permission to expose a future path to a live controller.

## Units and optional human history

Inputs and `xy` outputs are absolute **common angular counts**, X right / Y up.
One common count is `0.0003509487083280618` radians. They are not automatically
screen pixels or native mouse counts. Your application owns its coordinate
mapping. For a constant angular gain `s` radians per native count, convert a
native delta with `native_delta * s / COMMON_RADIANS_PER_COUNT`, including the
appropriate Y convention. Nonlinear/world mappings belong to your application.

The model follows its generated position; it does not observe an externally
corrected cursor. A real handoff can supply 160 chronological 1 ms displacement
samples in `history`, ending at `initial_xy`. `prepare_history` converts 164 genuine
raw common-unit deltas into the selected causal filtered history:

```python
from abcurves import ContinuousPlanner, prepare_history

start = prepare_history(real_common_deltas_164, current_xy=observed_common_xy)
movement = ContinuousPlanner(initial_xy=start.observed_xy, history=start.history)
```

Cold start is the default here. No personal history is bundled or invented.

## Optional integer hardware reports

The standard released global Renderer is included as a component of this same
pipeline, not another planner candidate. In the page's optional Renderer panel,
import **exactly 256 genuine integer `[dx, dy]` reports** from your own setup as a
JSON array, set its angular gain and Y convention, and enable integer reports.
No recorded profile is shipped. With your profile in Python:

```python
from abcurves import ContinuousPipeline, CountTransform

stream = ContinuousPipeline(
    your_256_native_reports,
    transform=CountTransform(your_radians_per_native_count, y_down=True),
    initial_xy=(0.0, 0.0), seed=7, renderer_seed=101,
)
stream.update_target((120.0, 30.0), timestamp_us=0)
block = stream.advance(1_000)
print(block["reports"])      # integer native [dx, dy] for every 1 ms interval
print(block["rendered_xy"])  # accumulated report position in common units
```

Keep this Renderer state across target updates, plans, braking and holds. Do not
recreate it every tick. Its accumulated position is not feedback from the physical
device. Windows x64 has the released library included. On Linux/macOS, the planner
runs directly; build the optional Renderer with a C compiler and CMake:

```bash
cmake -S runtime/c -B runtime/c/build -DCMAKE_BUILD_TYPE=Release
cmake --build runtime/c/build --config Release
```

The bundle includes the public C source needed for that build. A physical output
integration still owns scheduling and device execution.

## What is included

- `demo.py`: validation, drawing-to-receipt conversion, replay and local server.
- `static/`: the drawing/playback page and controls.
- `example_targets.py` / `example_receipts.json`: a small integration example.
- `abcurves/`: the released continuous runtime and Renderer binding.
- `models/`: the complete Continuous Planner bundle and standard Renderer image.
- `runtime/c/`: portable Renderer source; no compiler needed for planner-only use.
- `BUNDLE_MANIFEST.json`: public upstream commit and file hashes.

Numerical runtime modules and model bytes are copied from the public release.
The package entry point, model-directory locator and minimal manifests are
packaging-only adaptations. Default native arithmetic matches that release;
weights are unchanged. ONNX graphs remain included for integrity and an optional
`backend="onnx"` reference (install `onnxruntime` separately if using it).
Source/license: https://github.com/optima-manent/ABCurves (MIT).
