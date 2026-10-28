import * as aq from 'https://cdn.jsdelivr.net/npm/arquero@8.0.3/+esm';
import { parquetRead, asyncBufferFromUrl, parquetMetadataAsync } from "https://cdn.jsdelivr.net/npm/hyparquet@1.31.5/+esm";
import { compressors } from "https://cdn.jsdelivr.net/npm/hyparquet-compressors@1.1.2/+esm";
import { fetch_server_data } from "./util.js";

function bisect_left(arr, val, lo = 0, hi = arr.length) {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < val) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function bisect_right(arr, val, lo = 0, hi = arr.length) {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] <= val) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}


class baseData {
  /**
   * Base class for all data types in the Simple Genome Browser.
   *
   * @param {SimpleGenomeBrowser} sgb - The SimpleGenomeBrowser instance this data belongs to.
   * @param {string} name - The name of the dataset.
   *
   * Subclasses implement `update_data()`, which updates `this.filt_data` (an Arquero Table)
   * using region state from `this.sgb`:
   *   contig, contig_len, domain, expanded_domain, circular, expanded_domain_includes_zero
   */
  constructor(sgb, name) {
    this.sgb = sgb;
    this.name = name;
    this.loaded = false;
    this.filt_data = aq.table({});
    this.sgb.data[name] = this;
  }

  set_table(data) {
    if (!data) {
      this.data = null;
      this.contig_filt = null;
      return;
    }
    this.data = Array.isArray(data) ? aq.from(data) : data;
  }

  get_rows() {
    if (!this.filt_data) return [];
    if (typeof this.filt_data.objects === 'function') {
      return this.filt_data.objects();
    }
    return Array.isArray(this.filt_data) ? this.filt_data : [];
  }

  collect_track_columns(base_columns = []) {
    const col_map = new Map();
    for (const c of base_columns) {
      col_map.set(c.name, c);
    }
    if (this.name in this.sgb.data_map) {
      for (const track_name of this.sgb.data_map[this.name]) {
        const track = this.sgb.tracks[track_name];
        if (!track) continue;
        if (track.column && !col_map.has(track.column)) {
          col_map.set(track.column, { name: track.column, dtype: 'float' });
        }
        if (Array.isArray(track.columns)) {
          for (const col_spec of track.columns) {
            if (typeof col_spec === 'string') {
              if (!col_map.has(col_spec)) {
                col_map.set(col_spec, { name: col_spec, dtype: 'float' });
              }
            } else if (col_spec && col_spec.name && !col_map.has(col_spec.name)) {
              col_map.set(col_spec.name, { name: col_spec.name, dtype: col_spec.dtype || 'float' });
            }
          }
        }
      }
    }
    return Array.from(col_map.values());
  }

  filter_by_contig() {
    if (!this.data || typeof this.data.params !== 'function') {
      this.contig_filt = aq.table({});
      return;
    }
    const chromo_column = this.contig_col ?? 'scaffoldId';
    this.contig_filt = this.data
      .params({ cc: chromo_column, contig: this.sgb.contig })
      .filter((d, $) => d[$.cc] == $.contig);
  }

  filter_points_by_region() {
    if (!this.contig_filt) this.filter_by_contig();
    if (!this.contig_filt || this.contig_filt.numRows() === 0) {
      this.filt_data = this.contig_filt || aq.table({});
      return;
    }

    const exp_span = this.sgb.expanded_domain[1] - this.sgb.expanded_domain[0];
    if (exp_span >= this.sgb.contig_len - 1) {
      this.filt_data = this.contig_filt;
      return;
    }

    this.region_start = this.sgb.circular_coordinate(this.sgb.expanded_domain[0]);
    this.region_end = this.sgb.circular_coordinate(this.sgb.expanded_domain[1]);

    if (this.sgb.circular && (this.sgb.expanded_domain_includes_zero || this.region_start > this.region_end)) {
      this.filt_data = this.contig_filt
        .params({ pc: this.pos_col, region_end: this.region_end, region_start: this.region_start })
        .filter((d, $) => (d[$.pc] <= $.region_end) || (d[$.pc] >= $.region_start));
    } else {
      this.filt_data = this.contig_filt
        .params({ pc: this.pos_col, region_end: this.region_end, region_start: this.region_start })
        .filter((d, $) => (d[$.pc] <= $.region_end) && (d[$.pc] >= $.region_start));
    }
  }

  filter_features_by_region() {
    if (!this.contig_filt) this.filter_by_contig();
    if (!this.contig_filt || this.contig_filt.numRows() === 0) {
      this.filt_data = this.contig_filt || aq.table({});
      return;
    }

    const exp_span = this.sgb.expanded_domain[1] - this.sgb.expanded_domain[0];
    if (exp_span >= this.sgb.contig_len - 1) {
      this.filt_data = this.contig_filt;
      return;
    }

    this.region_start = this.sgb.circular_coordinate(this.sgb.expanded_domain[0]);
    this.region_end = this.sgb.circular_coordinate(this.sgb.expanded_domain[1]);

    if (this.sgb.circular && (this.sgb.expanded_domain_includes_zero || this.region_start > this.region_end)) {
      this.filt_data = this.contig_filt
        .params({ sc: this.start_col, ec: this.end_col, end: this.region_end, start: this.region_start })
        .filter((d, $) => (d[$.sc] <= $.end) || (d[$.ec] >= $.start) || (d[$.ec] < d[$.sc]));
    } else {
      this.filt_data = this.contig_filt
        .params({ sc: this.start_col, ec: this.end_col, end: this.region_end, start: this.region_start, circ: this.sgb.circular })
        .filter((d, $) => ((d[$.sc] <= $.end) && (d[$.ec] >= $.start)) || ($.circ && (d[$.ec] < d[$.sc]) && ((d[$.sc] <= $.end) || (d[$.ec] >= $.start))));
    }
  }
}

class staticPointData extends baseData {

  constructor(sgb, name, data, config = {}) {
    super(sgb, name);
    this.set_table(data);
    this.contig_col = config.contig_col ?? 'scaffoldId';
    this.pos_col = config.pos_col ?? 'pos';
    if (this.data) this.filter_by_contig();
  }

  update_data() {
    this.filter_points_by_region();
    return Promise.resolve();
  }

}

class staticFeatureData extends baseData {

  constructor(sgb, name, data, config = {}) {
    super(sgb, name);
    this.set_table(data);
    this.contig_col = config.contig_col ?? 'scaffoldId';
    this.start_col = config.start_col ?? 'begin';
    this.end_col = config.end_col ?? 'end';
    if (this.data) this.filter_by_contig();
  }

  update_data() {
    this.filter_features_by_region();
    return Promise.resolve();
  }

}

class serverPointData extends baseData {

  constructor(sgb, name, fetch_path, fetch_json = {}, config = {}) {
    super(sgb, name);
    this.contig_col = config.contig_col ?? 'scaffoldId';
    this.pos_col = config.pos_col ?? 'pos';
    this.fetch_path = fetch_path;
    this.fetch_json = fetch_json;
    this.fetch_json.filter_type = 'pos';
    this.fetch_json.contig_col = this.contig_col;
    this.base_columns = [
      { name: this.contig_col, dtype: 'str' },
      { name: this.pos_col, dtype: 'int' },
    ];
  }

  async update_data() {
    const [low, high] = this.sgb.expanded_domain;
    this.fetch_json.low = Math.floor(low);
    this.fetch_json.high = Math.ceil(high);
    this.fetch_json.contig = this.sgb.contig;
    this.fetch_json.contig_len = this.sgb.contig_len;
    this.fetch_json.columns = this.collect_track_columns(this.base_columns);
    this.filt_data = await fetch_server_data(this.fetch_path, this.fetch_json);
  }

}

class serverFeatureData extends baseData {

  constructor(sgb, name, fetch_path, fetch_json = {}, config = {}) {
    super(sgb, name);
    this.contig_col = config.contig_col ?? 'scaffoldId';
    this.start_col = config.start_col ?? 'begin';
    this.end_col = config.end_col ?? 'end';
    this.fetch_path = fetch_path;
    this.fetch_json = fetch_json;
    this.fetch_json.filter_type = 'beginend';
    this.fetch_json.contig_col = this.contig_col;
    this.base_columns = [
      { name: this.contig_col, dtype: 'str' },
      { name: this.start_col, dtype: 'int' },
      { name: this.end_col, dtype: 'int' },
    ];
  }

  async update_data() {
    const [low, high] = this.sgb.expanded_domain;
    this.fetch_json.low = Math.floor(low);
    this.fetch_json.high = Math.ceil(high);
    this.fetch_json.contig = this.sgb.contig;
    this.fetch_json.contig_len = this.sgb.contig_len;
    this.fetch_json.columns = this.collect_track_columns(this.base_columns);
    this.filt_data = await fetch_server_data(this.fetch_path, this.fetch_json);
  }

}

class staticParquetPointData extends baseData {
  /**
   * Reads parquet barcode/point data over HTTP Range Requests using hyparquet,
   * caching loaded columns across track requests and filtering rows client-side.
   *
   * @param {SimpleGenomeBrowser} sgb
   * @param {string} name
   * @param {string|function} url_or_path
   * @param {Object} [config]
   */
  constructor(sgb, name, url_or_path, config = {}) {
    super(sgb, name);
    if (arguments.length >= 5 && typeof arguments[4] === 'object') {
      config = { ...arguments[3], ...arguments[4] };
    } else if (arguments.length === 4 && typeof arguments[3] === 'object') {
      config = arguments[3];
    }

    this.url = url_or_path;
    this.contig_col = config.contig_col ?? 'scaffoldId';
    this.pos_col = config.pos_col ?? 'pos';
    this.base_columns = [
      { name: this.contig_col, dtype: 'str' },
      { name: this.pos_col, dtype: 'int' }
    ];
    if (Array.isArray(config.base_columns)) {
      for (const col of config.base_columns) {
        if (typeof col === 'string') {
          this.base_columns.push({ name: col, dtype: 'str' });
        } else if (col && col.name) {
          this.base_columns.push(col);
        }
      }
    }

    this.asyncBuffer = null;
    this.metadata = null;
    this.num_rows = 0;
    this._columns = {};
    this._loaded_cols = new Set();
    this._contig_ranges = null;
    this._schema_cols = null;
    this._init_promise = null;
    this._update_chain = null;
  }

  async _init() {
    if (this._init_promise) return this._init_promise;
    this._init_promise = (async () => {
      const target_url = typeof this.url === 'function' ? this.url() : this.url;
      this.asyncBuffer = await asyncBufferFromUrl({ url: target_url });
      this.metadata = await parquetMetadataAsync(this.asyncBuffer);
      this.num_rows = Number(this.metadata.num_rows);
      this._schema_cols = new Set((this.metadata.schema || []).map(s => s.name));
    })();
    return this._init_promise;
  }

  _build_contig_index() {
    if (this._contig_ranges && this._contig_ranges.size > 0) return;
    if (!(this.contig_col in this._columns)) return;
    const scaff_arr = this._columns[this.contig_col];
    if (!scaff_arr || scaff_arr.length === 0 || scaff_arr[0] == null) return;
    const ranges = new Map();
    let curr_scaff = null;
    let curr_start = 0;
    for (let i = 0; i < this.num_rows; i++) {
      const s = scaff_arr[i] != null ? String(scaff_arr[i]) : null;
      if (s !== curr_scaff) {
        if (curr_scaff !== null) {
          ranges.set(curr_scaff, [curr_start, i]);
        }
        curr_scaff = s;
        curr_start = i;
      }
    }
    if (curr_scaff !== null) {
      ranges.set(curr_scaff, [curr_start, this.num_rows]);
    }
    if (ranges.size > 0) {
      this._contig_ranges = ranges;
    }
  }

  update_data() {
    this._update_chain = (this._update_chain || Promise.resolve())
      .then(() => this._execute_update_data())
      .catch(err => {
        console.error(`Error updating parquet data (${this.name}):`, err);
        throw err;
      });
    return this._update_chain;
  }

  async _execute_update_data() {
    await this._init();

    const col_specs = this.collect_track_columns(this.base_columns);
    const needed_cols = col_specs.map(c => typeof c === 'string' ? c : c.name);

    const missing_cols = needed_cols.filter(c => !this._loaded_cols.has(c) && this._schema_cols.has(c));

    if (missing_cols.length > 0) {
      for (const col of missing_cols) {
        if (!this._columns[col]) {
          this._columns[col] = new Array(this.num_rows);
        }
      }
      await new Promise((resolve, reject) => {
        parquetRead({
          file: this.asyncBuffer,
          columns: missing_cols,
          compressors,
          onChunk: ({ columnName, columnData, rowStart }) => {
            const target = this._columns[columnName];
            if (target) {
              for (let i = 0; i < columnData.length; i++) {
                const val = columnData[i];
                target[rowStart + i] = (typeof val === 'bigint') ? Number(val) : val;
              }
            }
          },
          onComplete: () => {
            for (const col of missing_cols) {
              this._loaded_cols.add(col);
            }
            resolve();
          }
        }).catch(reject);
      });
    }

    for (const c of needed_cols) {
      if (!this._columns[c]) {
        this._columns[c] = new Array(this.num_rows).fill(null);
      }
    }

    this._build_contig_index();

    const contig_key = String(this.sgb.contig);
    let c_start = 0;
    let c_end = this.num_rows;
    if (this._contig_ranges && this._contig_ranges.size > 0) {
      if (this._contig_ranges.has(contig_key)) {
        [c_start, c_end] = this._contig_ranges.get(contig_key);
      } else if (this._contig_ranges.size === 1) {
        [c_start, c_end] = Array.from(this._contig_ranges.values())[0];
      } else {
        const empty = [];
        empty.objects = () => empty;
        this.filt_data = empty;
        return;
      }
    }

    const pos_arr = this._columns[this.pos_col];
    if (!pos_arr) {
      const empty = [];
      empty.objects = () => empty;
      this.filt_data = empty;
      return;
    }

    let valid_end = c_end;
    while (valid_end > c_start && (pos_arr[valid_end - 1] == null || isNaN(pos_arr[valid_end - 1]))) {
      valid_end--;
    }

    const exp_span = this.sgb.expanded_domain[1] - this.sgb.expanded_domain[0];
    const region_start = this.sgb.circular ? this.sgb.circular_coordinate(this.sgb.expanded_domain[0]) : this.sgb.expanded_domain[0];
    const region_end = this.sgb.circular ? this.sgb.circular_coordinate(this.sgb.expanded_domain[1]) : this.sgb.expanded_domain[1];

    const intervals = [];
    if (exp_span >= this.sgb.contig_len - 1) {
      intervals.push([c_start, valid_end]);
    } else if (this.sgb.circular && (this.sgb.expanded_domain_includes_zero || region_start > region_end)) {
      const i1_start = bisect_left(pos_arr, 0, c_start, valid_end);
      const i1_end = bisect_right(pos_arr, region_end, c_start, valid_end);
      if (i1_start < i1_end) intervals.push([i1_start, i1_end]);

      const i2_start = bisect_left(pos_arr, region_start, c_start, valid_end);
      const i2_end = bisect_right(pos_arr, this.sgb.contig_len, c_start, valid_end);
      if (i2_start < i2_end) intervals.push([i2_start, i2_end]);
    } else {
      const i_start = bisect_left(pos_arr, region_start, c_start, valid_end);
      const i_end = bisect_right(pos_arr, region_end, c_start, valid_end);
      if (i_start < i_end) intervals.push([i_start, i_end]);
    }

    const filt_rows = [];
    for (const [start_idx, end_idx] of intervals) {
      for (let i = start_idx; i < end_idx; i++) {
        const row = {};
        for (const col of needed_cols) {
          row[col] = this._columns[col][i];
        }
        filt_rows.push(row);
      }
    }

    filt_rows.objects = () => filt_rows;
    this.filt_data = filt_rows;
  }
}

class staticParquetFeatureData extends baseData {
  /**
   * Reads parquet interval/feature data (e.g. DubSeq) over HTTP Range Requests using hyparquet,
   * caching loaded columns across track requests and filtering features client-side.
   *
   * @param {SimpleGenomeBrowser} sgb
   * @param {string} name
   * @param {string|function} url_or_path
   * @param {Object} [config]
   */
  constructor(sgb, name, url_or_path, config = {}) {
    super(sgb, name);
    if (arguments.length >= 5 && typeof arguments[4] === 'object') {
      config = { ...arguments[3], ...arguments[4] };
    } else if (arguments.length === 4 && typeof arguments[3] === 'object') {
      config = arguments[3];
    }

    this.url = url_or_path;
    this.contig_col = config.contig_col ?? 'scaffoldId';
    this.start_col = config.start_col ?? 'begin';
    this.end_col = config.end_col ?? 'end';
    this.base_columns = [
      { name: this.contig_col, dtype: 'str' },
      { name: this.start_col, dtype: 'int' },
      { name: this.end_col, dtype: 'int' }
    ];
    if (Array.isArray(config.base_columns)) {
      for (const col of config.base_columns) {
        if (typeof col === 'string') {
          this.base_columns.push({ name: col, dtype: 'str' });
        } else if (col && col.name) {
          this.base_columns.push(col);
        }
      }
    }

    this.asyncBuffer = null;
    this.metadata = null;
    this.num_rows = 0;
    this._columns = {};
    this._loaded_cols = new Set();
    this._contig_ranges = null;
    this._schema_cols = null;
    this._init_promise = null;
    this._update_chain = null;
  }

  async _init() {
    if (this._init_promise) return this._init_promise;
    this._init_promise = (async () => {
      const target_url = typeof this.url === 'function' ? this.url() : this.url;
      this.asyncBuffer = await asyncBufferFromUrl({ url: target_url });
      this.metadata = await parquetMetadataAsync(this.asyncBuffer);
      this.num_rows = Number(this.metadata.num_rows);
      this._schema_cols = new Set((this.metadata.schema || []).map(s => s.name));
    })();
    return this._init_promise;
  }

  _build_contig_index() {
    if (this._contig_ranges && this._contig_ranges.size > 0) return;
    if (!(this.contig_col in this._columns)) return;
    const scaff_arr = this._columns[this.contig_col];
    if (!scaff_arr || scaff_arr.length === 0 || scaff_arr[0] == null) return;
    const ranges = new Map();
    let curr_scaff = null;
    let curr_start = 0;
    for (let i = 0; i < this.num_rows; i++) {
      const s = scaff_arr[i] != null ? String(scaff_arr[i]) : null;
      if (s !== curr_scaff) {
        if (curr_scaff !== null) {
          ranges.set(curr_scaff, [curr_start, i]);
        }
        curr_scaff = s;
        curr_start = i;
      }
    }
    if (curr_scaff !== null) {
      ranges.set(curr_scaff, [curr_start, this.num_rows]);
    }
    if (ranges.size > 0) {
      this._contig_ranges = ranges;
    }
  }

  update_data() {
    this._update_chain = (this._update_chain || Promise.resolve())
      .then(() => this._execute_update_data())
      .catch(err => {
        console.error(`Error updating parquet data (${this.name}):`, err);
        throw err;
      });
    return this._update_chain;
  }

  async _execute_update_data() {
    await this._init();

    const col_specs = this.collect_track_columns(this.base_columns);
    const needed_cols = col_specs.map(c => typeof c === 'string' ? c : c.name);

    const missing_cols = needed_cols.filter(c => !this._loaded_cols.has(c) && this._schema_cols.has(c));

    if (missing_cols.length > 0) {
      for (const col of missing_cols) {
        if (!this._columns[col]) {
          this._columns[col] = new Array(this.num_rows);
        }
      }
      await new Promise((resolve, reject) => {
        parquetRead({
          file: this.asyncBuffer,
          columns: missing_cols,
          compressors,
          onChunk: ({ columnName, columnData, rowStart }) => {
            const target = this._columns[columnName];
            if (target) {
              for (let i = 0; i < columnData.length; i++) {
                const val = columnData[i];
                target[rowStart + i] = (typeof val === 'bigint') ? Number(val) : val;
              }
            }
          },
          onComplete: () => {
            for (const col of missing_cols) {
              this._loaded_cols.add(col);
            }
            resolve();
          }
        }).catch(reject);
      });
    }

    for (const c of needed_cols) {
      if (!this._columns[c]) {
        this._columns[c] = new Array(this.num_rows).fill(null);
      }
    }

    this._build_contig_index();

    const contig_key = String(this.sgb.contig);
    let c_start = 0;
    let c_end = this.num_rows;
    if (this._contig_ranges && this._contig_ranges.size > 0) {
      if (this._contig_ranges.has(contig_key)) {
        [c_start, c_end] = this._contig_ranges.get(contig_key);
      } else if (this._contig_ranges.size === 1) {
        [c_start, c_end] = Array.from(this._contig_ranges.values())[0];
      } else {
        const empty = [];
        empty.objects = () => empty;
        this.filt_data = empty;
        return;
      }
    }

    const begin_arr = this._columns[this.start_col];
    const end_arr = this._columns[this.end_col];
    if (!begin_arr || !end_arr) {
      const empty = [];
      empty.objects = () => empty;
      this.filt_data = empty;
      return;
    }

    let valid_end = c_end;
    while (valid_end > c_start && (begin_arr[valid_end - 1] == null || isNaN(begin_arr[valid_end - 1]))) {
      valid_end--;
    }

    const exp_span = this.sgb.expanded_domain[1] - this.sgb.expanded_domain[0];
    const region_start = this.sgb.circular ? this.sgb.circular_coordinate(this.sgb.expanded_domain[0]) : this.sgb.expanded_domain[0];
    const region_end = this.sgb.circular ? this.sgb.circular_coordinate(this.sgb.expanded_domain[1]) : this.sgb.expanded_domain[1];

    const is_full_span = exp_span >= this.sgb.contig_len - 1;
    const is_wrapped = this.sgb.circular && (this.sgb.expanded_domain_includes_zero || region_start > region_end);

    const filt_rows = [];
    if (is_full_span) {
      for (let i = c_start; i < valid_end; i++) {
        const row = {};
        for (const col of needed_cols) row[col] = this._columns[col][i];
        filt_rows.push(row);
      }
    } else if (is_wrapped) {
      for (let i = c_start; i < valid_end; i++) {
        const b = begin_arr[i];
        const e = end_arr[i];
        if (b <= region_end || e >= region_start || e < b) {
          const row = {};
          for (const col of needed_cols) row[col] = this._columns[col][i];
          filt_rows.push(row);
        }
      }
    } else {
      const max_i = bisect_right(begin_arr, region_end, c_start, valid_end);
      for (let i = c_start; i < max_i; i++) {
        const e = end_arr[i];
        const b = begin_arr[i];
        if ((b <= region_end && e >= region_start) || (this.sgb.circular && e < b && (b <= region_end || e >= region_start))) {
          const row = {};
          for (const col of needed_cols) row[col] = this._columns[col][i];
          filt_rows.push(row);
        }
      }
    }

    filt_rows.objects = () => filt_rows;
    this.filt_data = filt_rows;
  }
}

export {
  baseData,
  staticPointData,
  staticFeatureData,
  serverPointData,
  serverFeatureData,
  staticParquetPointData,
  staticParquetFeatureData
};
