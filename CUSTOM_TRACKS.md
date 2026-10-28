# Simple Genome Browser: Custom Tracks & Data Guide

This reference documents the core architecture of `SimpleGenomeBrowser` (`SGB`) so developers and AI coding agents can create custom tracks (e.g., BAM/SAM alignment tracks, ChIP-seq / RNA-seq coverage tracks, variant tracks, motif tracks) and custom data sources cleanly and reliably.

---

## 1. Core Architecture Overview

- **[`index.js`](index.js)**: Single barrel entry point re-exporting `SimpleGenomeBrowser`, all data classes, standard tracks (`geneTrack`, `seqTrack`, `alignmentTrack`, `quantitativeFeatureTrack`, etc.), convenience tracks, and parsers (`load_genbank`, `load_fasta`, `load_gff`, `parse_alignments`, `load_alignments`, `assign_subtracks`, etc.).
- **[`SimpleGenomeBrowser`](SimpleGenomeBrowser.js)**: Owns the genome sequences (`this.seqs`), circular contig list (`this.circular_contigs`), current contig (`this.contig`), current visible coordinate window (`this.domain = [start, end]`), track list (`this.tracks`), data registry (`this.data`), tooltip (`show_tooltip` / `hide_tooltip`), and sidebar (`show_sidebar` / `hide_sidebar`).
- **[`SGB_data.js`](SGB_data.js)**: Provides data containers (`baseData`, `staticFeatureData`, `staticPointData`, `serverFeatureData`, `serverPointData`) that filter and slice genomic data to the `3 * w` pre-rendered buffer window (`[d0 - span, d1 + span]`) and handle circular contig wrap-around automatically.
- **[`SGB_tracks.js`](SGB_tracks.js)**: Provides `baseTrack` and standard track implementations (`geneTrack`, `seqTrack`, `alignmentTrack`, `quantitativePointTrack`, `quantitativeLineTrack`, `quantitativeFeatureTrack`, `quantitativeYaxesTrack`).
- **[`data_tracks.js`](data_tracks.js)**: Convenience tracks that bundle data loading with a track class (`gffTrack`, `gbTrack`, `geneTableTrack`, `heatmapTrack`).

### The `3 * w` Pre-rendered Buffer Model
To make horizontal dragging and trackpad scrolling instantaneous:
1. The visible viewport has width `sgb.w` pixels (`[0, w]` in visible coordinates, corresponding to `sgb.domain = [d0, d1]`).
2. Each track's container (`this.track_div`) has width `sgb.w` with `overflow: hidden`.
3. Inside `this.track_div`, the SVG (`this.svg`) has width `3 * sgb.w` and is shifted left by `-sgb.w` pixels (`style("left", -sgb.w + "px")`).
4. This means **pixel `x = sgb.w` is the left edge of the visible viewport** (`d0`), and **pixel `x = 2 * sgb.w` is the right edge of the visible viewport** (`d1`).
   - Pixels `[0, sgb.w)` hold the left pre-rendered buffer (`[d0 - span, d0)`).
   - Pixels `[sgb.w, 2 * sgb.w]` hold the currently visible viewport (`[d0, d1]`).
   - Pixels `(2 * sgb.w, 3 * sgb.w]` hold the right pre-rendered buffer (`(d1, d1 + span]`).
5. **Crucial Rule**: Always use `this.sgb.get_coordinate_pixel_position(coord, check_loop)` to convert a genomic coordinate into a pixel `x` in `[0, 3 * sgb.w]`. Never compute `(coord - d0) / span * w` manually.

---

## 2. Coordinate, Pixel & Sequence Helpers on `sgb`

Every track has a reference to the browser instance at `this.sgb`.

| Method / Property | Description |
| :--- | :--- |
| `sgb.w` | Current visible viewport width in pixels (`number`). |
| `sgb.contig` | Currently displayed contig ID (`string`). |
| `sgb.domain` | Current visible 1-based coordinate range `[start, end]`. |
| `sgb.current_seq_len` | Length in bp of `sgb.contig`. |
| `sgb.current_contig_circular` | `boolean` indicating whether `sgb.contig` is circular. |
| `sgb.get_coordinate_pixel_position(coord, check_loop = false)` | Converts a genomic coordinate `coord` into a pixel position in the `3 * w` track space (`[0, 3 * w]`). Set `check_loop = true` when `coord` has already been wrapped into `[1, seq_len]` by a data class and you want circular wrap adjustment relative to `sgb.domain`. |
| `sgb.get_pixel_coordinate(px, wrap = true)` | Inverse of `get_coordinate_pixel_position`: converts a pixel `px` in `[0, 3 * w]` back into a genomic coordinate. If `wrap = true` and the contig is circular, wraps into `[1, current_seq_len]`. |
| `sgb.get_rendered_coordinate_range()` | Returns `[unwrapped_start, unwrapped_end]` for the full `3 * w` pre-rendered buffer (`[d0 - span, d1 + span]` clamped for linear contigs). Ideal for sequence or coverage tracks that iterate across basepairs. |
| `sgb.get_sequence(start, end, contig = sgb.contig, strand = '+')` | Extracts the DNA sequence between 1-based inclusive coordinates `start` and `end`, automatically handling circular wrap-around (when `start > end` or out-of-bounds on circular contigs) and reverse-complementing when `strand === '-'`. |
| `sgb.show_tooltip(event, html)` | Displays the floating HTML tooltip near the cursor (`event` is a DOM mouse event). |
| `sgb.hide_tooltip()` | Hides the floating tooltip. |
| `sgb.show_sidebar(html, width = 380)` | Opens the sticky right-hand sidebar. Pass an HTML string to populate `sgb.sidebar_div`, or pass `null` if you populated `sgb.sidebar_div` directly using D3. |
| `sgb.display_feature(contig, start, end, pad = null)` | Navigates the browser to a genomic feature with surrounding padding. |

---

## 3. SVG vs. Canvas Rendering in `baseTrack`

When a subclass extends `baseTrack`:
- **`this.g`** (`<g class="track_g">` inside `this.svg`): Shifts horizontally as the user drags or scrolls. Draw genomic features (genes, reads, peaks, bars, points) inside `this.g` at `x = this.sgb.get_coordinate_pixel_position(...)`.
- **`this.static_g`** (`<g class="track_static_g">` inside `this.svg`): Does **not** shift during horizontal drag/scroll. Since `this.svg` is positioned at `left: -sgb.w px`, the visible viewport inside `this.static_g` spans `x` in `[sgb.w, 2 * sgb.w]`. Use `this.static_g` for y-axes, scale bars, or pinned labels.
- **`this.init_canvas(height = this.track_h)`**: Creates/resizes `this.canvas` (D3 selection) and `this.ctx` (2D Canvas context) spanning `3 * sgb.w` by `height` at `left: 0px` inside `this.svg_Check_div` (so `x` coordinates in `this.ctx` match `get_coordinate_pixel_position` directly). During horizontal drag/scroll, `sgb` automatically shifts `this.canvas` in sync with `this.g`, and `baseTrack.display_region()` resets its position before calling `this.render()`.
- **CSS Units Note**: Always include `'px'` units when setting numeric CSS styles via D3 (`.style('height', h + 'px')`, `.style('left', x + 'px')`) so tracks work in HTML5 Standards Mode (`<!DOCTYPE html>`).

---

## 4. Data Classes (`SGB_data.js`)

Tracks can either:
1. Share a data source registered via `sgb.add_data(data_name, data_obj)` (by passing `config.data_name = data_name`), **or**
2. Attach their own data instance to `this.data` (or pass `sgb.add_track(track, data_obj)`), which `sgb.add_track()` automatically wires and registers.

### Built-in Data Classes
- **`staticFeatureData(data, contig_col, start_col, end_col)`**: Client-side interval data (array of objects or Arquero table). Handles intervals that span the circular origin (`start > end`).
- **`staticPointData(data, contig_col, pos_col)`**: Client-side single-coordinate data.
- **`serverFeatureData(url, name, contig_col, start_col, end_col, id_col)`**: Fetches interval data on demand via `POST` to `url`. Collects both `track.column` (string) and `track.columns` (array of strings) across all attached tracks.
- **`serverPointData(url, name, contig_col, pos_col)`**: Fetches point data on demand via `POST` to `url`.

Inside your track's `render()` method:
- Call **`this.get_rows()`** (or `this.data.get_rows()`) to get an array of plain JavaScript row objects for the current `3 * w` window, or access `this.data.filt_data` for the filtered Arquero table.

---

## 5. Template 1: Custom SVG Track (e.g., Peak / Coverage / Motif Track)

```javascript
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { baseTrack } from "./SGB_tracks.js";

export class customPeakTrack extends baseTrack {
  constructor(sgb, name, config, data) {
    super(sgb, name, config);
    this.data = data; // staticFeatureData or staticPointData instance
    this.value_col = config.value_col || "score";
    this.color = config.color || "#2b7bba";
    this.y_scale = d3.scaleLinear()
      .domain(config.y_domain || [0, 100])
      .range([this.track_h - 4, 4])
      .clamp(true);
  }

  render() {
    const self = this;
    const rows = this.get_rows();

    this.g.selectAll(".peak_rect")
      .data(rows)
      .enter()
      .append("rect")
      .attr("class", "peak_rect")
      .attr("x", d => self.sgb.get_coordinate_pixel_position(d.start))
      .attr("width", d => {
        const x1 = self.sgb.get_coordinate_pixel_position(d.start);
        const x2 = self.sgb.get_coordinate_pixel_position(d.end);
        return Math.max(2, x2 - x1);
      })
      .attr("y", d => self.y_scale(d[self.value_col]))
      .attr("height", d => Math.max(1, (self.track_h - 4) - self.y_scale(d[self.value_col])))
      .attr("fill", self.color)
      .on("mouseover", (event, d) => {
        self.sgb.show_tooltip(
          event,
          `<strong>${d.name || "Peak"}</strong><br>${d.start}..${d.end}<br>Score: ${d[self.value_col]}`
        );
      })
      .on("mouseout", () => self.sgb.hide_tooltip())
      .on("click", (event, d) => {
        self.sgb.show_sidebar(`<h3>${d.name || "Peak"}</h3><p>Score: ${d[self.value_col]}</p>`);
      });
  }
}
```

---

## 6. Template 2: High-Density Canvas Track (e.g., Pileup / Read Alignment / Base-Resolution Signal)

When rendering thousands of reads or per-basepair signals, use `this.init_canvas()` for fast HTML5 Canvas rendering and `d3.pointer(event, this.svg.node())` with `this.sgb.get_pixel_coordinate(px)` for hover tooltips:

```javascript
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { baseTrack } from "./SGB_tracks.js";

export class customCanvasSignalTrack extends baseTrack {
  constructor(sgb, name, config, data) {
    super(sgb, name, config);
    this.data = data;
    this.init_canvas(this.track_h);
  }

  render() {
    const self = this;
    const display_w = this.sgb.w * 3;

    // Resize and clear the 3*w canvas
    this.init_canvas(this.track_h);
    const ctx = this.ctx;

    const rows = this.get_rows();
    ctx.fillStyle = "#1f77b4";

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const x1 = Math.floor(this.sgb.get_coordinate_pixel_position(r.start, true));
      const x2 = Math.ceil(this.sgb.get_coordinate_pixel_position(r.end, true));
      const w = Math.max(1, x2 - x1);
      const h = Math.max(2, Math.min(this.track_h - 2, r.value * 2));
      ctx.fillRect(x1, this.track_h - h, w, h);
    }

    // Optional: transparent SVG overlay in this.g for hover / click interaction
    this.g.append("rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", display_w)
      .attr("height", this.track_h)
      .style("fill", "transparent")
      .style("pointer-events", "all")
      .on("mousemove", (event) => {
        const [mouseX] = d3.pointer(event, self.svg.node());
        const coord = Math.round(self.sgb.get_pixel_coordinate(mouseX));
        self.sgb.show_tooltip(event, `Position: ${coord.toLocaleString()} bp`);
      })
      .on("mouseleave", () => self.sgb.hide_tooltip());
  }
}
```
