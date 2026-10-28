// Basic display tracks for the Simple Genome Browser

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import * as aq from 'https://cdn.jsdelivr.net/npm/arquero@8.0.3/+esm';
import { SimpleGenomeBrowser } from "./SimpleGenomeBrowser.js";
import { baseData, staticFeatureData } from "./SGB_data.js";
import {
  measure_text,
  reverse_complement,
  copy_sequence,
  parse_alignments,
  load_alignments,
  assign_subtracks
} from "./util.js";
import { nice_logcount_scale, make_heatmap_summary_sidebar } from "./helper_functions.js";

function escape_svg_text(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function default_gene_tooltip_func(sgb, e, gene_object) {
  if (gene_object) {
    const { locusId, name, desc } = gene_object;
    const html = `
      <div class="gene_tooltip">
        <p class="sidebar_title"><strong>${name ?? locusId ?? ''}</strong></p>
        <p><strong>Locus ID:</strong> ${locusId ?? ''}</p>
        <p><strong>Description:</strong> ${desc ?? ''}</p>
      </div>
    `;
    sgb.tooltip.selectAll('*').remove();
    sgb.show_tooltip(e.pageX, e.pageY, html);
  }
}

function default_gene_sidebar_func(sgb, gene_object) {
  if (gene_object) {
    const { locusId, name, desc, begin, end, strand, scaffoldId, pseudo } = gene_object;
    const sidebar_info_rows = [
      ['Name:', name ?? ''],
      ['Locus ID:', locusId ?? ''],
      ['Description:', desc ?? ''],
      ['Contig:', scaffoldId ?? ''],
      ['Start:', begin ?? ''],
      ['End:', end ?? ''],
      ['Strand:', strand ?? '']
    ];
    if (pseudo) sidebar_info_rows.push(['(Pseudogene)', '']);

    sgb.sidebar_div.selectAll('*').remove();
    sgb.sidebar_div.selectAll('.sidebar_info_row')
      .data(sidebar_info_rows)
      .enter()
      .append('p')
        .attr('class', (d) => d[0] === 'Name:' ? 'sidebar_info_row sidebar_title' : 'sidebar_info_row')
        .html((d) => `<strong>${d[0]}</strong> ${d[1]}`);

    if (sgb.seqs && sgb.seqs[scaffoldId]) {
      sgb.sidebar_div.append('p').append('button')
        .html('Copy DNA Sequence')
        .on('click', function() {
          const seq = sgb.get_sequence(begin, end, scaffoldId, strand);
          copy_sequence(seq, this);
        });
    }

    const aa_seq = gene_object.translation || (sgb.aa_seqs && sgb.aa_seqs[locusId]);
    if (aa_seq) {
      sgb.sidebar_div.append('p').append('button')
        .html('Copy AA Sequence')
        .on('click', function() {
          copy_sequence(aa_seq, this);
        });
      sgb.sidebar_div.append('p').append('a')
        .attr('href', `https://fast.genomics.lbl.gov/cgi/findHomologs.cgi?seqDesc=${locusId}&seq=${aa_seq}`)
        .attr('target', '_blank')
        .html('Find homologs with fast.genomics');
    } else if (sgb.aa_seqs && Object.keys(sgb.aa_seqs).length > 0) {
      sgb.sidebar_div.append('p').html('No AA sequence available');
    }
    sgb.show_sidebar();
  }
}

class baseTrack {
  /**
   * Base class for all track types in the Simple Genome Browser.
   * Provides the basic structure for a track, including a 3x-width holding div,
   * controls bar, SVG element (`this.g` for draggable genomic content and `this.static_g` for
   * viewport-pinned overlays/axes), optional canvas (`this.init_canvas()`), and region loading logic.
   *
   * @param {SimpleGenomeBrowser} sgb - The SimpleGenomeBrowser instance this track belongs to.
   * @param {string} name - The name of the track.
   * @param {object} [config={}] - Optional configuration object for the track.
   * @param {number} [config.load_threshold=1000000] - Domain width (in bp) above which track data will not be automatically loaded.
   */
  constructor(sgb, name, config = {}) {
    const self = this;
    self.sgb = sgb;
    self.name = name;

    self.config = config;
    self.title_h = config.title_h ?? 24;
    self.load_threshold = config.load_threshold ?? 1000000;
    self.expanded = true;

    // 3x-width holding div for pre-rendered dragging
    self.holding_div = self.sgb.inner_div.append('div')
      .attr('class', 'sgb_track_holding_div')
      .style('width', self.sgb.display_w + 'px')
      .style('position', 'relative')
      .style('left', (-1 * self.sgb.w) + 'px');

    // Controls bar for track title and buttons
    self.controls_div = self.holding_div.append('div')
      .attr('class', 'sgb_track_controls')
      .style('position', 'relative')
      .style('left', self.sgb.w + 'px')
      .style('margin-bottom', '5px')
      .style('padding-left', '10px')
      .style('display', 'flex')
      .style('align-items', 'center')
      .style('height', self.title_h + 'px');

    self.div = self.holding_div.append('div')
      .style('position', 'relative');

    self.svg = self.div.append('svg')
      .attr('width', self.sgb.display_w)
      .style('position', 'absolute')
      .style('left', '0px')
      .style('top', '0px')
      .style('z-index', 1);

    // `this.g` shifts horizontally during drag/scroll (for genomic features)
    self.g = self.svg.append('g').attr('class', 'sgb_track_g');
    // `this.static_g` stays fixed during drag/scroll (for y-axes, labels, and viewport overlays)
    self.static_g = self.svg.append('g').attr('class', 'sgb_track_static_g');

    self.force_load_on = false;
    self.currently_force_loading = false;

    self.force_load_div = self.div.append('div')
      .attr('class', 'sgb_force_load_overlay')
      .style('position', 'absolute')
      .style('left', self.sgb.w + 'px')
      .style('top', '0px')
      .style('width', self.sgb.w + 'px')
      .style('height', (self.track_h || 100) + 'px')
      .style('background-color', '#ebebeb')
      .style('display', 'none')
      .style('align-items', 'center')
      .style('justify-content', 'center')
      .style('z-index', 10);

    self.force_load_button = self.force_load_div.append('button')
      .attr('class', 'sgb_force_load_btn')
      .style('padding', '6px 14px')
      .style('font-size', '13px')
      .style('font-weight', '500')
      .style('cursor', 'pointer')
      .style('border', '1px solid #999')
      .style('border-radius', '4px')
      .style('background', '#fff')
      .style('box-shadow', '0 2px 4px rgba(0,0,0,0.1)')
      .html('Click to force load')
      .on('click', async (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        self.force_load_on = false;
        self.currently_force_loading = true;
        self.force_load_button.text('Loading...').property('disabled', true);
        try {
          await self.force_load_track();
        } finally {
          self.force_load_button.text('Click to force load').property('disabled', false);
        }
      });

    if (config.track_h !== undefined) {
      self.update_track_height(config.track_h);
    }

    if (!config.hide_title) {
      self.show_title(self.name);
    }
  }

  /**
   * Initializes a 3x-width HTML5 `<canvas>` layered beneath `this.svg` (`z-index: 0`),
   * setting `this.canvas` and `this.ctx`. Automatically managed on resize.
   */
  init_canvas(height = this.track_h) {
    if (height !== undefined) {
      this.update_track_height(height);
    }
    this.div.select('canvas.sgb_track_canvas').remove();
    this.canvas = this.div.append('canvas')
      .attr('class', 'sgb_track_canvas')
      .attr('width', this.sgb.display_w)
      .attr('height', this.track_h || 100)
      .style('position', 'absolute')
      .style('left', '0px')
      .style('top', '0px')
      .style('z-index', 0);
    this.ctx = this.canvas.node().getContext('2d');
    this.svg.style('z-index', 1);
    return this.ctx;
  }

  /**
   * Convenience method returning the current region's filtered data rows as an array of objects.
   */
  get_rows() {
    if (!this.data) return [];
    if (typeof this.data.get_rows === 'function') {
      return this.data.get_rows();
    }
    if (this.data.filt_data && typeof this.data.filt_data.objects === 'function') {
      return this.data.filt_data.objects();
    }
    return Array.isArray(this.data.filt_data) ? this.data.filt_data : [];
  }

  update_track_height(new_h) {
    this.track_h = new_h;
    this.div.style('height', this.track_h + 'px');
    this.svg.attr('height', this.track_h);
    if (this.canvas) {
      this.canvas.attr('height', this.track_h);
    }
    if (this.force_load_div) {
      this.force_load_div.style('height', this.track_h + 'px');
    }
  }

  show_title(title, fontsize = 14) {
    const self = this;
    if (self.title_div) self.title_div.remove();
    self.title_div = self.controls_div.append('div')
      .attr('class', 'track_title')
      .style('top', '0px')
      .style('height', (self.title_h - 6) + 'px')
      .style('color', 'black')
      .style('padding', '2px 6px')
      .style('margin', '1px')
      .style('margin-right', '20px')
      .style('font-size', fontsize + 'px')
      .style('text-align', 'center')
      .style('cursor', 'pointer')
      .style('z-index', 11)
      .style('border-radius', '0')
      .style('border-bottom', '1px solid black')
      .text(title)
      .on('mouseover', () => {
        self.title_div.style('opacity', 0.8);
        self.title_div.style('background-color', '#EEE');
      })
      .on('mouseout', () => {
        self.title_div.style('opacity', 1);
        self.title_div.style('background-color', 'transparent');
      })
      .on('click', () => {
        if (self.expanded) {
          self.div.style('display', 'none');
          self.expanded = false;
        } else {
          self.div.style('display', 'block');
          self.expanded = true;
          if (!self.data || self.data.loaded) {
            self.display_region();
          } else {
            self.data.update_data().then(() => {
              self.data.loaded = true;
              self.display_region();
            });
          }
        }
      });
  }

  add_controls_button(text, callback) {
    const self = this;
    return self.controls_div.append('div')
      .attr('class', 'sgb_settings_btn')
      .style('height', (self.title_h - 6) + 'px')
      .style('margin', '1px')
      .style('margin-right', '20px')
      .style('padding', '2px 6px')
      .style('border-radius', '5px')
      .style('border', '1px solid #777')
      .style('font-size', Math.max(10, self.title_h - 10) + 'px')
      .style('text-align', 'center')
      .style('cursor', 'pointer')
      .style('background-color', '#EEE')
      .style('z-index', 11)
      .text(text)
      .on('mouseover', function() { d3.select(this).style('opacity', 0.8); })
      .on('mouseout', function() { d3.select(this).style('opacity', 1); })
      .on('click', (event) => { callback(event); });
  }

  hide_title() {
    if (this.title_div) {
      this.title_div.style('visibility', 'hidden');
    }
  }

  make_color_legend(color_map, config = {}) {
    const self = this;
    const title = config.title || 'Key';
    const fontsize = config.fontsize || 12;

    const legend_div = self.controls_div.append('div')
      .attr('class', 'color_legend')
      .style('position', 'relative')
      .style('margin-right', '20px')
      .style('background-color', '#CCC')
      .style('border', '1px solid black')
      .style('text-align', 'center')
      .style('z-index', 12);

    const title_element = legend_div.append('h4')
      .text(title)
      .style('font-size', fontsize + 'px')
      .style('cursor', 'pointer')
      .style('margin', '2px 6px');

    const legend_items = legend_div.append('div')
      .attr('class', 'legend_items')
      .style('position', 'absolute')
      .style('left', '0px')
      .style('top', '100%')
      .style('visibility', 'hidden')
      .style('background-color', 'white')
      .style('border', '1px solid black')
      .style('padding', '8px 6px')
      .style('white-space', 'nowrap');

    for (const [name, color] of Object.entries(color_map)) {
      const legend_item = legend_items.append('div')
        .style('display', 'flex')
        .style('align-items', 'center')
        .style('margin-bottom', '2px');

      legend_item.append('div')
        .style('width', '12px')
        .style('height', '12px')
        .style('background-color', color)
        .style('border', '1px solid black')
        .style('margin-right', '5px');

      legend_item.append('span')
        .text(name)
        .style('text-align', 'left')
        .style('font-size', fontsize + 'px');
    }

    let expanded = false;
    title_element
      .on('mouseover', () => {
        if (!expanded) {
          legend_items.style('visibility', 'visible');
          title_element.style('opacity', 0.8);
        }
      })
      .on('mouseout', () => {
        if (!expanded) {
          legend_items.style('visibility', 'hidden');
        }
        title_element.style('opacity', 1);
      })
      .on('click', () => {
        expanded = !expanded;
        legend_items.style('visibility', expanded ? 'visible' : 'hidden');
      });
  }

  async force_load_track() {
    const self = this;
    if (self.g) self.g.attr('transform', 'translate(0,0)');
    if (self.canvas) self.canvas.style('left', '0px');
    if (self.data && typeof self.data.update_data === 'function') {
      await self.data.update_data();
    }
    await self.load_region();
    self.force_load_on = false;
    self.force_load_div.style('display', 'none');
  }

  load_region() {
    throw new Error("load_region() must be implemented by child class");
  }

  display_region() {
    const self = this;
    if (self.sgb.domain_wid <= self.load_threshold) {
      self.currently_force_loading = false;
    }
    if ((self.sgb.domain_wid > self.load_threshold) && (!self.currently_force_loading)) {
      if (!self.force_load_on) {
        self.force_load_on = true;
        self.force_load_div.style('display', 'flex');
      }
    } else {
      if (self.g) self.g.attr('transform', 'translate(0,0)');
      if (self.canvas) self.canvas.style('left', '0px');
      self.load_region();
      if (self.force_load_on) {
        self.force_load_on = false;
        self.force_load_div.style('display', 'none');
      }
    }
  }

  resize() {
    const self = this;
    self.holding_div
      .style('width', self.sgb.display_w + 'px')
      .style('left', (-1 * self.sgb.w) + 'px');
    self.controls_div
      .style('left', self.sgb.w + 'px')
      .style('width', self.sgb.w + 'px');
    if (self.force_load_div) {
      self.force_load_div
        .style('left', self.sgb.w + 'px')
        .style('width', self.sgb.w + 'px');
    }
    self.svg.attr('width', self.sgb.display_w);
    if (self.canvas) {
      self.canvas.attr('width', self.sgb.display_w);
    }
  }

  remove_track() {
    for (const dn of Object.keys(this.sgb.data_map)) {
      const data_list = this.sgb.data_map[dn];
      const i = data_list.indexOf(this.name);
      if (i > -1) {
        this.sgb.data_map[dn].splice(i, 1);
      }
    }
    if (this.sgb.search_dict) {
      let removed_any = false;
      for (const [k, entry] of Object.entries(this.sgb.search_dict)) {
        if (entry && entry.track === this) {
          delete this.sgb.search_dict[k];
          removed_any = true;
        }
      }
      if (removed_any) this.sgb.update_search();
    }
    delete this.sgb.tracks[this.name];
    this.holding_div.remove();
  }
}

class baseFeatureTrack extends baseTrack {
  /**
   * Extends `baseTrack` to provide a base class for tracks that display feature data.
   * Assumes feature data has attributes for contig, start, end, and id (e.g. locusId).
   */
  constructor(sgb, name, config = {}, contig_column = 'scaffoldId', start_column = 'begin', end_column = 'end', id_column = 'locusId') {
    super(sgb, name, config);
    this.contig_col = contig_column;
    this.start_col = start_column;
    this.end_col = end_column;
    this.id_col = id_column;
  }

  hover_function(e, gene_object) {
    default_gene_tooltip_func(this.sgb, e, gene_object);
  }

  click_function(gene_object) {
    default_gene_sidebar_func(this.sgb, gene_object);
  }

  load_region() {
    throw new Error("load_region() must be implemented by child class");
  }
}

class geneTrack extends baseFeatureTrack {
  /**
   * Extends `baseFeatureTrack` to display gene features as directional chevrons.
   * Can be instantiated directly with a `baseData` instance or an array/Arquero table of features,
   * or extended by subclasses (`gbTrack`, `gffTrack`, `geneTableTrack`).
   */
  constructor(
    sgb,
    name,
    config = {},
    contig_column = 'scaffoldId',
    start_column = 'begin',
    end_column = 'end',
    id_column = 'locusId',
    data_or_features = null
  ) {
    super(sgb, name, config, contig_column, start_column, end_column, id_column);
    this.update_track_height(config.track_h ?? 40);
    if (data_or_features) {
      this.set_feature_data(data_or_features);
    }
  }

  set_feature_data(data_or_features, index_in_search = true) {
    const self = this;
    if (data_or_features instanceof baseData) {
      self.data = data_or_features;
      self.data_name = data_or_features.name;
    } else {
      self.data_name = self.data_name || (self.name + '_data');
      const table = Array.isArray(data_or_features) ? aq.from(data_or_features) : data_or_features;
      if (index_in_search && table && typeof table.objects === 'function') {
        for (const row of table.objects()) {
          const id = String(row[self.id_col]);
          self.sgb.search_dict[id] = {
            contig: row[self.contig_col],
            start: row[self.start_col],
            end: row[self.end_col],
            datum: row,
            track: self
          };
        }
        self.sgb.update_search();
      }
      self.data = new staticFeatureData(self.sgb, self.data_name, table, Object.assign({
        contig_col: self.contig_col,
        start_col: self.start_col,
        end_col: self.end_col
      }, self.config));
    }
    self.data.filter_by_contig();
    self.data.update_data();
  }

  load_region() {
    const self = this;
    const rows = self.get_rows();

    self.g.selectAll('*').remove();
    self.g.selectAll('.feature_blocks')
      .data(rows)
      .enter()
      .append('g')
        .attr('class', 'sgb_gene')
        .attr('opacity', 0.8)
        .style('cursor', 'pointer')
        .on('mouseover', (e, d) => {
          self.hover_function(e, d, self);
        })
        .on('mousemove', (e) => self.sgb.move_tooltip(e.pageX, e.pageY))
        .on('mouseout', () => self.sgb.hide_tooltip())
        .html(function(d) { return self.make_gene_display(d); })
        .on('click', (e, d) => {
          if (Math.abs(self.sgb.x_change_mouse || 0) > 2) return;
          self.click_function(d);
          e.stopPropagation();
        });
  }

  get_feature_stroke(d) {
    return 'none';
  }

  get_feature_fill(d) {
    return '#333';
  }

  make_gene_display(d) {
    const self = this;
    const [left, right] = self.sgb.get_feature_pixel_position(d[self.start_col], d[self.end_col]);
    const width = right - left;
    const height = Math.max(Math.min(30, 1000000 / self.sgb.domain_wid), 20);
    const halfHeight = height / 2;
    const chevron_size = (width < 10) ? 0 : Math.min(width / 4, 20);
    const top = 0;
    let points = '';
    if (d.strand) {
      if (d.strand === '-') {
        points = `${left},${top + halfHeight} ${left + chevron_size},${top + height} ${left + width},${top + height} ${left + width},${top} ${left + chevron_size},${top}`;
      } else {
        points = `${right},${top + halfHeight} ${right - chevron_size},${top + height} ${right - width},${top + height} ${right - width},${top} ${right - chevron_size},${top}`;
      }
    } else {
      points = `${right},${top} ${right},${top + height} ${right - width},${top + height} ${right - width},${top}`;
    }

    const stroke = self.get_feature_stroke(d);
    const fill = self.get_feature_fill(d);
    const strokeWid = 1;
    const chev = `<polygon points="${points}" stroke="${stroke}" fill="${fill}" stroke-width="${strokeWid}" />`;

    let label_use = '';
    if (width > 20) {
      const fontsizes = [8, 9, 10, 12, 14, 16, 18, 20];
      const textBuf = 2.5;
      const raw_label = String(d.name ?? d[self.id_col] ?? '');
      let fontsize = fontsizes[0];
      let labelsize = measure_text(raw_label, fontsize);
      const labelVisible = ((labelsize + 2 * textBuf + chevron_size) < width);
      if (labelVisible) {
        for (const f of fontsizes) {
          labelsize = measure_text(raw_label, f);
          if ((labelsize + 2 * textBuf + chevron_size) < width) {
            fontsize = f;
          } else {
            break;
          }
        }
        const x_pos = d.strand === '+' ? left + textBuf : left + textBuf + chevron_size;
        const y_pos = top + height - textBuf - 2;
        label_use = `<text x="${x_pos}" y="${y_pos}" font-size="${fontsize}" fill="#FFF">${escape_svg_text(raw_label)}</text>`;
      }
    }

    return chev + label_use;
  }
}

class quantitativeFeatureTrack extends baseFeatureTrack {
  /**
   * Extends `baseFeatureTrack` to display quantitative data associated with genomic features as a canvas heatmap.
   */
  constructor(sgb, name, config, full_column_config, contig_column, start_column, end_column, id_column) {
    super(sgb, name, config, contig_column, start_column, end_column, id_column);
    const self = this;

    if (Array.isArray(full_column_config) && (typeof full_column_config[0] === 'string')) {
      self.full_column_config = full_column_config.map(col_name => ({ name: col_name, column: col_name }));
    } else {
      self.full_column_config = full_column_config;
    }

    const current_columns = config.current_columns ?? self.full_column_config.map(c => c.name);

    self.column_config = self.full_column_config
      .filter(c => current_columns.includes(c.name))
      .sort((a, b) => current_columns.indexOf(a.name) - current_columns.indexOf(b.name));

    self.focal_col = config.focal_col ?? self.column_config[0].name;
    if (self.sgb.saved_state) self.sgb.saved_state.focal = self.focal_col;

    self.inactive_config = self.full_column_config.filter(c => !current_columns.includes(c.name));

    self.divergingColorScale = d3.scaleDiverging();
    self.svg.style('z-index', 1);

    self.highlightRect = self.svg.append('rect')
      .attr('fill', 'rgba(255, 0, 0, 0.5)')
      .style('pointer-events', 'none')
      .style('visibility', 'hidden');

    self.active_sidebar_panel = config.active_sidebar_panel || 'gene_hits';

    self.svg
      .on('mousemove', (event) => self.handleMousemove(event))
      .on('mouseleave', () => self.handleMouseout())
      .on('click', (event) => self.handleClick(event));

    self.reset_display();
  }

  reset_display() {
    const self = this;
    self.block_h = self.config.block_height ?? 20;
    self.block_buffer = self.config.block_buffer ?? 1.1;
    self.block_ys = Array.from({ length: self.column_config.length }, (_, i) => self.block_h * self.block_buffer * i);
    self.canvas_h = Math.ceil(self.block_h * self.block_buffer * self.column_config.length + 15);
    self.init_canvas(self.canvas_h);

    if (self.row_title_div) self.row_title_div.remove();
    self.row_title_div = self.div.append('div')
      .style('width', '200px')
      .style('position', 'absolute')
      .style('left', self.sgb.w + 'px')
      .style('top', '0px')
      .style('z-index', 2);

    self.cellDataIndexMap = null;

    self.display_column_names();
  }

  set_diverging_colorscale(scale) {
    this.divergingColorScale = scale;
  }

  display_column_names() {
    const self = this;
    self.row_title_div.selectAll('.heatmap_col_name')
      .data(self.column_config)
      .join('div')
      .attr('class', 'heatmap_col_name')
      .style('position', 'absolute')
      .style('top', (d, i) => `${self.block_ys[i]}px`)
      .style('left', '10px')
      .style('text-align', 'left')
      .style('width', '200px')
      .style('height', `${self.block_h}px`)
      .style('background-color', (d, i) => i % 2 == 0 ? '#DDD' : '#FFF')
      .style('display', 'flex')
      .style('align-items', 'center')
      .style('padding-left', '5px')
      .style('box-sizing', 'border-box')
      .style('cursor', 'pointer')
      .html((d) => `<span style="font-size: ${Math.min(self.block_h, 16)}px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; width: 100%;">${d.name}</span>`)
      .on('mouseover', function(event, d) {
        d3.select(this).style('background-color', '#F88');
        if (self.col_name_hover_function) self.col_name_hover_function(event, d);
      })
      .on('mouseout', function() {
        self.row_title_div.selectAll('.heatmap_col_name').style('background-color', (data, i) => {
          return data.name === self.focal_col ? '#FAA' : i % 2 === 0 ? '#DDD' : '#FFF';
        });
        self.sgb.hide_tooltip();
      })
      .on('click', function(event, d) {
        if (d.name != self.focal_col) {
          self.focal_col = d.name;
          if (self.sgb.saved_state) self.sgb.saved_state.focal = d.name;
          self.row_title_div.selectAll('.heatmap_col_name').style('background-color', (data, i) => {
            return data.name === self.focal_col ? '#FAA' : i % 2 === 0 ? '#DDD' : '#FFF';
          });
        }
        if (self.col_name_click_function) self.col_name_click_function(event, d);
        event.stopPropagation();
      });

    if (self.column_config.filter((c) => c.name == self.focal_col).length == 0) {
      self.focal_col = self.column_config[0].name;
    }
    self.row_title_div.selectAll('.heatmap_col_name').style('background-color', function(d) {
      return d.name === self.focal_col ? '#FAA' : d3.select(this).style('background-color');
    });
  }

  col_name_click_function(event, col) {
    this.make_summary_sidebar(col);
    if (this.col_name_click) this.col_name_click(event, col);
  }

  make_summary_sidebar(col) {
    make_heatmap_summary_sidebar(this, col, default_gene_tooltip_func);
  }

  get_col_index_at_y(mouseY) {
    const stride = this.block_h * this.block_buffer;
    if (stride <= 0 || mouseY < 0) return -1;
    const colIndex = Math.floor(mouseY / stride);
    if (colIndex < 0 || colIndex >= this.column_config.length) return -1;
    const y = this.block_ys[colIndex];
    return (mouseY >= y && mouseY <= y + this.block_h) ? colIndex : -1;
  }

  load_region() {
    const self = this;
    self.object_data = self.get_rows();

    const display_w = self.sgb.display_w;
    const num_cols = self.column_config.length;
    self.ctx.clearRect(0, 0, display_w, self.canvas_h);
    self.cellDataIndexMap = new Int32Array(num_cols * display_w).fill(-1);

    for (let dataIndex = 0; dataIndex < self.object_data.length; dataIndex++) {
      const d = self.object_data[dataIndex];
      const [left, right] = self.sgb.get_feature_pixel_position(d[self.start_col], d[self.end_col]);
      if (right < 0 || left > display_w) continue;

      const draw_w = Math.max(1, right - left);
      const xStart = Math.max(0, Math.floor(left));
      const xEnd = Math.min(display_w, Math.max(xStart + 1, Math.ceil(left + draw_w)));

      for (let colIndex = 0; colIndex < num_cols; colIndex++) {
        const column = self.column_config[colIndex].column;
        const val = d[column];
        if (val !== null && val !== undefined && !Number.isNaN(val) && self.filter_datum(d, column)) {
          const y = self.block_ys[colIndex];
          if (self.get_feature_block_fill) {
            self.ctx.fillStyle = self.get_feature_block_fill(d, column);
          } else {
            self.ctx.fillStyle = self.divergingColorScale(val);
          }
          self.ctx.fillRect(left, y, draw_w, self.block_h);
          if (self.get_feature_block_stroke) {
            self.ctx.strokeStyle = self.get_feature_block_stroke(d, column);
            self.ctx.strokeRect(left, y, draw_w, self.block_h);
          }
          const rowOffset = colIndex * display_w;
          for (let x = xStart; x < xEnd; x++) {
            self.cellDataIndexMap[rowOffset + x] = dataIndex;
          }
        }
      }
    }
  }

  filter_datum(d, column) {
    return true;
  }

  resize() {
    super.resize();
    this.row_title_div.style('left', this.sgb.w + 'px');
  }

  get_pixel_info(mouseX, mouseY) {
    const display_w = this.sgb.display_w;
    if (!this.cellDataIndexMap || mouseX < 0 || mouseX >= display_w) return null;
    const colIndex = this.get_col_index_at_y(mouseY);
    if (colIndex < 0) return null;
    const dataIndex = this.cellDataIndexMap[colIndex * display_w + mouseX];
    if (dataIndex < 0) return null;
    return { dataIndex, colIndex };
  }

  handleMousemove(event) {
    const self = this;
    const [rawX, rawY] = d3.pointer(event, self.svg.node());
    const mouseX = Math.floor(rawX);
    const mouseY = Math.floor(rawY);
    const pixelInfo = self.get_pixel_info(mouseX, mouseY);

    if (pixelInfo) {
      const d = self.object_data[pixelInfo.dataIndex];
      const [left, right] = self.sgb.get_feature_pixel_position(d[self.start_col], d[self.end_col]);
      const y = self.block_ys[pixelInfo.colIndex];

      self.highlightRect
        .attr('x', left)
        .attr('y', y)
        .attr('width', Math.max(1, right - left))
        .attr('height', self.block_h)
        .style('visibility', 'visible');
      const col = self.column_config[pixelInfo.colIndex];
      if (self.hover_function) self.hover_function(event, col, d);

      self.hoveredPixelInfo = pixelInfo;
      if (self.callback) self.callback('mouseover', { datum: d, column: col, pixelInfo: pixelInfo, track: self });
      return;
    }

    self.highlightRect.style('visibility', 'hidden');
    self.sgb.hide_tooltip();
  }

  handleMouseout() {
    const self = this;
    this.highlightRect.style('visibility', 'hidden');
    this.sgb.hide_tooltip();
    if (this.callback) this.callback('mouseout', { hoveredPixelInfo: self.hoveredPixelInfo, track: self });
  }

  handleClick(event) {
    const self = this;
    if (Math.abs(self.sgb.x_change_mouse || 0) > 2) return;
    const [rawX, rawY] = d3.pointer(event, self.svg.node());
    const mouseX = Math.floor(rawX);
    const mouseY = Math.floor(rawY);
    const pixelInfo = self.get_pixel_info(mouseX, mouseY);

    if (pixelInfo) {
      const d = self.object_data[pixelInfo.dataIndex];
      const col = self.column_config[pixelInfo.colIndex];
      if (self.click_function) self.click_function(event, col, d);
      if (self.callback) self.callback('click', { datum: d, column: col, pixelInfo: pixelInfo, track: self });
    }
  }

  hover_function(e, column, gene_object) {
    const self = this;
    if (gene_object) {
      const { locusId, name, desc } = gene_object;
      const html = `
        <div class="gene_tooltip">
          <p><strong>Locus ID:</strong> ${locusId}</p>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Description:</strong> ${desc}</p>
          <p><strong>${column.name}:</strong> ${gene_object[column.column]}</p>
        </div>
      `;
      self.sgb.tooltip.selectAll('*').remove();
      self.sgb.show_tooltip(e.pageX, e.pageY, html);
    }
  }
}

class quantitativeYaxesTrack extends baseTrack {
  /**
   * Base class for tracks displaying quantitative data along a single y-axis on a canvas.
   */
  constructor(sgb, name, column, config = {}, contig_column = 'scaffoldId') {
    super(sgb, name, config);
    const self = this;
    self.contig_col = contig_column;
    self.column = column;
    self.config = config;
    self.title = config.title ?? self.column;
    self.load_threshold = config.load_threshold ?? 1000000;
    self.yticks = config.yticks ?? 'infer';
    self.ydomain = config.ydomain ?? 'infer';
    if (self.ydomain != 'infer') self.use_domain = self.ydomain;
    if (self.yticks != 'infer') self.use_yticks = self.yticks;
    self.ytick_formatter = config.ytick_formatter ?? null;
    self.y_scale_type = config.y_scale_type ?? 'linear';
    self.clip = config.clip ?? false;
    self.n_yticks = config.n_yticks ?? 5;
    self.h = config.h ?? 100;
    self.update_track_height(self.h + self.title_h);
    self.h_buf = config.h_buf ?? 0.1;
    self.left_buf = config.left_buf ?? 60;

    const fraction_buf = self.h_buf * self.h;
    self.yrange = [self.h - fraction_buf, fraction_buf];
    self.base_scale = (self.y_scale_type == 'symlogcount') ? d3.scaleSymlog() : (self.y_scale_type == 'log') ? d3.scaleLog() : d3.scaleLinear();
    if (self.ydomain != 'infer') {
      self.yscale = (self.clip) ? self.base_scale.range(self.yrange).clamp(true).domain(self.use_domain) : self.base_scale.range(self.yrange).domain(self.use_domain).nice();
      self.static_g.selectAll('.yline')
        .data(self.yticks)
        .enter()
        .append('line')
          .attr('class', 'yline')
          .attr('x1', 0)
          .attr('x2', self.sgb.display_w)
          .attr('y1', d => self.yscale(d))
          .attr('y2', d => self.yscale(d))
          .attr('stroke', 'black')
          .attr('stroke-width', d => (d == self.yticks[0] || d == self.yticks[self.yticks.length - 1]) ? 1 : 0.25);

      const yAxis = d3.axisLeft(self.yscale)
        .tickValues(self.yticks)
        .tickSize(0);

      if (self.ytick_formatter) yAxis.tickFormat(self.ytick_formatter);

      self.axis_elements = self.static_g.append('g');

      self.axis_elements.append('rect')
        .attr('x', self.sgb.w)
        .attr('width', self.left_buf)
        .attr('y', 0)
        .attr('height', self.h)
        .attr('fill', 'white');

      self.axis_elements.append('g')
        .attr('class', 'yaxis')
        .attr("transform", `translate(${self.sgb.w + self.left_buf},0)`)
        .call(yAxis);

      if (self.title) {
        self.axis_elements.append('text')
          .attr('class', 'countPlotTitle')
          .attr("y", self.yscale(self.yticks[self.yticks.length - 1]) - 5)
          .attr("x", self.sgb.display_w / 2)
          .html(self.title);
      }
    }

    self.canvas_div = self.div.append('div')
      .attr('id', 'canvasdiv')
      .style('z-index', 0);

    self.svg.style('z-index', 1);

    self.canvas = self.canvas_div.append('canvas')
      .attr('width', self.sgb.display_w)
      .attr('height', self.h)
      .style('position', 'absolute')
      .style('left', '0px')
      .style('top', '0px');

    self.ctx = self.canvas.node().getContext('2d');

    self.pixelMap = null;

    self.svg
      .on('mousemove', (event) => self.handleMousemove(event))
      .on('mouseleave', () => self.handleMouseout())
      .on('click', (event) => self.handleClick(event));
  }

  resize() {
    super.resize();
    this.canvas.attr('width', this.sgb.display_w);
    this.static_g.selectAll('.yline').attr('x2', this.sgb.display_w);
    if (this.axis_elements) {
      this.axis_elements.select('rect')
        .attr('x', this.sgb.w)
        .attr('width', this.left_buf);
      this.axis_elements.select('.yaxis')
        .attr('transform', `translate(${this.sgb.w + this.left_buf},0)`);
      this.axis_elements.select('.countPlotTitle')
        .attr('x', this.sgb.display_w / 2);
    }
  }

  async load_region() {
    const self = this;
    const old_canvas = self.canvas;
    self.canvas = self.canvas_div.append('canvas')
      .attr('width', self.sgb.display_w)
      .attr('height', self.h)
      .style('position', 'absolute')
      .style('left', '0px')
      .style('top', '0px');

    self.ctx = self.canvas.node().getContext('2d');
    self.ctx.clearRect(0, 0, self.sgb.display_w, self.h);
    self.pixelMap = Array(self.sgb.display_w).fill(null).map(() => Array(self.h).fill(null));

    old_canvas.remove();

    if (self.ydomain == 'infer') {
      const filt_rows = self.get_rows();
      self.use_domain = d3.extent(filt_rows.map((r) => r[self.column]));
      if (self.use_domain[0] == self.use_domain[1]) self.use_domain = [0, 1];
      self.yscale = (self.clip) ? self.base_scale.range(self.yrange).clamp(true).domain(self.use_domain).nice() : self.base_scale.range(self.yrange).domain(self.use_domain).nice();
      self.yticks = (self.y_scale_type == 'linear') ? self.yscale.ticks(4) : self.yscale.ticks();
      self.yAxis = d3.axisLeft(self.yscale)
        .tickValues(self.yticks)
        .tickSize(5);

      if (self.y_scale_type != 'linear') {
        self.ytick_lines = nice_logcount_scale(self.yAxis, self.yscale);
      } else {
        self.ytick_lines = self.yticks;
      }

      self.static_g.selectAll('.yline').remove();
      self.static_g.selectAll('.yline')
        .data(self.ytick_lines)
        .enter()
        .append('line')
          .attr('class', 'yline')
          .attr('x1', 0)
          .attr('x2', self.sgb.display_w)
          .attr('y1', d => self.yscale(d))
          .attr('y2', d => self.yscale(d))
          .attr('stroke', 'black')
          .attr('stroke-width', d => (d == self.ytick_lines[0]) ? 1 : 0.25);

      if (self.axis_elements) self.axis_elements.remove();
      self.axis_elements = self.static_g.append('g');
      self.axis_elements.append('rect')
        .attr('x', self.sgb.w)
        .attr('width', self.left_buf)
        .attr('y', 0)
        .attr('height', self.h)
        .attr('fill', 'white');

      if (self.ytick_formatter) self.yAxis.tickFormat(self.ytick_formatter);

      self.axis_elements.append('g')
        .attr('class', 'yaxis')
        .attr("transform", `translate(${self.sgb.w + self.left_buf},0)`)
        .call(self.yAxis);

      self.axis_elements.append('text')
        .attr('class', 'countPlotTitle')
        .attr("y", self.yscale(self.yticks[self.yticks.length - 1]) - 5)
        .attr("x", self.sgb.display_w / 2)
        .html(self.title);
    }

    self.drawData();
  }

  handleMouseout() {
    if (this.mouseout_function) this.mouseout_function();
  }

  handleClick(event) {
    const self = this;
    if (Math.abs(self.sgb.x_change_mouse || 0) > 2) return;
    const [rawX, rawY] = d3.pointer(event, self.svg.node());
    const mouseX = Math.floor(rawX);
    const mouseY = Math.floor(rawY);
    if (self.pixelMap && mouseX >= 0 && mouseX < self.pixelMap.length && mouseY >= 0 && mouseY < self.pixelMap[0].length) {
      const pixelInfo = self.pixelMap[mouseX][mouseY];
      if (pixelInfo) {
        if (self.click_function) self.click_function(event, pixelInfo);
      }
    }
  }

  handleMousemove(event) {
    const self = this;
    const [rawX, rawY] = d3.pointer(event, self.svg.node());
    const mouseX = Math.floor(rawX);
    const mouseY = Math.floor(rawY);
    if (self.pixelMap && mouseX >= 0 && mouseX < self.pixelMap.length && mouseY >= 0 && mouseY < self.pixelMap[0].length) {
      const pixelInfo = self.pixelMap[mouseX][mouseY];
      if (pixelInfo) {
        if (self.hover_function) self.hover_function(event, pixelInfo);
        if (self.highlight_function) self.highlight_function(event, pixelInfo);
      } else {
        self.handleMouseout();
      }
    } else {
      self.handleMouseout();
    }
  }

  drawData() {
    throw new Error("drawData() must be implemented by child class");
  }
}

class quantitativePointTrack extends quantitativeYaxesTrack {
  /**
   * Extends `quantitativeYaxesTrack` to display quantitative data as points on a canvas.
   */
  constructor(sgb, name, column, config, contig_column, pos_column) {
    super(sgb, name, column, config, contig_column);
    this.pos_col = pos_column;
    this.pointRadius = config.pointRadius ?? 2;
    this.highlight_element = this.svg.append('circle')
      .attr('r', this.pointRadius * 3)
      .attr('fill', 'red')
      .style('pointer-events', 'none')
      .style('visibility', 'hidden');
  }

  drawData() {
    const self = this;
    const rows = self.get_rows();
    rows.forEach(d => {
      const x = self.sgb.get_coordinate_pixel_position(d[self.pos_col]);
      if (x >= 0 && x <= self.sgb.display_w) {
        const y = self.yscale(d[self.column]);
        self.ctx.fillStyle = (self.color_func) ? self.color_func(d, self.column) : "black";
        self.ctx.beginPath();
        self.ctx.arc(x, y, self.pointRadius, 0, 2 * Math.PI);
        self.ctx.fill();
        for (let px = Math.max(0, Math.floor(x - self.pointRadius)); px <= Math.min(self.sgb.display_w - 1, Math.ceil(x + self.pointRadius)); px++) {
          for (let py = Math.max(0, Math.floor(y - self.pointRadius)); py <= Math.min(self.h - 1, Math.ceil(y + self.pointRadius)); py++) {
            self.pixelMap[px][py] = { data: d, column: self.column };
          }
        }
      }
    });
  }

  highlight_function(event, pixelInfo) {
    const d = pixelInfo.data;
    for (const track of Object.values(this.sgb.data_map[this.data.name]).map(track_name => this.sgb.tracks[track_name])) {
      track.highlight_datum(d);
    }
  }

  highlight_datum(d) {
    const self = this;
    this.highlight_element
      .style('visibility', 'visible')
      .attr('cx', self.sgb.get_coordinate_pixel_position(d[self.pos_col]))
      .attr('cy', self.yscale(d[self.column]));
  }

  mouseout_function() {
    this.sgb.hide_tooltip();
    for (const track of Object.values(this.sgb.data_map[this.data.name]).map(track_name => this.sgb.tracks[track_name])) {
      track.highlight_element.style('visibility', 'hidden');
    }
  }

  hover_function(event, pixelInfo) {
    const d = pixelInfo.data;
    const column = pixelInfo.column;
    this.sgb.tooltip.selectAll('*').remove();
    this.sgb.tooltip.html(`${d[this.pos_col]}: ${column} = ${d[column]}`);
    this.sgb.show_tooltip(event.pageX, event.pageY);
  }
}

class quantitativeLineTrack extends quantitativeYaxesTrack {
  /**
   * Extends `quantitativeYaxesTrack` to display quantitative data as horizontal line segments on a canvas.
   */
  constructor(sgb, name, column, config, contig_column, start_column, end_column) {
    super(sgb, name, column, config, contig_column);
    this.start_col = start_column;
    this.end_col = end_column;
    this.lineWidth = config.lineWidth ?? 2;

    this.highlight_element = this.svg.append('line')
      .attr('stroke', 'red')
      .attr('stroke-width', this.lineWidth * 2)
      .style('pointer-events', 'none')
      .style('visibility', 'hidden');
  }

  drawData() {
    const self = this;
    const rows = self.get_rows();
    rows.forEach((d) => {
      const [x1, x2] = self.sgb.get_feature_pixel_position(d[self.start_col], d[self.end_col]);
      if ((x1 <= self.sgb.display_w && x1 >= 0)
            || (x2 <= self.sgb.display_w && x2 >= 0)
            || (x1 < 0 && x2 > self.sgb.display_w)) {
        const y = self.yscale(d[self.column]);
        self.ctx.strokeStyle = (self.color_func) ? self.color_func(d, self.column) : "black";
        self.ctx.lineWidth = self.lineWidth;
        self.ctx.beginPath();
        self.ctx.moveTo(Math.max(0, x1), y);
        self.ctx.lineTo(Math.min(self.sgb.display_w, x2), y);
        self.ctx.stroke();

        const startX = Math.max(0, Math.min(x1, x2));
        const endX = Math.min(self.sgb.display_w, Math.max(x1, x2));
        for (let px = Math.max(Math.floor(startX), 0); px <= Math.min(Math.ceil(endX), self.sgb.display_w - 1); px++) {
          for (let py = Math.max(0, Math.floor(y - self.lineWidth)); py <= Math.min(self.h - 1, Math.ceil(y + self.lineWidth)); py++) {
            self.pixelMap[px][py] = { data: d, column: self.column };
          }
        }
      }
    });
  }

  highlight_function(event, pixelInfo) {
    const d = pixelInfo.data;
    for (const track of Object.values(this.sgb.data_map[this.data.name]).map(track_name => this.sgb.tracks[track_name])) {
      track.highlight_datum(d);
    }
  }

  highlight_datum(d) {
    const self = this;
    const [x1, x2] = self.sgb.get_feature_pixel_position(d[self.start_col], d[self.end_col]);
    const y = self.yscale(d[self.column]);
    this.highlight_element
      .style('visibility', 'visible')
      .attr('x1', x1)
      .attr('x2', x2)
      .attr('y1', y)
      .attr('y2', y);
  }

  mouseout_function() {
    this.sgb.hide_tooltip();
    for (const track of Object.values(this.sgb.data_map[this.data.name]).map(track_name => this.sgb.tracks[track_name])) {
      track.highlight_element.style('visibility', 'hidden');
    }
  }

  hover_function(event, pixelInfo) {
    const d = pixelInfo.data;
    const column = pixelInfo.column;
    this.sgb.tooltip.selectAll('*').remove();
    this.sgb.tooltip.html(`${d[this.start_col]}-${d[this.end_col]}: ${column} = ${d[column]}`);
    this.sgb.show_tooltip(event.pageX, event.pageY);
  }
}

class seqTrack extends baseTrack {
  /**
   * Displays the nucleotide sequence of the browser's current contig at three zoom levels:
   * 1. Zoomed out (`domain_wid > color_threshold`): Empty track.
   * 2. Medium zoom (`text_threshold < domain_wid <= color_threshold`): Colored bars for each basepair on a canvas.
   * 3. Zoomed in (`domain_wid <= text_threshold`): Colored blocks along with selectable ATCG text.
   *
   * @param {SimpleGenomeBrowser} sgb - The SimpleGenomeBrowser instance this track belongs to.
   * @param {string} [name='Sequence'] - The name of the track.
   * @param {object} [config={}] - Optional configuration object.
   * @param {number} [config.track_h=24] - Height of the track in pixels.
   * @param {number} [config.color_threshold=1500] - Maximum domain width (bp) to render basepair colors.
   * @param {number} [config.text_threshold=150] - Maximum domain width (bp) to render selectable ATCG letters.
   * @param {object} [config.base_colors] - Map of nucleotide letter (A, T, C, G, N) to CSS color string.
   */
  constructor(sgb, name = 'Sequence', config = {}) {
    super(sgb, name, Object.assign({ load_threshold: Infinity }, config));
    this.data_name = null;
    this.track_h = config.track_h ?? 24;
    this.color_threshold = config.color_threshold ?? 1500;
    this.text_threshold = config.text_threshold ?? 150;
    this.base_colors = Object.assign({
      A: '#66cc66',
      T: '#ff6666',
      G: '#ffbb44',
      C: '#6699ff',
      N: '#cccccc'
    }, config.base_colors || {});

    this.init_canvas(this.track_h);
  }

  load_region() {
    const self = this;
    self.ctx.clearRect(0, 0, self.sgb.display_w, self.track_h);
    self.g.selectAll('*').remove();

    // 1. Zoomed out: leave empty
    if (self.sgb.domain_wid > self.color_threshold) {
      return;
    }

    const seq = self.sgb.seqs[self.sgb.contig] || '';
    const L = self.sgb.contig_len;
    if (!seq || !L) return;

    // Visible range across the 3X pre-rendered width [0, display_w]
    const [raw_start, raw_end] = self.sgb.get_rendered_coordinate_range();
    const start_c = Math.floor(raw_start);
    const end_c = Math.ceil(raw_end);
    const show_text = self.sgb.domain_wid <= self.text_threshold;
    const tspans = [];

    for (let coord = start_c; coord <= end_c; coord++) {
      if (!self.sgb.circular && (coord < 1 || coord > L)) continue;
      const idx = self.sgb.circular ? self.sgb.circular_coordinate(coord - 1) : (coord - 1);
      const base = (seq[idx] || 'N').toUpperCase();
      const x1 = self.sgb.x_scale(coord) + self.sgb.w;
      const x2 = self.sgb.x_scale(coord + 1) + self.sgb.w;
      if (x2 < 0 || x1 > self.sgb.display_w) continue;

      // 2. Medium & high zoom: draw colored basepair block on canvas
      self.ctx.fillStyle = self.base_colors[base] || self.base_colors.N;
      self.ctx.fillRect(x1, 0, Math.max(1, x2 - x1), self.track_h);

      if (show_text) {
        const cx = (x1 + x2) / 2;
        tspans.push(`<tspan x="${cx.toFixed(2)}">${base}</tspan>`);
      }
    }

    // 3. Zoomed in: render selectable ATCG text on top of colored blocks
    if (show_text && tspans.length > 0) {
      const bp_px = Math.abs(self.sgb.x_scale(1) - self.sgb.x_scale(0));
      const font_size = Math.min(self.track_h - 4, Math.max(8, Math.floor(bp_px * 0.85)));
      self.g.append('text')
        .attr('class', 'sgb_seq_text')
        .attr('y', self.track_h / 2)
        .attr('dominant-baseline', 'central')
        .attr('text-anchor', 'middle')
        .attr('font-family', 'monospace')
        .attr('font-weight', 'bold')
        .attr('font-size', `${font_size}px`)
        .attr('fill', '#111')
        .style('user-select', 'text')
        .style('-webkit-user-select', 'text')
        .style('cursor', 'text')
        .on('mousedown', (e) => e.stopPropagation())
        .html(tspans.join(''));
    }
  }
}

const ALIGN_BASE_COLORS = {
  A: '#4665C9',
  T: '#C2AA23',
  G: '#5FB152',
  C: '#B1362D',
  N: '#777777'
};

const ALIGN_FEATURE_COLORS = {
  match_fwd: '#9a9fa6',
  match_rev: '#8b96a8',
  deletion: '#E4691D',
  insertion: '#0096C7',
  soft_clip: '#222222'
};

class alignmentTrack extends baseFeatureTrack {
  /**
   * General-purpose alignment track supporting normalized alignments from SAM/BAM (`minimap2`, `bwa`),
   * PAF (`minimap2 -c`), BLAST/MMseqs2 tabular (`outfmt 6`), or custom interval/diff objects.
   *
   * Features:
   * - Accepts pre-parsed alignment arrays, raw SAM/PAF/BLAST6 text, or a URL to load asynchronously.
   * - Supports base-level differences via `diffs`, `cs:Z:` tags, `CIGAR` + `SEQ`, or `CIGAR` + `MD:Z:`.
   * - Renders interval-only alignments (e.g., BLAST6 or basic PAF) cleanly with strand direction and identity info.
   * - Links split reads / paired-end mates sharing `group_id` on the same subtrack row with a dashed connector.
   * - Includes a top coverage depth sparkline, $O(1)$ subtrack hover/click lookup, and SGB tooltip/sidebar integration.
   */
  constructor(sgb, name = 'Alignments', config = {}, alignments_or_url = []) {
    super(sgb, name, Object.assign({ load_threshold: Infinity }, config), 'contig', 'start', 'end', 'id');
    const self = this;

    self.block_h = config.block_h ?? 14;
    self.padding = config.padding ?? 4;
    self.row_stride = self.block_h + self.padding;
    self.coverage_h = config.show_coverage === false ? 0 : (config.coverage_h ?? 28);
    self.reads_top = self.coverage_h > 0 ? self.coverage_h + 6 : 4;
    self.max_subtracks = config.max_subtracks ?? 25;
    self.show_all_subtracks = Boolean(config.show_all_subtracks);
    self.show_soft_clips = Boolean(config.show_soft_clips);
    self.text_threshold = config.text_threshold ?? 150;
    self.min_distance = config.min_distance ?? 15;

    self.make_color_legend({
      'Match (+)': ALIGN_FEATURE_COLORS.match_fwd,
      'Match (-)': ALIGN_FEATURE_COLORS.match_rev,
      'A mismatch': ALIGN_BASE_COLORS.A,
      'T mismatch': ALIGN_BASE_COLORS.T,
      'G mismatch': ALIGN_BASE_COLORS.G,
      'C mismatch': ALIGN_BASE_COLORS.C,
      'Insertion': ALIGN_FEATURE_COLORS.insertion,
      'Deletion': ALIGN_FEATURE_COLORS.deletion,
      'Soft clip': ALIGN_FEATURE_COLORS.soft_clip
    }, { title: 'Key' });

    self.soft_clip_btn = self.add_controls_button(
      self.show_soft_clips ? 'Hide soft clips' : 'Show soft clips',
      () => {
        self.show_soft_clips = !self.show_soft_clips;
        self.soft_clip_btn.text(self.show_soft_clips ? 'Hide soft clips' : 'Show soft clips');
        self.display_region();
      }
    );

    self.subtrack_btn = self.add_controls_button('', () => {
      self.show_all_subtracks = !self.show_all_subtracks;
      self.update_subtrack_button();
      self.recalculate_height();
      self.display_region();
    });

    self.info_span = self.controls_div.append('span')
      .style('font-size', '12px')
      .style('color', '#555')
      .style('margin-left', '4px');

    self.highlightRect = self.g.append('rect')
      .attr('class', 'sgb_alignment_highlight')
      .attr('fill', 'none')
      .attr('stroke', '#ff2222')
      .attr('stroke-width', 2)
      .style('pointer-events', 'none')
      .style('visibility', 'hidden');

    self.svg
      .on('mousemove', (event) => self.handleMousemove(event))
      .on('mouseleave', () => self.handleMouseout())
      .on('click', (event) => self.handleClick(event));

    self.drawn_by_subtrack = [];
    self.coverage_bins = null;
    self.max_cov_in_view = 0;

    if (typeof alignments_or_url === 'string' && !alignments_or_url.includes('\n') && !alignments_or_url.includes('\t')) {
      self.set_alignments([]);
      self.loadingPromise = load_alignments(alignments_or_url, config.format || 'auto').then(parsed => {
        self.set_alignments(parsed);
        self.display_region();
        return self;
      });
    } else {
      const parsed = Array.isArray(alignments_or_url)
        ? alignments_or_url
        : parse_alignments(alignments_or_url, config.format || 'auto');
      self.set_alignments(parsed);
      self.loadingPromise = Promise.resolve(self);
    }
  }

  /**
   * Normalize and set alignments on this track, packing subtracks if not already assigned.
   */
  set_alignments(alignments) {
    const self = this;
    const list = Array.isArray(alignments) ? alignments : [];

    let needs_packing = false;
    for (const a of list) {
      if (a.contig === undefined && a.rname !== undefined) a.contig = a.rname;
      if (a.rname === undefined && a.contig !== undefined) a.rname = a.contig;
      if (a.start === undefined && a.pos !== undefined) a.start = a.pos;
      if (a.pos === undefined && a.start !== undefined) a.pos = a.start;
      if (a.id === undefined && a.qname !== undefined) a.id = a.qname;
      if (a.qname === undefined && a.id !== undefined) a.qname = a.id;
      if (a.strand === undefined) a.strand = (a.flag && (a.flag & 0x10)) ? '-' : '+';
      if (a.group_id === undefined) a.group_id = a.id;
      if (a.subtrack === undefined) needs_packing = true;
    }

    if (needs_packing && list.length > 0) {
      assign_subtracks(list, self.min_distance);
    }

    self.alignments = list;
    self.total_subtracks = self.alignments.length > 0
      ? Math.max(...self.alignments.map(a => a.subtrack || 0), 0) + 1
      : 1;

    self.data_name = self.name + '_data';
    const alignment_table = self.alignments.length > 0
      ? aq.from(self.alignments)
      : aq.table({ contig: [], start: [], end: [], id: [] });

    self.data = new staticFeatureData(self.sgb, self.data_name, alignment_table, {
      contig_col: 'contig',
      start_col: 'start',
      end_col: 'end'
    });
    self.sgb.data[self.data_name] = self.data;
    if (!self.sgb.data_map[self.data_name]) {
      self.sgb.data_map[self.data_name] = [];
    }
    if (!self.sgb.data_map[self.data_name].includes(self.name)) {
      self.sgb.data_map[self.data_name].push(self.name);
    }
    self.data.filter_by_contig();
    self.data.update_data();

    self.update_subtrack_button();
    self.recalculate_height();
  }

  update_subtrack_button() {
    if (!this.subtrack_btn) return;
    if (this.total_subtracks <= this.max_subtracks) {
      this.subtrack_btn.style('display', 'none');
    } else {
      this.subtrack_btn.style('display', 'block');
      this.subtrack_btn.text(
        this.show_all_subtracks
          ? `Cap at ${this.max_subtracks} rows (showing ${this.total_subtracks})`
          : `Show all ${this.total_subtracks} rows (capped at ${this.max_subtracks})`
      );
    }
  }

  recalculate_height() {
    const displayed_rows = this.show_all_subtracks
      ? this.total_subtracks
      : Math.min(this.total_subtracks, this.max_subtracks);
    this.displayed_rows = Math.max(1, displayed_rows);
    this.canvas_h = this.reads_top + this.displayed_rows * this.row_stride + 8;
    this.init_canvas(this.canvas_h);
  }

  parseCigar(cigarString) {
    const operations = [];
    const cigarRegex = /(\d+)([MIDNSHPX=B])/g;
    let match;
    while ((match = cigarRegex.exec(cigarString)) !== null) {
      operations.push({
        length: parseInt(match[1], 10),
        op: match[2]
      });
    }
    return operations;
  }

  /**
   * Expand base-level differences for an alignment once and cache on `alignment._features` and `alignment._stats`.
   * Supports:
   * 1. Pre-supplied `alignment.diffs`
   * 2. `minimap2` `cs:Z:` difference string (`alignment.cs`)
   * 3. `CIGAR` (`alignment.cigar`) + `SEQ` (`alignment.seq`) or `MD:Z:` (`alignment.md`)
   * 4. Interval-only alignments (PAF/BLAST6 without base-level tags)
   */
  getExpandedFeatures(alignment, referenceSeq) {
    if (alignment._features) {
      return alignment._features;
    }

    const features = [];
    const refLen = referenceSeq ? referenceSeq.length : 0;
    const stats = {
      matches: 0,
      mismatches: 0,
      insertions: 0,
      inserted_bp: 0,
      deletions: 0,
      deleted_bp: 0,
      soft_clip_left: 0,
      soft_clip_right: 0,
      identity: alignment.identity ?? null
    };

    // Case 1: Custom precomputed diffs array
    if (Array.isArray(alignment.diffs)) {
      for (const d of alignment.diffs) {
        const feat = Object.assign({}, d);
        if (feat.type === 'substitution') {
          stats.mismatches++;
          feat.start = feat.start ?? feat.pos;
          feat.end = feat.end ?? (feat.start + 1);
          feat.pos = feat.pos ?? feat.start;
          feat.color = feat.color || ALIGN_BASE_COLORS[feat.query_base] || ALIGN_BASE_COLORS.N;
        } else if (feat.type === 'insertion') {
          stats.insertions++;
          stats.inserted_bp += feat.length || (feat.sequence ? feat.sequence.length : 1);
          feat.color = feat.color || ALIGN_FEATURE_COLORS.insertion;
        } else if (feat.type === 'deletion') {
          stats.deletions++;
          stats.deleted_bp += feat.length || (feat.end - feat.start);
          feat.color = feat.color || ALIGN_FEATURE_COLORS.deletion;
        } else if (feat.type === 'soft_clip' || feat.type === 'clip') {
          feat.type = 'soft_clip';
          feat.color = feat.color || ALIGN_FEATURE_COLORS.soft_clip;
        }
        features.push(feat);
      }
      alignment._features = features;
      alignment._stats = stats;
      return features;
    }

    // Case 2: minimap2 `cs:Z:` difference string (works even without SEQ or referenceSeq)
    if (alignment.cs && (!alignment.seq || alignment.seq === '*')) {
      const csRegex = /(:[0-9]+|\*[a-zA-Z]{2}|=[a-zA-Z]+|\+[a-zA-Z]+|-[a-zA-Z]+)/g;
      let refPos = alignment.start;
      let match;
      while ((match = csRegex.exec(alignment.cs)) !== null) {
        const token = match[1];
        const prefix = token[0];
        const body = token.slice(1);
        if (prefix === ':') {
          const len = parseInt(body, 10);
          stats.matches += len;
          refPos += len;
        } else if (prefix === '=') {
          const len = body.length;
          stats.matches += len;
          refPos += len;
        } else if (prefix === '*') {
          const refBase = body[0].toUpperCase();
          const queryBase = body[1].toUpperCase();
          stats.mismatches++;
          features.push({
            start: refPos,
            end: refPos + 1,
            pos: refPos,
            type: 'substitution',
            color: ALIGN_BASE_COLORS[queryBase] || ALIGN_BASE_COLORS.N,
            ref_base: refBase,
            query_base: queryBase
          });
          refPos += 1;
        } else if (prefix === '+') {
          const insSeq = body.toUpperCase();
          stats.insertions++;
          stats.inserted_bp += insSeq.length;
          features.push({
            start: refPos,
            end: refPos,
            length: insSeq.length,
            sequence: insSeq,
            type: 'insertion',
            color: ALIGN_FEATURE_COLORS.insertion
          });
        } else if (prefix === '-') {
          const delLen = body.length;
          stats.deletions++;
          stats.deleted_bp += delLen;
          features.push({
            start: refPos,
            end: refPos + delLen,
            length: delLen,
            type: 'deletion',
            color: ALIGN_FEATURE_COLORS.deletion
          });
          refPos += delLen;
        }
      }
      const totalAligned = stats.matches + stats.mismatches + stats.inserted_bp + stats.deleted_bp;
      if (stats.identity === null && totalAligned > 0) {
        stats.identity = ((stats.matches / totalAligned) * 100).toFixed(1);
      }
      alignment._features = features;
      alignment._stats = stats;
      return features;
    }

    // Case 3: CIGAR string (with optional SEQ or MD tag)
    if (alignment.cigar && alignment.cigar !== '*') {
      const operations = this.parseCigar(alignment.cigar);
      const hasSeq = Boolean(alignment.seq && alignment.seq !== '*');
      let refPos = alignment.start;
      let queryPos = 0;

      for (let opIdx = 0; opIdx < operations.length; opIdx++) {
        const op = operations[opIdx];
        const length = op.length;

        if (op.op === 'M' || op.op === '=' || op.op === 'X') {
          if (hasSeq && (op.op === 'X' || (op.op === 'M' && referenceSeq && refLen > 0))) {
            for (let i = 0; i < length; i++) {
              const coord = refPos + i;
              const queryBase = alignment.seq[queryPos + i] || 'N';
              let refBase = 'N';
              if (referenceSeq && refLen > 0) {
                const refIdx = ((coord - 1) % refLen + refLen) % refLen;
                refBase = referenceSeq[refIdx] || 'N';
              }
              if (op.op !== 'X' && queryBase === refBase) {
                stats.matches++;
              } else {
                stats.mismatches++;
                features.push({
                  start: coord,
                  end: coord + 1,
                  pos: coord,
                  type: 'substitution',
                  color: ALIGN_BASE_COLORS[queryBase] || ALIGN_BASE_COLORS.N,
                  query_base: queryBase,
                  ref_base: refBase
                });
              }
            }
          } else {
            stats.matches += length;
          }
          refPos += length;
          queryPos += length;
        } else if (op.op === 'D' || op.op === 'N') {
          stats.deletions++;
          stats.deleted_bp += length;
          features.push({
            start: refPos,
            end: refPos + length,
            length: length,
            type: 'deletion',
            color: ALIGN_FEATURE_COLORS.deletion
          });
          refPos += length;
        } else if (op.op === 'I') {
          stats.insertions++;
          stats.inserted_bp += length;
          const insertedSeq = hasSeq ? alignment.seq.substring(queryPos, queryPos + length) : `${length} bp`;
          features.push({
            start: refPos,
            end: refPos,
            length: length,
            sequence: insertedSeq,
            type: 'insertion',
            color: ALIGN_FEATURE_COLORS.insertion
          });
          queryPos += length;
        } else if (op.op === 'S') {
          const clipSeq = hasSeq ? alignment.seq.substring(queryPos, queryPos + length) : '';
          if (opIdx === 0) {
            stats.soft_clip_left = length;
            features.push({
              start: alignment.start - length,
              end: alignment.start,
              length: length,
              type: 'soft_clip',
              side: 'left',
              color: ALIGN_FEATURE_COLORS.soft_clip,
              sequence: clipSeq
            });
          } else {
            stats.soft_clip_right = length;
            features.push({
              start: refPos,
              end: refPos + length,
              length: length,
              type: 'soft_clip',
              side: 'right',
              color: ALIGN_FEATURE_COLORS.soft_clip,
              sequence: clipSeq
            });
          }
          queryPos += length;
        }
      }

      const totalAligned = stats.matches + stats.mismatches + stats.inserted_bp + stats.deleted_bp;
      if (stats.identity === null && totalAligned > 0) {
        stats.identity = ((stats.matches / totalAligned) * 100).toFixed(1);
      }
    } else if (alignment.meta) {
      stats.mismatches = alignment.meta.mismatch ?? alignment.meta.nm ?? 0;
      stats.deletions = alignment.meta.gapopen ?? 0;
    }

    alignment._features = features;
    alignment._stats = stats;
    return features;
  }

  load_region() {
    const self = this;
    const display_w = self.sgb.display_w;

    if (!self.canvas || Number(self.canvas.attr('width')) !== display_w || Number(self.canvas.attr('height')) !== self.canvas_h) {
      self.init_canvas(self.canvas_h);
    } else {
      self.ctx.clearRect(0, 0, display_w, self.canvas_h);
    }

    self.static_g.selectAll('*').remove();
    self.g.selectAll('.sgb_align_text').remove();
    self.highlightRect.style('visibility', 'hidden');

    const filt_alignments = self.get_rows();
    const refSeq = (self.sgb.seqs && self.sgb.seqs[self.sgb.contig])
      ? self.sgb.seqs[self.sgb.contig].toUpperCase()
      : null;

    const hidden_reads = filt_alignments.filter(a => a.subtrack >= self.displayed_rows).length;
    self.info_span.text(
      hidden_reads > 0
        ? `(${filt_alignments.length} alignments in region; ${hidden_reads} in hidden rows)`
        : `(${filt_alignments.length} alignments in region)`
    );

    // 1. Coverage depth sparkline across [0, display_w]
    if (self.coverage_h > 0) {
      const cov = new Int32Array(display_w);
      for (const alignment of filt_alignments) {
        const [x1, x2] = self.sgb.get_feature_pixel_position(alignment.start, alignment.end);
        const startPx = Math.max(0, Math.floor(Math.min(x1, x2)));
        const endPx = Math.min(display_w, Math.ceil(Math.max(x1, x2)));
        for (let px = startPx; px < endPx; px++) {
          cov[px]++;
        }
      }
      self.coverage_bins = cov;

      let maxCov = 0;
      for (let px = 0; px < display_w; px++) {
        if (cov[px] > maxCov) maxCov = cov[px];
      }
      self.max_cov_in_view = maxCov;

      self.ctx.fillStyle = '#f3f5f8';
      self.ctx.fillRect(0, 0, display_w, self.coverage_h);
      self.ctx.strokeStyle = '#d0d7de';
      self.ctx.lineWidth = 1;
      self.ctx.beginPath();
      self.ctx.moveTo(0, self.coverage_h + 0.5);
      self.ctx.lineTo(display_w, self.coverage_h + 0.5);
      self.ctx.stroke();

      if (maxCov > 0) {
        self.ctx.fillStyle = '#6c8ebf';
        for (let px = 0; px < display_w; px++) {
          const c = cov[px];
          if (c > 0) {
            const barH = Math.max(1, Math.round((c / maxCov) * (self.coverage_h - 4)));
            self.ctx.fillRect(px, self.coverage_h - barH, 1, barH);
          }
        }
      }

      self.static_g.append('rect')
        .attr('x', self.sgb.w + 4)
        .attr('y', 2)
        .attr('width', 115)
        .attr('height', 16)
        .attr('rx', 3)
        .attr('fill', 'rgba(255,255,255,0.85)');

      self.static_g.append('text')
        .attr('x', self.sgb.w + 8)
        .attr('y', 13)
        .attr('font-size', '10px')
        .attr('font-family', 'sans-serif')
        .attr('fill', '#333')
        .text(`Coverage (max: ${maxCov}x)`);
    }

    // 2. Draw alignments and bucket by subtrack
    self.drawn_by_subtrack = Array.from({ length: self.displayed_rows }, () => []);
    const show_text = self.sgb.domain_wid <= self.text_threshold;
    const tspans = [];

    for (const alignment of filt_alignments) {
      const sub = alignment.subtrack ?? 0;
      if (sub >= self.displayed_rows) continue;

      const features = self.getExpandedFeatures(alignment, refSeq);
      const y = self.reads_top + sub * self.row_stride;
      const [alignLeft, alignRight] = self.sgb.get_feature_pixel_position(alignment.start, alignment.end);
      if (alignRight < 0 || alignLeft > display_w) continue;

      const feature_hit_boxes = [];
      const bodyW = Math.max(1, alignRight - alignLeft);
      self.ctx.fillStyle = alignment.strand === '-' ? ALIGN_FEATURE_COLORS.match_rev : ALIGN_FEATURE_COLORS.match_fwd;
      self.ctx.fillRect(alignLeft, y, bodyW, self.block_h);

      for (const feature of features) {
        if (feature.type === 'insertion' || feature.type === 'match') continue;

        if (feature.type === 'soft_clip') {
          if (!self.show_soft_clips) {
            const stubX = feature.side === 'left' ? Math.max(0, alignLeft - 3) : alignRight;
            self.ctx.fillStyle = ALIGN_FEATURE_COLORS.soft_clip;
            self.ctx.fillRect(stubX, y, 3, self.block_h);
            feature_hit_boxes.push({ left: stubX - 2, right: stubX + 5, feature });
            continue;
          }
          const [left, right] = self.sgb.get_feature_pixel_position(feature.start, feature.end);
          const w = Math.max(2, right - left);
          self.ctx.fillStyle = 'rgba(30, 30, 30, 0.75)';
          self.ctx.fillRect(left, y + 2, w, self.block_h - 4);
          feature_hit_boxes.push({ left, right: left + w, feature });
          continue;
        }

        const [left, right] = self.sgb.get_feature_pixel_position(feature.start, feature.end);
        const w = Math.max(1.5, right - left);

        if (feature.type === 'deletion') {
          self.ctx.clearRect(left, y, w, self.block_h);
          self.ctx.fillStyle = ALIGN_FEATURE_COLORS.deletion;
          self.ctx.fillRect(left, y + Math.floor(self.block_h * 0.25), w, Math.ceil(self.block_h * 0.5));
          feature_hit_boxes.push({ left: left - 1, right: left + w + 1, feature });
        } else if (feature.type === 'substitution') {
          self.ctx.fillStyle = feature.color;
          self.ctx.fillRect(left, y, w, self.block_h);
          feature_hit_boxes.push({ left: left - 1, right: left + w + 1, feature });

          if (show_text && (right - left) >= 6 && feature.query_base) {
            const cx = (left + right) / 2;
            const cy = y + self.block_h / 2;
            tspans.push(`<tspan x="${cx.toFixed(1)}" y="${cy.toFixed(1)}">${escape_svg_text(feature.query_base)}</tspan>`);
          }
        }
      }

      // Draw insertions on top as crisp I-beam markers
      for (const feature of features) {
        if (feature.type !== 'insertion') continue;
        const px = self.sgb.get_coordinate_pixel_position(feature.start, true);
        if (px < 0 || px > display_w) continue;

        const stemW = 2;
        const capW = 6;
        self.ctx.fillStyle = feature.color;
        self.ctx.fillRect(px - stemW / 2, y - 1, stemW, self.block_h + 2);
        self.ctx.fillRect(px - capW / 2, y - 1, capW, 2);
        self.ctx.fillRect(px - capW / 2, y + self.block_h - 1, capW, 2);

        feature_hit_boxes.push({ left: px - 4, right: px + 4, feature });
      }

      let hitLeft = alignLeft;
      let hitRight = alignRight;
      for (const hb of feature_hit_boxes) {
        if (hb.left < hitLeft) hitLeft = hb.left;
        if (hb.right > hitRight) hitRight = hb.right;
      }

      self.drawn_by_subtrack[sub].push({
        alignment,
        left: alignLeft,
        right: alignRight,
        hitLeft,
        hitRight,
        y,
        feature_hit_boxes
      });
    }

    // 3. Draw dashed connector lines between split segments / paired mates on the same subtrack
    self.ctx.save();
    self.ctx.strokeStyle = '#666';
    self.ctx.lineWidth = 1;
    self.ctx.setLineDash([3, 3]);
    for (let sub = 0; sub < self.drawn_by_subtrack.length; sub++) {
      const rowItems = self.drawn_by_subtrack[sub];
      if (rowItems.length < 2) continue;
      for (let i = 0; i < rowItems.length - 1; i++) {
        const a = rowItems[i];
        const b = rowItems[i + 1];
        if (a.alignment.group_id && a.alignment.group_id === b.alignment.group_id && a.right < b.left) {
          const midY = a.y + self.block_h / 2;
          self.ctx.beginPath();
          self.ctx.moveTo(a.right, midY);
          self.ctx.lineTo(b.left, midY);
          self.ctx.stroke();
        }
      }
    }
    self.ctx.restore();

    if (show_text && tspans.length > 0) {
      const bp_px = Math.abs(self.sgb.x_scale(1) - self.sgb.x_scale(0));
      const font_size = Math.min(self.block_h - 2, Math.max(8, Math.floor(bp_px * 0.85)));
      self.g.append('text')
        .attr('class', 'sgb_align_text')
        .attr('dominant-baseline', 'central')
        .attr('text-anchor', 'middle')
        .attr('font-family', 'monospace')
        .attr('font-weight', 'bold')
        .attr('font-size', `${font_size}px`)
        .attr('fill', '#ffffff')
        .style('pointer-events', 'none')
        .html(tspans.join(''));
    }
  }

  getHitAt(mouseX, mouseY) {
    if (mouseX < 0 || mouseX >= this.sgb.display_w || mouseY < 0) return null;

    if (this.coverage_h > 0 && mouseY <= this.coverage_h) {
      const px = Math.floor(mouseX);
      const depth = this.coverage_bins ? this.coverage_bins[px] : 0;
      const coord = Math.round(this.sgb.get_pixel_coordinate(mouseX, true));
      return { type: 'coverage', depth, coord };
    }

    const relY = mouseY - this.reads_top;
    if (relY < 0) return null;
    const sub = Math.floor(relY / this.row_stride);
    const offsetInRow = relY - sub * this.row_stride;
    if (sub < 0 || sub >= this.drawn_by_subtrack.length || offsetInRow > this.block_h + 2) {
      return null;
    }

    const rowItems = this.drawn_by_subtrack[sub];
    for (let i = 0; i < rowItems.length; i++) {
      const item = rowItems[i];
      if (mouseX >= item.hitLeft && mouseX <= item.hitRight) {
        let matchedFeature = null;
        for (let j = item.feature_hit_boxes.length - 1; j >= 0; j--) {
          const hb = item.feature_hit_boxes[j];
          if (mouseX >= hb.left && mouseX <= hb.right) {
            matchedFeature = hb.feature;
            break;
          }
        }
        return {
          type: 'alignment',
          alignment: item.alignment,
          feature: matchedFeature,
          item
        };
      }
    }
    return null;
  }

  handleMousemove(event) {
    const self = this;
    const [mouseX, mouseY] = d3.pointer(event, self.svg.node());
    const hit = self.getHitAt(mouseX, mouseY);

    if (!hit) {
      self.highlightRect.style('visibility', 'hidden');
      self.sgb.hide_tooltip();
      return;
    }

    if (hit.type === 'coverage') {
      self.highlightRect.style('visibility', 'hidden');
      self.sgb.show_tooltip(
        event.pageX,
        event.pageY,
        `<div class="gene_tooltip">
          <p><strong>Position:</strong> ${hit.coord.toLocaleString()} bp</p>
          <p><strong>Read Depth:</strong> ${hit.depth}x</p>
        </div>`
      );
      return;
    }

    const { alignment, feature, item } = hit;
    self.highlightRect
      .attr('x', item.left)
      .attr('y', item.y)
      .attr('width', Math.max(2, item.right - item.left))
      .attr('height', self.block_h)
      .style('visibility', 'visible');

    const stats = alignment._stats || {};
    const identityVal = stats.identity ?? alignment.identity ?? '-';
    const scoreLabel = alignment.format === 'blast6' ? 'Bitscore' : 'MAPQ';
    const scoreVal = alignment.score ?? alignment.mapq ?? '-';
    const qLen = alignment.query_len ?? alignment.seq_length ?? (alignment.end - alignment.start);

    let featureHtml = '';
    if (feature) {
      if (feature.type === 'substitution') {
        featureHtml = `<p style="color:#b1362d;"><strong>Mismatch (${feature.pos.toLocaleString()}):</strong> Ref ${escape_svg_text(feature.ref_base)} &rarr; Query ${escape_svg_text(feature.query_base)}</p>`;
      } else if (feature.type === 'insertion') {
        const preview = feature.sequence && feature.sequence.length > 24 ? feature.sequence.slice(0, 24) + '...' : (feature.sequence || '');
        featureHtml = `<p style="color:#0077b6;"><strong>Insertion (${feature.length} bp):</strong> <code>${escape_svg_text(preview)}</code></p>`;
      } else if (feature.type === 'deletion') {
        featureHtml = `<p style="color:#d95f02;"><strong>Deletion:</strong> ${feature.length} bp (${feature.start.toLocaleString()}..${(feature.end - 1).toLocaleString()})</p>`;
      } else if (feature.type === 'soft_clip') {
        featureHtml = `<p><strong>Soft clip (${feature.side}):</strong> ${feature.length} bp (click read for details)</p>`;
      }
    }

    const html = `
      <div class="gene_tooltip">
        <p><strong>Query:</strong> ${escape_svg_text(alignment.id)}</p>
        <p><strong>Ref Span:</strong> ${alignment.start.toLocaleString()}..${(alignment.end - 1).toLocaleString()} (${alignment.strand})</p>
        <p><strong>Length:</strong> ${qLen.toLocaleString()} bp | <strong>${scoreLabel}:</strong> ${scoreVal} | <strong>Identity:</strong> ${identityVal}%</p>
        ${featureHtml}
      </div>
    `;
    self.sgb.show_tooltip(event.pageX, event.pageY, html);
  }

  handleMouseout() {
    this.highlightRect.style('visibility', 'hidden');
    this.sgb.hide_tooltip();
  }

  handleClick(event) {
    const self = this;
    if (Math.abs(self.sgb.x_change_mouse || 0) > 2) return;
    const [mouseX, mouseY] = d3.pointer(event, self.svg.node());
    const hit = self.getHitAt(mouseX, mouseY);
    if (!hit || hit.type !== 'alignment') return;

    self.show_alignment_sidebar(hit.alignment, hit.feature);
  }

  show_alignment_sidebar(alignment, clickedFeature = null) {
    const sgb = this.sgb;
    const stats = alignment._stats || {};
    sgb.sidebar_div.selectAll('*').remove();

    sgb.sidebar_div.append('p')
      .attr('class', 'sidebar_title')
      .style('margin-bottom', '5px')
      .style('word-break', 'break-all')
      .html(`<strong>${escape_svg_text(alignment.id)}</strong>`);

    sgb.sidebar_div.append('hr')
      .style('border-top', '4px solid #333');

    const alignType = alignment.is_supplementary
      ? 'Supplementary (split)'
      : alignment.is_secondary
        ? 'Secondary'
        : 'Primary';

    const scoreLabel = alignment.format === 'blast6' ? 'Bitscore:' : 'MAPQ:';
    const scoreVal = alignment.score ?? alignment.mapq ?? '-';
    const qLen = alignment.query_len ?? alignment.seq_length ?? (alignment.end - alignment.start);
    const identityVal = stats.identity ?? alignment.identity ?? '-';

    const rows = [
      ['Contig:', alignment.contig],
      ['Ref Span:', `${alignment.start.toLocaleString()}..${(alignment.end - 1).toLocaleString()} bp (${(alignment.end - alignment.start).toLocaleString()} bp)`],
      ['Strand:', alignment.strand],
      ['Query Length:', `${qLen.toLocaleString()} bp`]
    ];

    if (alignment.query_start && alignment.query_end) {
      rows.push(['Query Span:', `${alignment.query_start.toLocaleString()}..${alignment.query_end.toLocaleString()} bp`]);
    }
    rows.push(
      [scoreLabel, scoreVal],
      ['Identity:', `${identityVal}%`],
      ['Type:', alignType],
      ['Mismatches:', stats.mismatches ?? 0],
      ['Insertions:', `${stats.insertions ?? 0} (${stats.inserted_bp ?? 0} bp)`],
      ['Deletions:', `${stats.deletions ?? 0} (${stats.deleted_bp ?? 0} bp)`]
    );
    if (stats.soft_clip_left || stats.soft_clip_right) {
      rows.push(['Soft Clip (L / R):', `${stats.soft_clip_left ?? 0} bp / ${stats.soft_clip_right ?? 0} bp`]);
    }
    if (alignment.meta && alignment.meta.evalue !== undefined) {
      rows.push(['E-value:', alignment.meta.evalue]);
    }

    sgb.sidebar_div.selectAll('.sidebar_info_row')
      .data(rows)
      .enter()
      .append('p')
      .attr('class', 'sidebar_info_row')
      .style('margin', '4px 0')
      .html(d => `<strong>${d[0]}</strong> ${escape_svg_text(d[1])}`);

    if (clickedFeature && clickedFeature.type === 'insertion' && clickedFeature.sequence) {
      const box = sgb.sidebar_div.append('div')
        .style('margin', '10px 0')
        .style('padding', '8px')
        .style('background', '#e6f7ff')
        .style('border', '1px solid #91d5ff')
        .style('border-radius', '4px');
      box.append('div')
        .style('font-weight', 'bold')
        .style('margin-bottom', '4px')
        .text(`Clicked Insertion (${clickedFeature.length} bp at ${clickedFeature.start.toLocaleString()}):`);
      box.append('button')
        .text('Copy Inserted Sequence')
        .on('click', function() {
          copy_sequence(clickedFeature.sequence, this);
        });
    }

    const btnContainer = sgb.sidebar_div.append('div')
      .style('display', 'flex')
      .style('flex-direction', 'column')
      .style('gap', '6px')
      .style('margin-top', '10px');

    if (alignment.seq && alignment.seq !== '*') {
      btnContainer.append('button')
        .text('Copy Full Read Sequence')
        .on('click', function() {
          copy_sequence(alignment.seq, this);
        });
    }

    const softClips = (alignment._features || []).filter(f => f.type === 'soft_clip' && f.sequence);
    for (const sc of softClips) {
      btnContainer.append('button')
        .text(`Copy ${sc.side === 'left' ? "5'/Left" : "3'/Right"} Soft-Clipped Seq (${sc.length} bp)`)
        .on('click', function() {
          copy_sequence(sc.sequence, this);
        });
    }

    sgb.show_sidebar(null, 360);
  }
}

export {
  baseTrack,
  baseFeatureTrack,
  geneTrack,
  seqTrack,
  alignmentTrack,
  quantitativeFeatureTrack,
  quantitativeYaxesTrack,
  quantitativePointTrack,
  quantitativeLineTrack,
  default_gene_tooltip_func,
  default_gene_sidebar_func
};