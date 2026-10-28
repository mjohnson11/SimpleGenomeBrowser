import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import autoComplete from 'https://cdn.jsdelivr.net/npm/@tarekraafat/autocomplete.js@10.2.7/dist/autoComplete.min.js/+esm';
import { copy_sequence, reverse_complement, parse_fasta } from "./util.js";


class SimpleGenomeBrowser {
  /**
   * Core interactive genome browser class.
   * Handles layout, controls (contig picker, search, zoom bars/buttons, copy buttons),
   * circular/linear coordinate navigation, dragging/scrolling, customizable sidebar & tooltip,
   * and track rendering.
   *
   * Constructor signature:
   *   new SimpleGenomeBrowser(seqs, circular_contigs, div, config)
   *
   * By default, browser width is responsive to `div`'s width via a ResizeObserver.
   * Pass `config.width` to use a fixed pixel width instead.
   *
   * @param {Object.<string, string>} seqs - Object mapping contig IDs to DNA sequences: {contig_id1: seq1, ...}.
   * @param {string[]|boolean|null} [circular_contigs=null] - List of contig IDs that are circular (defaults to all contigs if null/undefined/true).
   * @param {d3.Selection|Element|string} div - The container div element, D3 selection, or CSS selector string.
   * @param {object} [config={}] - Configuration object.
   * @param {number} [config.width] - Optional fixed width in pixels. If omitted, width updates automatically when `div` resizes.
   * @param {number|string} [config.height] - Optional fixed height for the browser (e.g. 600 or '80vh'). If omitted, height grows flexibly with tracks.
   * @param {string} [config.starting_contig] - Contig ID to initially display (defaults to first contig in seqs).
   * @param {number[]} [config.starting_domain] - Initial [start, end] coordinates to display.
   * @param {object} [config.layout] - Custom layout dimensions.
   * @param {object} [config.saved_state] - Arbitrary key/value state to include in share URLs.
   * @param {boolean} [config.sidebar_to_start=false] - Whether to open the sidebar initially.
   * @param {string} [config.title] - Optional title displayed above the controls.
   * @param {Object.<string, string>} [config.aa_seqs] - Optional map of locusId -> amino acid sequence.
   */
  constructor(seqs, circular_contigs = null, div, config = {}) {
    // Core data & track holders
    this.data = {};
    this.data_map = {}; // maps dataset name -> array of track names
    this.tracks = {};
    this._render_id = 0;

    this.div = (div && typeof div.append === 'function') ? div : d3.select(div);
    this.config = config || {};

    // Responsive width (default) vs fixed width
    this.fixed_width = (typeof this.config.width === 'number' && this.config.width > 0) ? this.config.width : null;
    this.responsive_width = (this.fixed_width === null);

    if (this.responsive_width) {
      this.div.style('width', '100%');
      this.original_w = this.get_container_width();
    } else {
      this.original_w = this.fixed_width;
      this.div.style('width', this.original_w + 'px');
    }
    this.w = this.original_w;

    // Optional metadata
    this.title = this.config.title ?? null;
    this.aa_seqs = this.config.aa_seqs ?? {};

    // Starting region
    this.starting_contig = this.config.starting_contig ?? null;
    this.starting_domain = this.config.starting_domain ?? null;

    // Layout configuration
    this.layout = Object.assign({
      top: 10,
      controls_h: 125,
      x_buf: 40,
      contig_axis_top: 35,
      contig_zoom_bar_top: 35,
      view_zoom_bar_top: 80,
      track_axis_top: 80,
      sidebar_w: 380,
      outer_button_h: 30
    }, this.config.layout || {});

    this.layout.x_range = [this.layout.x_buf, this.w - this.layout.x_buf];
    this.midpoint = this.w / 2;
    this.display_w = this.w * 3;
    this.display_left = -1 * this.w;

    this.sidebar_expanded = false;
    this.saved_state = this.config.saved_state ?? {};

    // Sequences and circularity
    this.seqs = (typeof seqs === 'object' && seqs !== null) ? seqs : {};
    this.seq_lens = Object.fromEntries(
      Object.entries(this.seqs).map(([k, v]) => [k, v.length])
    );

    if (Array.isArray(circular_contigs)) {
      this.circular_contigs = circular_contigs.map(String);
    } else if (circular_contigs === false) {
      this.circular_contigs = [];
    } else {
      this.circular_contigs = Object.keys(this.seqs).map(String);
    }

    this.setup_browser();
    this.setup_resize_observer();
    this.loadingPromise = Promise.resolve(this);
  }

  get_container_width() {
    const node = this.div ? this.div.node() : null;
    if (node) {
      const rect_w = Math.floor(node.getBoundingClientRect().width || node.clientWidth || 0);
      if (rect_w > 0) return rect_w;
    }
    return Math.max(320, window.innerWidth - 20);
  }

  setup_resize_observer() {
    if (!this.responsive_width || typeof ResizeObserver === 'undefined') return;
    const node = this.div ? this.div.node() : null;
    if (!node) return;

    this.resize_observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const new_container_w = Math.floor(entry.contentRect.width);
        if (new_container_w > 0 && Math.abs(new_container_w - this.original_w) >= 1) {
          this.original_w = new_container_w;
          const target_w = this.sidebar_expanded
            ? Math.max(200, this.original_w - this.current_sidebar_width)
            : this.original_w;
          this.resize(target_w);
        }
      }
    });
    this.resize_observer.observe(node);
  }

  setup_browser() {
    const contig_names = Object.keys(this.seqs);
    if (contig_names.length === 0) {
      throw new Error("SimpleGenomeBrowser requires at least one contig in `seqs`.");
    }
    if (!this.starting_contig || !(this.starting_contig in this.seqs)) {
      this.starting_contig = contig_names[0];
    }
    if (!this.starting_domain) {
      const len = this.seq_lens[this.starting_contig];
      this.starting_domain = [
        Math.floor(len / 4),
        Math.floor((5 * len) / 16)
      ];
    }

    this.contig = this.starting_contig;
    this.contig_len = this.seq_lens[this.contig];
    this.circular = this.circular_contigs.includes(String(this.contig));

    this.build_basic_browser();
    this.setup_tooltip();
    this.setup_sidebar();
    if (this.config.sidebar_to_start) this.show_sidebar();
  }

  // =========================================================================
  // Browser DOM Structure & Controls
  // =========================================================================

  build_basic_browser() {
    const self = this;

    // Outer flex container holding [sidebar | main_col_div]
    self.sgb_outer_div = self.div.append('div')
      .attr('class', 'sgb_outer_wrapper')
      .style('position', 'relative')
      .style('display', 'flex')
      .style('align-items', 'flex-start')
      .style('width', '100%');

    // Placeholder slot so sidebar appears on the left of main_col_div
    self.sidebar_slot = self.sgb_outer_div.append('div')
      .attr('class', 'sgb_sidebar_slot')
      .style('flex-shrink', '0')
      .style('position', 'sticky')
      .style('top', '10px');

    // Main browser column (controls bar + axes + tracks)
    self.main_col_div = self.sgb_outer_div.append('div')
      .attr('class', 'sgb_main_col')
      .style('position', 'relative')
      .style('width', self.w + 'px')
      .style('flex-shrink', '0');

    self.sgb_outer_buttons = self.main_col_div.append('div')
      .attr('class', 'sgb_controls_container')
      .style('position', 'relative')
      .style('width', self.w + 'px')
      .style('margin', '5px 0')
      .style('z-index', 20)
      .style('display', 'flex')
      .style('align-items', 'center')
      .style('justify-content', 'space-around')
      .style('gap', '8px');

    self.outer_div = self.main_col_div.append('div')
      .attr('class', 'sgb_outer_div')
      .style('position', 'relative')
      .style('width', self.w + 'px');

    // Optional fixed-height mode via config.height
    if (self.config.height) {
      const h_css = typeof self.config.height === 'number' ? `${self.config.height}px` : String(self.config.height);
      self.sgb_outer_div.style('height', h_css);
      self.sidebar_slot.style('height', '100%').style('position', 'relative').style('top', '0px');
      self.main_col_div
        .style('height', '100%')
        .style('display', 'flex')
        .style('flex-direction', 'column');
      self.outer_div
        .style('flex', '1')
        .style('min-height', '0px')
        .style('display', 'flex')
        .style('flex-direction', 'column');
    }

    self.set_domain(self.get_domain(self.starting_domain));
    self.make_contig_picker();
    self.make_search_bar();
    self.make_controls();

    // Inner div for tracks sits directly below controls_svg in normal vertical flow
    self.inner_div = self.outer_div.append('div')
      .attr('class', 'sgb_inner_div')
      .style('position', 'relative')
      .style('width', self.w + 'px')
      .style('overflow-x', 'hidden');

    if (self.config.height) {
      self.inner_div
        .style('flex', '1')
        .style('min-height', '0px')
        .style('overflow-y', 'auto');
    }

    self.setup_drag();
    self.setup_scroll();
    self.display_region();
  }

  make_controls() {
    const self = this;

    self.icon_r = 10;
    self.icon_spacing = 26;

    // 1. Copy Link to Current View button
    self.copy_link_btn = self.sgb_outer_buttons.append('button')
      .style('position', 'relative')
      .style('width', Math.min(self.w / 5, 280) + 'px')
      .style('font-size', '16px')
      .html('Copy Link to Current View')
      .on('click', function() {
        const url = self.get_share_url();
        navigator.clipboard.writeText(url).then(() => {
          const btn = d3.select(this);
          btn.html('Copied!');
          setTimeout(() => btn.html('Copy Link to Current View'), 2000);
        });
      });

    // 2. Copy DNA Sequence of Region button
    self.copy_dna_btn = self.sgb_outer_buttons.append('button')
      .style('position', 'relative')
      .style('width', Math.min(self.w / 5, 280) + 'px')
      .style('font-size', '16px')
      .html('Copy DNA Sequence of Region')
      .on('click', function() {
        const seq = self.get_region_sequence();
        copy_sequence(seq, this);
      });

    if (self.title) {
      self.outer_div.append('h1')
        .style('position', 'absolute')
        .style('left', '20px')
        .style('top', '0px')
        .style('margin', '0px')
        .html(self.title);
    }

    // 3. SVG for zoom buttons, zoom selection bars, and coordinate axes
    self.controls_svg = self.outer_div.append('svg')
      .attr('width', self.w)
      .attr('height', self.layout.controls_h)
      .style('display', 'block')
      .style('flex-shrink', '0');

    const cy = self.layout.top + self.icon_r / 2;
    self.zoom_controls_g = self.controls_svg.append('g')
      .attr('class', 'zoom_controls_group')
      .attr('transform', `translate(${self.midpoint}, ${cy})`);

    // Zoom Out (-) on the left
    self.zoom_out_g = self.zoom_controls_g.append('g')
      .attr('class', 'zoom_thing')
      .attr('transform', `translate(${-self.icon_spacing}, 0)`)
      .style('cursor', 'pointer')
      .on('click', () => {
        self.display_region(self.zoom_out());
      });
    self.zoom_out_g.append('title').text('Zoom out');
    self.zoom_out_g.append('circle')
      .attr('cx', 0)
      .attr('cy', 0)
      .attr('r', self.icon_r)
      .attr('stroke', '#333')
      .attr('fill', '#CCC');
    self.zoom_out_g.append('line')
      .attr('x1', -self.icon_r / 2)
      .attr('x2', self.icon_r / 2)
      .attr('y1', 0)
      .attr('y2', 0)
      .attr('stroke', '#333');

    // Zoom Full Contig (|--|) in the middle
    self.zoom_full_g = self.zoom_controls_g.append('g')
      .attr('class', 'zoom_thing')
      .attr('transform', 'translate(0, 0)')
      .style('cursor', 'pointer')
      .on('click', () => {
        self.display_region(self.zoom_full_contig());
      });
    self.zoom_full_g.append('title').text('Zoom to full contig');
    self.zoom_full_g.append('circle')
      .attr('cx', 0)
      .attr('cy', 0)
      .attr('r', self.icon_r)
      .attr('stroke', '#333')
      .attr('fill', '#CCC');
    const bar_w = self.icon_r * 0.55;
    const tick_h = self.icon_r * 0.4;
    // Horizontal bar
    self.zoom_full_g.append('line')
      .attr('x1', -bar_w)
      .attr('x2', bar_w)
      .attr('y1', 0)
      .attr('y2', 0)
      .attr('stroke', '#333');
    // Left vertical bar
    self.zoom_full_g.append('line')
      .attr('x1', -bar_w)
      .attr('x2', -bar_w)
      .attr('y1', -tick_h)
      .attr('y2', tick_h)
      .attr('stroke', '#333');
    // Right vertical bar
    self.zoom_full_g.append('line')
      .attr('x1', bar_w)
      .attr('x2', bar_w)
      .attr('y1', -tick_h)
      .attr('y2', tick_h)
      .attr('stroke', '#333');

    // Zoom In (+) on the right
    self.zoom_in_g = self.zoom_controls_g.append('g')
      .attr('class', 'zoom_thing')
      .attr('transform', `translate(${self.icon_spacing}, 0)`)
      .style('cursor', 'pointer')
      .on('click', () => {
        self.display_region(self.zoom_in());
      });
    self.zoom_in_g.append('title').text('Zoom in');
    self.zoom_in_g.append('circle')
      .attr('cx', 0)
      .attr('cy', 0)
      .attr('r', self.icon_r)
      .attr('stroke', '#333')
      .attr('fill', '#CCC');
    self.zoom_in_g.append('line')
      .attr('x1', -self.icon_r / 2)
      .attr('x2', self.icon_r / 2)
      .attr('y1', 0)
      .attr('y2', 0)
      .attr('stroke', '#333');
    self.zoom_in_g.append('line')
      .attr('x1', 0)
      .attr('x2', 0)
      .attr('y1', -self.icon_r / 2)
      .attr('y2', self.icon_r / 2)
      .attr('stroke', '#333');

    // Main current-view coordinate axis
    self.x_scale = d3.scaleLinear().range(self.layout.x_range).domain(self.domain);
    self.x_axis = d3.axisTop(self.x_scale)
      .ticks(6)
      .tickFormat(self.circular_coordinate);
    self.x_ax_element = self.controls_svg.append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0, ${self.layout.top + self.layout.track_axis_top})`)
      .call(self.x_axis);

    self.setup_full_contig_zoom_bar();
    self.setup_view_zoom_bar();
  }

  make_contig_picker() {
    const self = this;
    self.contig_picker = self.sgb_outer_buttons.append('select')
      .attr('id', 'contig_picker')
      .style('max-width', '220px')
      .style('height', '25px')
      .style('outline', 'none')
      .style('border', 'none')
      .style('background-color', '#FFF')
      .style('font-size', '18px')
      .style('color', '#333')
      .on('focus', function() { d3.select(this).style('color', '#333'); })
      .on('blur', function() { d3.select(this).style('color', '#333'); })
      .on('change', function() { self.new_contig(d3.select(this).property('value')); });

    self.contig_picker.selectAll('option')
      .data(Object.keys(self.seq_lens))
      .enter()
      .append('option')
      .text(d => 'Contig: ' + d)
      .attr('value', d => d);

    self.contig_picker.property('value', self.contig);
  }

  make_search_bar() {
    const self = this;
    self.search_div = self.sgb_outer_buttons.append('div')
      .attr('id', 'search_div');

    self.gene_search = self.search_div.append('input')
      .attr('id', 'main_searchbar')
      .attr('type', 'search')
      .attr('spellcheck', 'false')
      .attr('autocomplete', 'off')
      .style('width', Math.min(self.w / 5, 280) + 'px')
      .style('height', '25px')
      .style('font-size', '18px')
      .on('focus', function() { d3.select(this).style('color', '#333'); })
      .on('blur', function() { d3.select(this).style('color', '#333'); })
      .on('keydown', function(event) {
        if (event.key === 'Enter') {
          const val = this.value.trim();
          if (val && self.handle_search_query(val)) {
            this.value = '';
            this.blur();
          }
        }
      });

    self.search_dict = {};
    self.autoCompleteEl = new autoComplete({
      placeHolder: "Search features or coords...",
      selector: () => self.gene_search.node(),
      data: {
        src: [],
        keys: ['label']
      },
      events: {
        input: {
          selection: (event) => {
            const selection = event.detail.selection.value;
            self.autoCompleteEl.input.value = '';
            const key = (selection && typeof selection === 'object') ? selection.key : String(selection).split(' ')[0];
            const search_result = self.search_dict[key];
            if (search_result) {
              self.display_feature(search_result.contig, search_result.start, search_result.end);
              if (search_result.track && search_result.track.click_function) {
                search_result.track.click_function(search_result.datum);
              }
            }
            self.gene_search.node().blur();
          }
        }
      }
    });
  }

  handle_search_query(query) {
    // 1. Check for coordinate range or single coordinate: e.g. "1000..5000", "1000-5000", "contig:1000-5000", or "25000"
    const cleaned = query.replace(/,/g, '').trim();
    const coord_match = cleaned.match(/^(?:([^:\s]+):)?(\d+)(?:\s*(?:\.\.|-|\s)\s*(\d+))?$/);
    if (coord_match) {
      const target_contig = (coord_match[1] && (coord_match[1] in this.seqs)) ? coord_match[1] : this.contig;
      const start = parseInt(coord_match[2], 10);
      if (coord_match[3] !== undefined) {
        const end = parseInt(coord_match[3], 10);
        this.display_region({ contig: target_contig, domain: [Math.min(start, end), Math.max(start, end)] });
      } else {
        const half_w = Math.max(100, Math.round(this.domain_wid / 2));
        this.display_region({ contig: target_contig, domain: [start - half_w, start + half_w] });
      }
      return true;
    }

    // 2. Check for exact match by locusId or feature name
    if (query in this.search_dict) {
      const res = this.search_dict[query];
      this.display_feature(res.contig, res.start, res.end);
      if (res.track && res.track.click_function) res.track.click_function(res.datum);
      return true;
    }
    const lower = query.toLowerCase();
    for (const entry of Object.values(this.search_dict)) {
      const d = entry.datum || {};
      if ((d.name && String(d.name).toLowerCase() === lower) || (d.locusId && String(d.locusId).toLowerCase() === lower)) {
        this.display_feature(entry.contig, entry.start, entry.end);
        if (entry.track && entry.track.click_function) entry.track.click_function(entry.datum);
        return true;
      }
    }
    return false;
  }

  update_search() {
    this.autoCompleteEl.data = {
      src: Object.keys(this.search_dict).map(k => {
        const entry = this.search_dict[k];
        if (entry.label) return { key: k, label: `${k} ${entry.label}` };
        const d = entry.datum || {};
        return { key: k, label: `${k} ${d.name || ''} ${d.desc || ''}`.trim() };
      }),
      keys: ['label']
    };
  }

  setup_full_contig_zoom_bar() {
    const self = this;
    const bar_height = 20;
    const bar_y_offset = self.layout.top + self.layout.contig_zoom_bar_top;

    self.full_contig_zoom_g = self.controls_svg.append('g')
      .attr('class', 'full_contig_zoom_bar');

    self.full_contig_x_scale = d3.scaleLinear()
      .range(self.layout.x_range)
      .domain([0, self.contig_len]);
    self.full_contig_axis = d3.axisTop(self.full_contig_x_scale)
      .tickSize(5)
      .ticks(5);
    self.full_contig_axis_element = self.full_contig_zoom_g.append('g')
      .attr('class', 'x_axis')
      .attr('transform', `translate(0, ${self.layout.top + self.layout.contig_axis_top})`)
      .call(self.full_contig_axis);

    self.full_contig_zoom_rects_g = self.full_contig_zoom_g.append('g')
      .style('cursor', 'crosshair');
    self.full_contig_bg_rect = self.full_contig_zoom_rects_g.append('rect')
      .attr('x', self.layout.x_range[0])
      .attr('y', bar_y_offset)
      .attr('width', self.layout.x_range[1] - self.layout.x_range[0])
      .attr('height', bar_height)
      .attr('fill', '#eee')
      .attr('stroke', 'black');

    self.full_contig_highlight_rect = self.full_contig_zoom_rects_g.append('rect')
      .attr('y', bar_y_offset)
      .attr('height', bar_height)
      .attr('fill', 'rgba(255, 0, 0, 0.5)');

    // Second highlight rect used when a circular contig view wraps across coordinate 0
    self.full_contig_highlight_rect_wrap = self.full_contig_zoom_rects_g.append('rect')
      .attr('y', bar_y_offset)
      .attr('height', bar_height)
      .attr('fill', 'rgba(255, 0, 0, 0.5)')
      .style('display', 'none');

    let drag_start_pos = null;
    let drag_rect = null;

    const clamp_x = (x) => Math.min(Math.max(x, self.layout.x_range[0]), self.layout.x_range[1]);

    const drag_behavior = d3.drag()
      .on('start', (event) => {
        drag_start_pos = clamp_x(event.x);
        drag_rect = self.full_contig_zoom_g.append('rect')
          .attr('y', bar_y_offset)
          .attr('height', bar_height)
          .attr('fill', 'rgba(255, 0, 0, 0.7)')
          .attr('opacity', 0.7);
      })
      .on('drag', (event) => {
        const effective_mouse_pos = clamp_x(event.x);
        const x = Math.min(drag_start_pos, effective_mouse_pos);
        const width = Math.abs(drag_start_pos - effective_mouse_pos);
        drag_rect.attr('x', x).attr('width', width);
      })
      .on('end', (event) => {
        const effective_mouse_pos = clamp_x(event.x);
        const start_px = Math.min(drag_start_pos, effective_mouse_pos);
        const end_px = Math.max(drag_start_pos, effective_mouse_pos);
        drag_rect.remove();
        drag_start_pos = null;
        if (end_px - start_px < 3) return; // ignore accidental clicks
        const start_coord = Math.floor(self.full_contig_x_scale.invert(start_px));
        const end_coord = Math.ceil(self.full_contig_x_scale.invert(end_px));
        self.reset_force_loading();
        self.display_region({ domain: [start_coord, end_coord] });
      });

    self.full_contig_zoom_rects_g.call(drag_behavior);
  }

  setup_view_zoom_bar() {
    const self = this;
    const bar_height = 20;
    const bar_y_offset = self.layout.top + self.layout.view_zoom_bar_top;

    self.view_zoom_g = self.controls_svg.append('g')
      .attr('class', 'view_zoom_bar')
      .style('cursor', 'crosshair');

    self.view_zoom_bg_rect = self.view_zoom_g.append('rect')
      .attr('x', self.layout.x_range[0])
      .attr('y', bar_y_offset)
      .attr('width', self.layout.x_range[1] - self.layout.x_range[0])
      .attr('height', bar_height)
      .attr('fill', '#fafafa')
      .attr('stroke', 'black')
      .attr('stroke-width', 1);

    let drag_start_pos = null;
    let drag_rect = null;

    const clamp_x = (x) => Math.min(Math.max(x, self.layout.x_range[0]), self.layout.x_range[1]);

    const drag_behavior = d3.drag()
      .on('start', (event) => {
        drag_start_pos = clamp_x(event.x);
        drag_rect = self.view_zoom_g.append('rect')
          .attr('y', bar_y_offset)
          .attr('height', bar_height)
          .attr('fill', 'lightgray')
          .attr('opacity', 0.7);
      })
      .on('drag', (event) => {
        const effective_mouse_pos = clamp_x(event.x);
        const x = Math.min(drag_start_pos, effective_mouse_pos);
        const width = Math.abs(drag_start_pos - effective_mouse_pos);
        drag_rect.attr('x', x).attr('width', width);
      })
      .on('end', (event) => {
        const effective_mouse_pos = clamp_x(event.x);
        const start_px = Math.min(drag_start_pos, effective_mouse_pos);
        const end_px = Math.max(drag_start_pos, effective_mouse_pos);
        drag_rect.remove();
        drag_start_pos = null;
        if (end_px - start_px < 3) return; // ignore accidental clicks
        const start_coord = Math.floor(self.x_scale.invert(start_px));
        const end_coord = Math.ceil(self.x_scale.invert(end_px));
        self.reset_force_loading();
        self.display_region({ domain: [start_coord, end_coord] });
      });

    self.view_zoom_bg_rect.call(drag_behavior);
  }

  // =========================================================================
  // Dragging & Horizontal Scrolling
  // =========================================================================

  shift_tracks_px(dx_px) {
    for (const t of Object.values(this.tracks)) {
      if (t.g) t.g.attr('transform', `translate(${dx_px},0)`);
      if (t.canvas) t.canvas.style('left', `${dx_px}px`);
    }
  }

  update_full_contig_highlight() {
    if (this.circular && this.domain[0] < 0 && this.domain_wid < this.contig_len) {
      const wrap_start_px = this.full_contig_x_scale(this.contig_len + this.domain[0]);
      const wrap_end_px = this.full_contig_x_scale(this.contig_len);
      const start_px = this.full_contig_x_scale(0);
      const end_px = this.full_contig_x_scale(this.domain[1]);

      this.full_contig_highlight_rect
        .attr('x', start_px)
        .attr('width', Math.max(0, end_px - start_px));

      this.full_contig_highlight_rect_wrap
        .style('display', null)
        .attr('x', wrap_start_px)
        .attr('width', Math.max(0, wrap_end_px - wrap_start_px));
    } else {
      const d0 = Math.max(0, this.domain[0]);
      const d1 = Math.min(this.contig_len, this.domain[0] < 0 ? this.contig_len : this.domain[1]);
      const start_px = this.full_contig_x_scale(d0);
      const end_px = this.full_contig_x_scale(d1);

      this.full_contig_highlight_rect
        .attr('x', start_px)
        .attr('width', Math.max(1, end_px - start_px));
      this.full_contig_highlight_rect_wrap.style('display', 'none');
    }
  }

  setup_drag() {
    const self = this;
    self.dragAction = d3.drag()
      .on('start', function(e) {
        self.drag_start_domain = self.x_scale.domain().slice();
        self.drag_start = self.x_scale.invert(e.x);
        self.drag_start_mouse = e.x;
        self.x_change_mouse = 0;
        self.tmp_scale = d3.scaleLinear().range(self.layout.x_range).domain(self.domain);
        self.tmp_axis = d3.axisTop(self.tmp_scale)
          .ticks(6)
          .tickFormat(self.circular_coordinate);
      })
      .on('drag', function(e) {
        const x_pos = self.x_scale.invert(e.x);
        const x_change = x_pos - self.drag_start;
        const new_domain = self.get_domain([
          self.drag_start_domain[0] - x_change,
          self.drag_start_domain[1] - x_change
        ]);
        // Compute actual pixel shift corresponding to the clamped/wrapped domain shift
        const actual_bp_shift = self.drag_start_domain[0] - new_domain[0];
        const px_per_bp = (self.layout.x_range[1] - self.layout.x_range[0]) / self.domain_wid;
        self.x_change_mouse = self.circular ? (e.x - self.drag_start_mouse) : (actual_bp_shift * px_per_bp);

        self.set_domain(new_domain);
        self.tmp_scale.domain(self.domain);
        self.x_ax_element.call(self.tmp_axis.scale(self.tmp_scale));
        self.update_full_contig_highlight();
        self.shift_tracks_px(self.x_change_mouse);
      })
      .on('end', function() {
        self.x_scale = self.tmp_scale;
        self.x_axis = self.tmp_axis;
        if (Math.abs(self.x_change_mouse) > 1) {
          self.display_region();
        } else {
          self.shift_tracks_px(0);
        }
        setTimeout(() => {
          self.x_change_mouse = 0;
        }, 0);
      });
    self.outer_div.call(self.dragAction);
  }

  setup_scroll() {
    const self = this;
    let scroll_timeout = null;
    let scroll_accum_px = 0;
    let scroll_base_scale = null;

    self.outer_div.on('wheel.sgb_scroll', function(event) {
      const dx = (event.shiftKey && event.deltaX === 0) ? event.deltaY : event.deltaX;
      const dy = (event.shiftKey && event.deltaX === 0) ? 0 : event.deltaY;

      // Only intercept horizontal scrolling; allow vertical page scrolling
      if (Math.abs(dx) <= Math.abs(dy) || Math.abs(dx) === 0) {
        return;
      }
      event.preventDefault();

      if (!scroll_base_scale) {
        scroll_base_scale = self.x_scale.copy();
        scroll_accum_px = 0;
      }

      scroll_accum_px -= dx;
      const px_span = self.layout.x_range[1] - self.layout.x_range[0];
      const bp_per_px = self.domain_wid / px_span;
      const bp_shift = -scroll_accum_px * bp_per_px;
      const base_dom = scroll_base_scale.domain();
      const new_domain = self.get_domain([base_dom[0] + bp_shift, base_dom[1] + bp_shift]);

      const actual_bp_shift = base_dom[0] - new_domain[0];
      const effective_px = self.circular ? scroll_accum_px : (actual_bp_shift / bp_per_px);

      self.set_domain(new_domain);
      self.x_scale.domain(self.domain);
      self.x_ax_element.call(self.x_axis.scale(self.x_scale));
      self.update_full_contig_highlight();
      self.shift_tracks_px(effective_px);

      // If scrolled near the edge of the 3X pre-rendered buffer, render immediately
      if (Math.abs(effective_px) > self.w * 0.85) {
        if (scroll_timeout) clearTimeout(scroll_timeout);
        scroll_timeout = null;
        scroll_base_scale = null;
        scroll_accum_px = 0;
        self.display_region();
        return;
      }

      if (scroll_timeout) clearTimeout(scroll_timeout);
      scroll_timeout = setTimeout(() => {
        scroll_timeout = null;
        scroll_base_scale = null;
        scroll_accum_px = 0;
        self.display_region();
      }, 120);
    }, { passive: false });
  }

  // =========================================================================
  // Coordinate, Pixel, & Sequence Helpers
  // =========================================================================

  circular_coordinate = (d) => {
    if (!this.contig_len) return d;
    return d < 0 ? (this.contig_len + (d % this.contig_len)) % this.contig_len : d % this.contig_len;
  }

  unwrap_coordinate(coordinate) {
    if (!this.circular || !this.contig_len) return coordinate;
    const view_mid = (this.domain[0] + this.domain[1]) / 2;
    return coordinate + Math.round((view_mid - coordinate) / this.contig_len) * this.contig_len;
  }

  /**
   * Converts a genomic coordinate to an x pixel position in the 3x-width track space [0, display_w].
   */
  get_coordinate_pixel_position(coordinate) {
    const c = this.unwrap_coordinate(coordinate);
    return this.x_scale(c) + this.w;
  }

  /**
   * Converts a genomic interval [begin, end] to [left_px, right_px] in the 3x-width track space [0, display_w].
   */
  get_feature_pixel_position(begin, end) {
    if (!this.circular || !this.contig_len) {
      return [this.x_scale(begin) + this.w, this.x_scale(end) + this.w];
    }
    const L = this.contig_len;
    const feat_len = (end >= begin) ? (end - begin) : (end - begin + L);
    const feat_mid = begin + feat_len / 2;
    const view_mid = (this.domain[0] + this.domain[1]) / 2;
    const shift = Math.round((view_mid - feat_mid) / L) * L;
    const u_begin = begin + shift;
    const u_end = u_begin + feat_len;
    return [this.x_scale(u_begin) + this.w, this.x_scale(u_end) + this.w];
  }

  /**
   * Inverse of `get_coordinate_pixel_position`: converts a pixel x in [0, display_w]
   * back into a genomic coordinate.
   * @param {number} px - Pixel x position in track coordinates [0, display_w].
   * @param {boolean} [wrap=true] - Whether to wrap circular coordinates into [0, contig_len).
   */
  get_pixel_coordinate(px, wrap = true) {
    const raw = this.x_scale.invert(px - this.w);
    return (wrap && this.circular) ? this.circular_coordinate(raw) : raw;
  }

  /**
   * Returns the unwrapped [start_coord, end_coord] corresponding to the full 3x-width
   * pre-rendered canvas/SVG range [0, display_w].
   */
  get_rendered_coordinate_range() {
    return [
      this.x_scale.invert(-this.w),
      this.x_scale.invert(2 * this.w)
    ];
  }

  get_domain(proposed_domain) {
    /* If not circular, fit domain into [0, this.contig_len].
       If circular, fit into [-this.contig_len, this.contig_len] with width <= this.contig_len.
    */
    if (this.circular) {
      const domain_size = proposed_domain[1] - proposed_domain[0];
      if (domain_size >= this.contig_len) {
        const offset = Math.ceil((domain_size - this.contig_len) / 2);
        const index_spot = proposed_domain[0] + offset;
        proposed_domain = [index_spot - this.contig_len + 1, index_spot];
      }
      proposed_domain = proposed_domain.map(this.circular_coordinate);
      if (proposed_domain[1] <= proposed_domain[0]) {
        proposed_domain[0] -= this.contig_len;
      }
    } else {
      const d0 = Math.max(0, Math.min(proposed_domain[0], this.contig_len - 1));
      const d1 = Math.max(d0 + 1, Math.min(proposed_domain[1], this.contig_len));
      proposed_domain = [d0, d1];
    }
    return proposed_domain;
  }

  set_domain(proposed_domain) {
    this.domain = proposed_domain;
    this.domain_wid = this.domain[1] - this.domain[0];
    const d = this.domain;
    this.initial_domain_includes_zero = d[0] < 0;

    // Expand by 1 full browser width on either side for 3X pre-rendered dragging
    const inner_px = Math.max(1, this.layout.x_range[1] - this.layout.x_range[0]);
    const buffer_bp = this.domain_wid * (this.w / inner_px);
    this.expanded_domain = this.get_domain([d[0] - buffer_bp, d[1] + buffer_bp]);
    this.expanded_domain_includes_zero = this.expanded_domain[0] < 0;

    this.region_start = this.circular_coordinate(this.expanded_domain[0]);
    this.region_end = this.circular_coordinate(this.expanded_domain[1]);
  }

  /**
   * Returns the DNA sequence for a 1-based inclusive interval [start, end],
   * handling circular wrap-around and optional reverse-complementing.
   */
  get_sequence(start, end, contig = this.contig, strand = '+') {
    const seq = this.seqs[contig] || '';
    if (!seq) return '';
    const L = seq.length;
    const is_circ = this.circular_contigs.includes(String(contig));
    const s = Math.floor(start);
    const e = Math.ceil(end);
    let raw_seq = '';

    if (is_circ && e < s) {
      raw_seq = seq.slice(Math.max(0, s - 1)) + seq.slice(0, Math.min(L, e));
    } else if (is_circ && s < 0) {
      const wrap_s = ((s % L) + L) % L;
      raw_seq = seq.slice(Math.max(0, wrap_s - 1)) + seq.slice(0, Math.min(L, e));
    } else {
      raw_seq = seq.slice(Math.max(0, s - 1), Math.min(L, e));
    }

    if (String(strand) === '-' || strand === -1) {
      return reverse_complement(raw_seq);
    }
    return raw_seq;
  }

  get_region_sequence() {
    const seq = this.seqs[this.contig] || '';
    if (this.domain_wid >= this.contig_len) {
      return seq;
    }
    const start_coord = Math.floor(this.circular_coordinate(this.domain[0]));
    const end_coord = Math.ceil(this.circular_coordinate(this.domain[1]));
    return this.get_sequence(start_coord, end_coord, this.contig, '+');
  }

  get_share_url() {
    const params = new URLSearchParams();
    params.set('contig', this.contig);
    params.set('start', Math.round(this.circular_coordinate(this.domain[0])));
    params.set('end', Math.round(this.circular_coordinate(this.domain[1])));
    for (const [key, val] of Object.entries(this.saved_state)) {
      if (val !== undefined && val !== null) {
        params.set(key, Array.isArray(val) ? val.join(',') : val);
      }
    }
    return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
  }

  // =========================================================================
  // Navigation & Zoom Functions
  // =========================================================================

  reset_force_loading() {
    for (const t of Object.values(this.tracks)) {
      t.currently_force_loading = false;
    }
  }

  new_contig(contig_name, starting_domain = null) {
    if (!(contig_name in this.seqs)) {
      console.warn(`Contig "${contig_name}" not found in sequences.`);
      return;
    }
    this.contig = contig_name;
    this.contig_len = this.seq_lens[this.contig];
    this.circular = this.circular_contigs.includes(String(this.contig));
    this.contig_picker.property('value', this.contig);
    this.full_contig_x_scale.domain([0, this.contig_len]);
    this.full_contig_axis_element.call(this.full_contig_axis);

    if (starting_domain) {
      this.set_domain(this.get_domain(starting_domain));
    } else {
      this.set_domain(this.get_domain([
        Math.floor(this.contig_len / 10),
        Math.floor(this.contig_len / 5)
      ]));
    }
    for (const d of Object.keys(this.data)) {
      this.data[d].filter_by_contig();
    }
    this.display_region();
  }

  zoom_in() {
    return {
      domain: this.get_domain([
        this.domain[0] + this.domain_wid / 4,
        this.domain[1] - this.domain_wid / 4
      ])
    };
  }

  zoom_out() {
    this.reset_force_loading();
    return {
      domain: this.get_domain([
        this.domain[0] - this.domain_wid,
        this.domain[1] + this.domain_wid
      ])
    };
  }

  zoom_full_contig() {
    this.reset_force_loading();
    if (this.circular) {
      return { domain: [0, this.contig_len - 1] };
    }
    return { domain: [0, this.contig_len] };
  }

  display_feature(contig, start, end) {
    const size = Math.max(1, end - start);
    const left = start - size * 2;
    const right = end + size * 2;
    this.display_region({
      contig: contig,
      domain: [left, right]
    });
  }

  display_region(new_region = null) {
    const self = this;
    const render_id = ++self._render_id;

    if (new_region) {
      if ('contig' in new_region && new_region.contig != self.contig) {
        self.new_contig(new_region.contig, new_region.domain);
        return;
      } else if ('domain' in new_region && new_region.domain) {
        self.set_domain(self.get_domain(new_region.domain));
      }
    }

    self.full_contig_x_scale.domain([0, self.contig_len]);
    self.full_contig_axis_element.call(self.full_contig_axis);
    self.update_full_contig_highlight();

    self.x_scale.domain(self.domain);
    self.x_ax_element
      .attr('transform', `translate(0, ${self.layout.top + self.layout.track_axis_top})`)
      .call(self.x_axis.scale(self.x_scale));

    self.shift_tracks_px(0);

    // Update datasets and render expanded tracks
    for (const d of Object.keys(self.data_map)) {
      if (!self.data[d]) continue;
      if (Object.values(self.data_map[d]).some(tn => self.tracks[tn] && self.tracks[tn].expanded)) {
        self.data[d].update_data().then(() => {
          if (render_id !== self._render_id) return; // ignore stale async data responses
          self.data[d].loaded = true;
          for (const tn of Object.values(self.data_map[d])) {
            const t = self.tracks[tn];
            if (t && t.expanded) {
              t.display_region();
            }
          }
        });
      } else {
        self.data[d].loaded = false;
      }
    }

    // Render expanded tracks that do not depend on a baseData object (e.g. seqTrack)
    for (const t of Object.values(self.tracks)) {
      if (t && t.expanded && !t.data_name) {
        t.display_region();
      }
    }
  }

  add_track(track, data = null) {
    if (data) {
      track.data = data;
    }
    if (track.data && !track.data_name && track.data.name) {
      track.data_name = track.data.name;
    }
    if (track.data && track.data_name && !(track.data_name in this.data)) {
      this.data[track.data_name] = track.data;
    }

    this.tracks[track.name] = track;
    if (track.data_name) {
      if (track.data_name in this.data_map) {
        if (!this.data_map[track.data_name].includes(track.name)) {
          this.data_map[track.data_name].push(track.name);
        }
      } else {
        this.data_map[track.data_name] = [track.name];
      }
      if (track.expanded && this.data[track.data_name]) {
        this.data[track.data_name].update_data().then(() => {
          this.data[track.data_name].loaded = true;
          if (this.data_map[track.data_name]) {
            for (const tn of this.data_map[track.data_name]) {
              const t = this.tracks[tn];
              if (t && t.expanded) {
                t.display_region();
              }
            }
          }
        });
      }
    } else if (track.expanded) {
      track.display_region();
    }
  }

  // =========================================================================
  // Customizable Tooltip & Sidebar
  // =========================================================================

  setup_tooltip() {
    this.tooltip = d3.select('body').append('div')
      .attr('class', 'sgb_tooltip')
      .style('visibility', 'hidden')
      .style('background-color', 'rgba(255, 255, 255, 0.9)')
      .style('border', '1px solid #ccc')
      .style('border-radius', '5px')
      .style('padding', '6px 8px')
      .style('min-width', '120px')
      .style('max-width', '320px')
      .style('color', 'black')
      .style('z-index', '20')
      .style('position', 'absolute')
      .style('pointer-events', 'none')
      .style('text-align', 'center');
  }

  show_tooltip(x, y, html = null) {
    if (html !== null) {
      this.tooltip.html(html);
    }
    this.tooltip.style('visibility', 'visible');
    this.move_tooltip(x, y);
  }

  move_tooltip(x, y) {
    const node = this.tooltip.node();
    const tooltipWidth = (node && node.offsetWidth) ? node.offsetWidth : 150;
    const windowWidth = window.innerWidth;
    const wouldOverflow = (x + 15 + tooltipWidth) > windowWidth;

    this.tooltip
      .style('left', (wouldOverflow ? Math.max(5, x - tooltipWidth - 10) : x + 10) + 'px')
      .style('top', (y + 20) + 'px');
  }

  hide_tooltip() {
    this.tooltip.style('visibility', 'hidden');
  }

  setup_sidebar() {
    this.current_sidebar_width = this.layout.sidebar_w;
    const max_h = this.config.height ? '100%' : 'calc(100vh - 20px)';

    this.sidebar = this.sidebar_slot.append('div')
      .attr('class', 'sgb_sidebar_div')
      .style('background-color', '#DDD')
      .style('width', '0px')
      .style('position', 'relative')
      .style('max-height', max_h)
      .style('overflow-y', 'auto')
      .style('overflow-x', 'hidden')
      .style('box-sizing', 'border-box')
      .style('z-index', 12)
      .style('text-align', 'left')
      .style('border-top-right-radius', '10px')
      .style('border-bottom-right-radius', '10px')
      .on('mousedown', function(event) {
        event.stopPropagation();
      });

    this.sidebar_button = this.sidebar.append('button')
      .style('font-size', '16px')
      .html('x')
      .style('position', 'sticky')
      .style('top', '7px')
      .style('float', 'right')
      .style('margin', '7px 7px 0 0')
      .style('display', 'none')
      .style('cursor', 'pointer')
      .style('z-index', 15)
      .on('click', () => {
        this.hide_sidebar();
      });

    this.sidebar_content = this.sidebar.append('div')
      .attr('class', 'sidebar_content_div')
      .style('margin', '10px')
      .style('display', 'none');

    this.sidebar_div = this.sidebar_content.append('div')
      .attr('class', 'sidebar-content-inner-div');
  }

  show_sidebar(html = null, width = null) {
    const sidebar_w = width ?? this.layout.sidebar_w;
    if (html !== null) {
      if (typeof html === 'string') {
        this.sidebar_div.html(html);
      } else if (html instanceof Element) {
        this.sidebar_div.selectAll('*').remove();
        this.sidebar_div.node().appendChild(html);
      } else if (html.node && typeof html.node === 'function') {
        this.sidebar_div.selectAll('*').remove();
        this.sidebar_div.node().appendChild(html.node());
      }
    }

    const needs_resize = !this.sidebar_expanded || this.current_sidebar_width !== sidebar_w;
    this.current_sidebar_width = sidebar_w;
    this.sidebar
      .style('width', sidebar_w + 'px')
      .style('min-width', sidebar_w + 'px');
    this.sidebar_button.style('display', 'block');
    this.sidebar_content.style('display', 'block');
    this.sidebar.node().scrollTop = 0;
    this.sidebar_expanded = true;

    if (needs_resize) {
      this.resize(Math.max(200, this.original_w - sidebar_w));
    }
  }

  hide_sidebar() {
    this.sidebar.style('width', '0px').style('min-width', '0px');
    this.sidebar_button.style('display', 'none');
    this.sidebar_content.style('display', 'none');
    this.sidebar_expanded = false;
    this.resize(this.original_w);
  }

  // =========================================================================
  // Resizing
  // =========================================================================

  resize(new_w) {
    const self = this;
    self.w = new_w;
    self.display_w = new_w * 3;
    self.display_left = -1 * new_w;
    self.midpoint = new_w / 2;
    self.layout.x_range = [self.layout.x_buf, new_w - self.layout.x_buf];

    // Update containers
    self.main_col_div.style('width', new_w + 'px');
    self.sgb_outer_buttons.style('width', new_w + 'px');
    self.outer_div.style('width', new_w + 'px');
    self.inner_div.style('width', new_w + 'px');

    // Update control button/search widths
    const control_item_w = Math.min(new_w / 5, 280) + 'px';
    if (self.copy_link_btn) self.copy_link_btn.style('width', control_item_w);
    if (self.copy_dna_btn) self.copy_dna_btn.style('width', control_item_w);
    if (self.gene_search) self.gene_search.style('width', control_item_w);

    // Update controls SVG & centered zoom controls group
    self.controls_svg.attr('width', new_w);
    const cy = self.layout.top + self.icon_r / 2;
    self.zoom_controls_g.attr('transform', `translate(${self.midpoint}, ${cy})`);

    // Update scales
    self.x_scale.range(self.layout.x_range);
    self.full_contig_x_scale.range(self.layout.x_range);

    // Full contig zoom bar
    self.full_contig_bg_rect
      .attr('x', self.layout.x_range[0])
      .attr('width', Math.max(0, self.layout.x_range[1] - self.layout.x_range[0]));

    // View zoom bar
    self.view_zoom_bg_rect
      .attr('x', self.layout.x_range[0])
      .attr('width', Math.max(0, self.layout.x_range[1] - self.layout.x_range[0]));

    // Recompute expanded_domain for the new width
    self.set_domain(self.domain);

    // Resize all tracks
    for (const t of Object.values(self.tracks)) {
      if (t.resize) t.resize();
    }

    // Re-render
    self.display_region();
  }
}

export { SimpleGenomeBrowser };
export {
  baseData,
  staticPointData,
  staticFeatureData,
  serverPointData,
  serverFeatureData,
  staticParquetPointData,
  staticParquetFeatureData
} from "./SGB_data.js";