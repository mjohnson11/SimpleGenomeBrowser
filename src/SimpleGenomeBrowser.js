import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import autoComplete from 'https://cdn.jsdelivr.net/npm/@tarekraafat/autocomplete.js@10.2.7/dist/autoComplete.min.js/+esm'; 
import { parse_fasta, measure_text, reverse_complement, copy_sequence } from "./util.js";

class SimpleGenomeBrowser {
  /**
   * A class for creating a simple interactive genome browser in a specified div.
   * It handles the overall layout, data loading, navigation, and display of tracks.
   *
   * @param {string} orgId - The organism ID or name to display in the browser title.
   * @param {boolean} circular - Whether the genome is circular. If true, enables circular navigation.
   * @param {number} w - The width of the browser in pixels.
   * @param {number} h - The height of the browser in pixels.
   * @param {d3.Selection} div - The d3 selection of the div element to append the browser to.
   * 
   * @param {object} [config={}] - An optional configuration object.
   * @param {string} [config.starting_contig] - The contig to initially display. Defaults to the first contig in the loaded data.
   * @param {array} [config.starting_domain] - The genomic domain (start and end coordinates) to initially display. Defaults to a region in the first contig.
   * @param {boolean} [config.fastdrag=true] -  If true, enables 'fast drag' behavior, pre-rendering a wider area for smoother dragging. Defaults to true.
   * @param {string} [config.fasta_file] - Path to a FASTA file to load genome sequence data from.
   * @param {string} [config.aa_file] - Path to a FASTA file to load amino acid sequence data from (optional).
   * @param {array} [config.genbank_json] - Array of Genbank JSON objects to load genome and feature data from.
   *
   */
  constructor(orgId, circular, w, h, div, config = {}) {

    // Required arguments
    this.orgId = orgId;
    this.circular = circular;
    this.w = w;
    this.h = h;
    this.div = div;

    // Optional arguments
    this.starting_contig = config.starting_contig || null;
    this.starting_domain = config.starting_domain || null;
    this.fastdrag = config.fastdrag === undefined ? true : config.fastdrag;

    // layout 
    this.layout = {
      'top': 45,
      'controls_h': 150,
      'x_buf': 40,
      'contig_axis_top': 35,
      'contig_zoom_bar_top': 35,
      'view_zoom_bar_top': 80,
      'track_axis_top': 80
    }
    this.layout.x_range = [this.layout.x_buf, w-this.layout.x_buf];
    this.midpoint = w / 2;
    this.display_w = this.fastdrag ? w * 3 : w;
    this.display_left = this.fastdrag ? -1 * w : 0;
    
    // Some variables / defaults
    this.tracks = [];
    this.seqs = {};
    this.seq_lens = {};
    this.sidebar_expanded = false;

    if (config.fasta_file) {
      const loadPromises = [fetch(config.fasta_file).then(response => response.text())];
  
      if (config.aa_file) {
        loadPromises.push(fetch(config.aa_file).then(response => response.text()));
      }
      this.loadingPromise = Promise.all(loadPromises)
        .then((responses) => {
          const fastaData = responses[0];
          const aaData = responses.length > 1 ? responses[1] : null;
          this.seqs = parse_fasta(fastaData);
          console.log(Object.keys(this.seqs));
          this.aa_seqs = aaData ? parse_fasta(aaData) : {};
          this.setup_browser();
          return this
        });
    } else if (config.genbank_json) {
      this.loadingPromise = new Promise((resolve) => {
        this.seqs = {};
        this.aa_seqs = {};
        config.genbank_json.forEach(genbank_rec => {
          this.seqs[genbank_rec.name] = genbank_rec.sequence;
          for (let feature of genbank_rec.features) {
            if (feature.type == 'CDS') {
              if (feature.notes.translation){
                this.aa_seqs[feature.notes.locus_tag[0]] = feature.notes.translation[0];
              }
            }
          }
        });
        console.log(this.seqs)
        this.setup_browser();
        resolve(this);
      });
    }
  }

  setup_browser() {
    // to be called after data is loaded
    this.seq_lens = Object.fromEntries(Object.entries(this.seqs).map(([k, v]) => [k, v.length]));
    if (!(this.starting_contig in this.seqs)) {
      this.starting_contig = Object.keys(this.seqs)[0];
      this.starting_domain = this.starting_domain || [
        Math.floor(this.seq_lens[this.starting_contig] / 4),
        Math.floor(5 * this.seq_lens[this.starting_contig] / 16),
      ];
    }
    this.build_basic_browser();
    this.setup_tooltip();
    this.setup_sidebar();
    this.make_search_bar();
  }

  // making the browser

  build_basic_browser() {
    const self = this;

    self.outer_div = self.div.append('div')
      .style('left', 0)
      .style('top', 0)
      .style('width', self.w)
      .style('height', self.h)
      .style('position', 'absolute')
      //.style('border', '2px solid black')
      .style('overflow', 'hidden')

    self.contig = self.starting_contig;
    self.contig_len = self.seq_lens[self.contig];

    self.set_domain(self.starting_domain);
    self.make_controls();
    self.setup_drag();
    self.make_contig_picker();
    self.display_region();
  }

  make_controls() {
    const self = this;

    self.icon_r = 10;
    self.icon_spacing = 20;

    self.outer_div.append('button')
      .style('position', 'absolute')
      .style('left', self.midpoint + self.w/8)
      .style('top', self.layout.top-15)
      .html('Copy DNA Sequence of Region')
      .on('click', function() {
        copy_sequence(self.seqs[self.contig].slice(self.domain[0]-1, self.domain[1]), this)
      })

    self.outer_div.append('h1')
      .style('position', 'absolute')
      .style('left', 20)
      .style('top', 0)
      .style('margin', 0)
      .html(self.orgId)

    self.controls_svg = self.outer_div.append('svg')
      .attr('width', self.w)
      .attr('height', self.layout.controls_h);

    self.zoom_in_g = self.controls_svg.append('g')
      .attr('class', 'zoom_thing')
      .on('click', function() {
        self.display_region(self.zoom_in());
      });
    self.zoom_out_g = self.controls_svg.append('g')
      .attr('class', 'zoom_thing')
      .on('click', function() {
        self.display_region(self.zoom_out());
      });

    d3.selectAll('.zoom_thing:hover').style('opacity', 0.5);
    self.zoom_in_g.append('circle')
      .attr('cx', self.midpoint + self.icon_spacing)
      .attr('cy', self.layout.top + self.icon_r/2)
      .attr('r', self.icon_r)
      .attr('stroke', '#333')
      .attr('fill', '#CCC');
    self.zoom_in_g.append('line')
      .attr('x1', self.midpoint + self.icon_spacing - self.icon_r/2)
      .attr('x2', self.midpoint + self.icon_spacing + self.icon_r/2)
      .attr('y1', self.layout.top + self.icon_r/2)
      .attr('y2', self.layout.top + self.icon_r/2)
      .attr('stroke', '#333');
    self.zoom_in_g.append('line')
      .attr('x1', self.midpoint + self.icon_spacing)
      .attr('x2', self.midpoint + self.icon_spacing)
      .attr('y1', self.layout.top)
      .attr('y2', self.layout.top + self.icon_r/2 + self.icon_r/2)
      .attr('stroke', '#333');
    self.zoom_out_g.append('circle')
      .attr('cx', self.midpoint - self.icon_spacing)
      .attr('cy', self.layout.top + self.icon_r/2)
      .attr('r', self.icon_r)
      .attr('stroke', '#333')
      .attr('fill', '#CCC');
    self.zoom_out_g.append('line')
      .attr('x1', self.midpoint - self.icon_spacing - self.icon_r/2)
      .attr('x2', self.midpoint - self.icon_spacing + self.icon_r/2)
      .attr('y1', self.layout.top + self.icon_r/2)
      .attr('y2', self.layout.top + self.icon_r/2)
      .attr('stroke', '#333');

    self.x_scale = d3.scaleLinear().range(self.layout.x_range).domain(self.domain);
    self.x_axis = d3.axisTop(self.x_scale)
      .ticks(6)
      .tickFormat(self.circular_coordinate);
    self.x_ax_element = self.controls_svg.append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0, ${self.layout.top + self.layout.track_axis_top})`)
      .call(self.x_axis);

    this.setup_full_contig_zoom_bar();
    this.setup_view_zoom_bar();
  }

  make_contig_picker() {
    const self = this;
    self.contig_picker = self.outer_div.append('select')
      .attr('id', "contig_picker")
      .style("position", "absolute")
      .style("top", self.layout.top)
      .style("right", "50px")
      .style("width", "170px")
      .style("height", "15px")
      .style("outline", "none")
      .style("border", "none")
      .style("background-color", "#FFF")
      .style("color", "#333")
      .on('focus', function () { d3.select(this).style('color', '#333')})
      .on('blur', function() { d3.select(this).style('color', '#333')})
      .property('value', self.contig)
      .on('change', function() { self.new_contig(d3.select(this).property("value"))});
  
      self.contig_picker.selectAll("option")
        .data(Object.keys(self.seq_lens))
        .enter()
        .append("option")
        .text(d => d)
        .attr("value", d => d);
  }

  make_search_bar() {
    const self = this;
    self.search_div = self.div.append('div')
      .attr('id', 'search_div')
      .style('position', 'absolute')
      .style('left', 0)
      .style('top', self.layout.top)

    self.gene_search = self.search_div.append('input')
      .attr('class', "gene_searchbar")
      .attr('id', 'main_searchbar')
      .attr('type', 'search')
      .attr('spellcheck', 'false')
      .attr('autocomplete', 'off')
      .on('focus', function () { d3.select(this).style('color', '#333')})
      .on('blur', function() { d3.select(this).style('color', '#333')});
  
    self.search_dict = {};
    //console.log(help(autoCompleteJS));
    self.autoCompleteEl = new autoComplete({
        placeHolder: "Search for gene names...",
        selector: '#main_searchbar',
        data: {src: []},
        events: {
            input: {
                selection: (event) => {
                    const selection = event.detail.selection.value;
                    self.autoCompleteEl.input.value = '';
                    self.search_click(selection.split(' ')[0]);
                    document.getElementById('gene_searchbar').blur(); //removes focus so the cursor leaves
                }
            }
        }
    });
    
  }

  setup_full_contig_zoom_bar() {
    const self = this;
    const bar_height = 20;
    const bar_y_offset = self.layout.top + self.layout.contig_zoom_bar_top;

    self.full_contig_zoom_g = self.controls_svg.append('g')
      .attr('class', 'full_contig_zoom_bar');

    self.full_contig_x_scale = d3.scaleLinear().range(self.layout.x_range).domain([0, self.contig_len]);
    self.full_contig_axis = d3.axisTop(self.full_contig_x_scale)
      .tickSize(5)
      .ticks(5);
    self.full_contig_axis_element = self.full_contig_zoom_g.append('g')
      .attr('class', 'x_axis')
      .attr('transform', `translate(0, ${self.layout.top + self.layout.contig_axis_top})`)
      .call(self.full_contig_axis);

    self.full_contig_zoom_rects_g = self.full_contig_zoom_g.append('g');
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

    let drag_start_pos = null;
    let drag_rect = null;

    const drag_behavior = d3.drag()
      .on('start', (event) => {
        drag_start_pos = self.circular ? event.x : Math.min(Math.max(event.x, self.layout.x_range[0]), self.layout.x_range[1]);
        drag_rect = self.full_contig_zoom_g.append('rect')
          .attr('y', bar_y_offset)
          .attr('height', bar_height)
          .attr('fill', 'rgba(255, 0, 0, 0.7)')
          .attr('opacity', 0.7);
      })
      .on('drag', (event) => {
        const effective_mouse_pos = self.circular ? event.x : Math.min(Math.max(event.x, self.layout.x_range[0]), self.layout.x_range[1]);
        const x = Math.min(drag_start_pos, effective_mouse_pos);
        const width = Math.abs(drag_start_pos - effective_mouse_pos);
        drag_rect
          .attr('x', x)
          .attr('width', width);
      })
      .on('end', (event) => {
        const effective_mouse_pos = self.circular ? event.x : Math.min(Math.max(event.x, self.layout.x_range[0]), self.layout.x_range[1]);
        const start_px = Math.min(drag_start_pos, effective_mouse_pos);
        const end_px = Math.max(drag_start_pos, effective_mouse_pos);
        const start_coord = Math.floor(self.full_contig_x_scale.invert(start_px));
        const end_coord = Math.ceil(self.full_contig_x_scale.invert(end_px));
        // reset force load behavior
        for (let t of self.tracks) {
          t.currently_force_loading = false;
        }
        self.display_region({ domain: [start_coord, end_coord] });
        drag_rect.remove();
        drag_start_pos = null;
      });

    self.full_contig_zoom_rects_g.call(drag_behavior);
  }

  setup_view_zoom_bar() {
    const self = this;
    const bar_height = 20;
    const bar_y_offset = self.layout.top + self.layout.view_zoom_bar_top; // Below the main x axis

    self.view_zoom_g = self.controls_svg.append('g')
      .attr('class', 'view_zoom_bar');

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

    const drag_behavior = d3.drag()
      .on('start', (event) => {
        drag_start_pos = self.circular ? event.x : Math.min(Math.max(event.x, self.layout.x_range[0]), self.layout.x_range[1]);
        drag_rect = self.view_zoom_g.append('rect')
          .attr('y', bar_y_offset)
          .attr('height', bar_height)
          .attr('fill', 'lightgray')
          .attr('opacity', 0.7);
      })
      .on('drag', (event) => {
        const effective_mouse_pos = self.circular ? event.x : Math.min(Math.max(event.x, self.layout.x_range[0]), self.layout.x_range[1]);
        const x = Math.min(drag_start_pos, effective_mouse_pos);
        const width = Math.abs(drag_start_pos - effective_mouse_pos);
        drag_rect
          .attr('x', x)
          .attr('width', width);
      })
      .on('end', (event) => {
        const effective_mouse_pos = self.circular ? event.x : Math.min(Math.max(event.x, self.layout.x_range[0]), self.layout.x_range[1]);
        const start_px = Math.min(drag_start_pos, effective_mouse_pos);
        const end_px = Math.max(drag_start_pos, effective_mouse_pos);
        const start_coord = Math.floor(self.x_scale.invert(start_px));
        const end_coord = Math.ceil(self.x_scale.invert(end_px));
        console.log(start_coord, end_coord, start_px, end_px);
        self.display_region({ domain: [start_coord, end_coord] });
        drag_rect.remove();
        drag_start_pos = null;
      });

    self.view_zoom_bg_rect.call(drag_behavior);
  }

  setup_drag() {
    const self = this;
    self.dragAction = d3.drag()
    //.filter(function(e) {
    //  return ((!d3.select(e.target).classed('tnseq_block')) || (!d3.select(e.target.parentElement).classed('sgb_gene')));
    //})
    .on('start', function(e) {
      //console.log('dragging');
      //console.log(d3.select(e.target.parentElement).classed('sgb_gene'));
      self.drag_start_domain = self.x_scale.domain();
      self.drag_start = self.x_scale.invert(e.x);
      self.drag_start_mouse = e.x;
      self.x_change_mouse = 0
      self.tmp_scale = d3.scaleLinear().range(self.layout.x_range).domain(self.domain);
      self.tmp_axis = d3.axisTop(self.tmp_scale)
        .ticks(6)
        .tickFormat(self.circular_coordinate);
      self.x_ax_element.remove();
      self.x_ax_element = self.controls_svg.append('g')
        .attr('class', 'axis')
        .attr('transform', 'translate(0, '+String(self.layout.top+self.layout.track_axis_top)+')')
        .call(self.tmp_axis);
    })
    .on('drag', function(e) {
      const x_pos = self.x_scale.invert(e.x);
      const x_change = x_pos-self.drag_start;
      self.x_change_mouse = e.x-self.drag_start_mouse;
      self.set_domain(self.get_domain([self.drag_start_domain[0]-x_change, self.drag_start_domain[1]-x_change]))
      self.tmp_scale.domain(self.domain)
      self.x_ax_element.call(self.tmp_axis.scale(self.tmp_scale));
      for (let t of self.tracks) {
        t.g.attr('transform', 'translate('+String(self.x_change_mouse)+',0)');
        if (t.canvas) t.canvas.style('left', String(self.x_change_mouse));
      }
    })
    .on('end', function(e) {
      self.x_scale = self.tmp_scale;
      self.x_axis = self.tmp_axis;
      if (Math.abs(self.x_change_mouse) > 1) self.display_region();
    })
    self.outer_div.call(self.dragAction);
  }

  // coordinate functions

  circular_coordinate = (d) => {
    // Converts a linear coordinate to a circular coordinate within the contig.
    // the this variable is the class (self) if I use an arrow function
    // (don't totally get this, but works)
    return d < 0 ? this.contig_len + (d % this.contig_len) : d % this.contig_len;
  }

  get_coordinate_pixel_position(coordinate) {
    // Get the pixel position of a DNA coordinate
    let pos = this.x_scale(coordinate);
    if (this.expanded_domain_includes_zero) { // some are out of scale
      if (this.scale_near_zero) {
        // the scale is near zero (scale overflow to the left)
        if (coordinate > this.region_end) {
          pos = this.x_scale(coordinate-this.contig_len);
        }
      } else if (coordinate < this.region_start) {
        // the scale is near the contig len (scale overflow to the right)
        pos = this.x_scale(coordinate+this.contig_len);
      }  
    }
    // shifting to make the scale right
    pos += this.w;
    return pos;
  }

  get_feature_pixel_position(begin, end) {
    // Get the pixel positions of two DNA coordinates
    // NOTE: this still doesn't account for the case where a feature spans 0
    // and is one end is out of scale (I think)
    let left = this.x_scale(begin);
    let right = this.x_scale(end);
    if (this.expanded_domain_includes_zero) { // some are out of scale
      if (this.scale_near_zero) {
        // the scale is near zero (scale overflow to the left)
        if ((begin > this.region_start) || (end > this.region_start)) {
          left = this.x_scale(begin-this.contig_len);
          right = this.x_scale(end-this.contig_len);
          //console.log('if', left, right, this.region_start, this.region_end, begin, end)
        }
      } else {
        // the scale is near the contig len (scale overflow to the right)
        if ((begin < this.region_end) || (end < this.region_end)) {
          left = this.x_scale(begin+this.contig_len);
          right = this.x_scale(end+this.contig_len);
          //console.log('if2', left, right)
        }
      }  
    }
    // shifting to make the scale right
    left += this.w;
    right += this.w;
    return [left, right];
  }

  get_domain(proposed_domain) {
    /* if not circular, the domain will be fit into [0, this.contig_len]
    if circular, into [-this.contig_len, this.contig_len]
    */

    // make sure we're not bigger than the max size
    if (this.circular) {
      const domain_size = proposed_domain[1]-proposed_domain[0];

      if (domain_size > this.contig_len) { // enforces the size being <= contig len
        const offset = Math.ceil((domain_size-this.contig_len)/2);
        const index_spot = proposed_domain[0]+offset;
        // full circle starting at index_spot
        proposed_domain = [index_spot-this.contig_len+1, index_spot];
      }
      // map to positive circular coordinates
      proposed_domain = proposed_domain.map(this.circular_coordinate);

      if (proposed_domain[1] < proposed_domain[0]) {
        // if we overlap zero, make the start a negative coordinate
        proposed_domain[0] -= this.contig_len;
      }
    } else {
      proposed_domain = [Math.max(proposed_domain[0], 0), Math.min(proposed_domain[1], this.contig_len-1)];
    }
    return proposed_domain;
  }

  set_domain(proposed_domain) {
    this.domain = proposed_domain;
    this.domain_wid = this.domain[1]-this.domain[0];
    const d = this.domain; // just for readability
    this.initial_domain_includes_zero = d[0] < 0;
    // expanding on either side for fast dragging
    this.expanded_domain = this.get_domain([d[0]-this.domain_wid, d[1]+this.domain_wid])
    this.expanded_domain_includes_zero = this.expanded_domain[0] < 0;
    

    this.first_half = (d[0] + d[1])/(this.contig_len*2) < 0.5;
    // If this expanded domain includes zero, it's important
    // to know if the original domain (which sets the scale)
    // was low (near zero) or high (near the contig len)
    this.scale_near_zero = (this.initial_domain_includes_zero || this.first_half);
    this.region_start = this.circular_coordinate(this.expanded_domain[0]);
    this.region_end = this.circular_coordinate(this.expanded_domain[1]);
  }

  // functions that change the x range

  new_contig(contig_name, starting_domain = null) {
    console.log('New contig', contig_name);
    this.contig = contig_name;
    this.contig_len = this.seq_lens[this.contig];
    this.contig_picker.property('value', this.contig);
    this.full_contig_x_scale.domain([0, this.contig_len]);
    this.full_contig_axis_element.call(this.full_contig_axis);
    if (starting_domain) {
      this.set_domain(starting_domain);
    } else {
      this.set_domain([Math.floor(this.contig_len / 10), Math.floor(this.contig_len / 5)]);
    }
    for (let t of this.tracks) {
      t.filter_by_contig();
    }
    this.display_region();
  }

  zoom_in() {
    return {'domain': this.get_domain([this.domain[0]+this.domain_wid/4, this.domain[1]-this.domain_wid/4])};
  }

  zoom_out() {
    // reset force load behavior
    for (let t of this.tracks) {
      t.currently_force_loading = false;
    }
    return {'domain': this.get_domain([this.domain[0]-this.domain_wid, this.domain[1]+this.domain_wid])};
  }

  display_region(new_region = null) {
    const self = this;
    if (new_region) {
      if ('contig' in new_region) {
        if (new_region.contig != self.contig) {
          self.new_contig(new_region.contig, new_region.domain);
        } else {
          self.set_domain(new_region.domain);
        }
      } else {
        self.set_domain(new_region.domain);
      }
    }
    self.x_scale.domain(self.domain);
    self.x_ax_element.attr('transform', `translate(0, ${self.layout.top + self.layout.track_axis_top})`).call(self.x_axis);

    // Update full contig highlight
    const [start_px, end_px] = self.domain.map(self.full_contig_x_scale);
    self.full_contig_highlight_rect
      .attr('x', start_px)
      .attr('width', end_px - start_px);

    self.full_contig_x_scale.domain([0, self.contig_len]);
    self.full_contig_axis_element.call(self.full_contig_axis);

    self.x_scale.domain(self.domain);
    self.x_ax_element.call(self.x_axis);

    for (let t of self.tracks) {
      t.display_region();
    }
  }

  // Setting up responsive elements - the tooltip and the sidebar

  setup_tooltip() {
    this.tooltip = d3.select('body').append('div')
      .style('visibility', 'hidden') 
      .style("background-color", "rgba(255, 255, 255, 0.8)") // Use rgba() for opacity
      .style("border-radius", "5px")
      .style("padding", "5px")
      .style("width", "150px")
      .style("color", "black")
      .style('z-index', '20')
      .style('position', 'absolute')
      .style('pointer-events', 'none')
      .style('text-align', 'center')
      .html('<h2>yeah</h2><p>uhhuh</p>');
  }

  show_tooltip(x, y, html=null) {
    this.tooltip
      .style('left', x+10)
      .style('top', y+20)//-8-tooltip.node().offsetHeight);
      .style('visibility', 'visible');
    if (html) this.tooltip.html(html);
  }

  move_tooltip(x, y) {
    this.tooltip
      .style('left', x-75)
      .style('top', y+20)//-8-tooltip.node().offsetHeight);
  }
  
  hide_tooltip() {
    this.tooltip.style('visibility', 'hidden');
  }

  setup_sidebar() {
    const self = this;
    this.sidebar_width = 250;
    this.sidebar = this.outer_div.append('div')
      .style("background-color", "#DDD")
      .style("width", 0)
      .style('position', 'absolute')
      .style('top', self.layout.top-15)
      .style('right', 0)
      .style('z-index', '12')
      .style('text-align', 'left')
      
      
    this.sidebar_content = this.sidebar.append('div')
      .attr('class', 'sidebar_content_div')
      .style('max-height', self.h-self.layout.top+15)
      .style('overflow-y', 'scroll')
      .html('<h2>Click on a gene to see info here</h2>');

    this.sidebar_button = this.sidebar.append('button')
      .html("<")
      .style('position', 'absolute')
      .style('top', 5)
      .style('right', 5)
      .on('click', () => {
        if (this.sidebar_expanded) {
          this.hide_sidebar();
        } else {
          this.show_sidebar(null, this.sidebar_width);
        }
      });
    this.sidebar_content
      .style('margin', 10)
      .style('visibility', 'hidden');
  }

  show_sidebar(html=null, sidebar_width=250) {
    if (html) this.sidebar_content.html(html);
    this.sidebar_width = sidebar_width;
    this.sidebar.style('width', this.sidebar_width);
    this.sidebar_button.html(">");
    
    this.sidebar_content.style('visibility', 'visible');
    this.sidebar_expanded = true;
  }

  hide_sidebar() {
    this.sidebar.style('width', 0);
    this.sidebar_button.html("<");
    this.sidebar_content.style('visibility', 'hidden');
    this.sidebar_expanded = false;
  }

  default_gene_tooltip_func(e, gene_object) {
    if (gene_object) {
      const { locusId, name, desc } = gene_object;
  
      let html = `
          <div class="gene_tooltip">
            <p><strong>Locus ID:</strong> ${locusId}</p>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Description:</strong> ${desc}</p>
          </div>
        `
      
      this.tooltip.selectAll('*').remove();
      this.tooltip.html(html);
      this.show_tooltip(e.x, e.y)
    }
  }

  default_gene_sidebar_func(gene_object) {
    if (gene_object) {

      const { locusId, name, desc, begin, end, strand, scaffoldId, pseudo } = gene_object;
      const sidebar_info_rows = [
        ['Locus ID:', locusId],
        ['Name:', name],
        ['Description:', desc],
        ['Contig:', scaffoldId],
        ['Start:', begin],
        ['End:', end],
        ['Strand:', strand]
      ]
      if (pseudo) sidebar_info_rows.push(['(Pseudogene)', '']);
    
      this.sidebar_content.selectAll('*').remove();
    
      const sidebar_div = this.sidebar_content.append('div').attr('class', 'gene-info')

      sidebar_div.selectAll('.sidebar_info_row')
        .data(sidebar_info_rows)
        .enter()
        .append('p')
          .attr('class', 'sidebar_info_row')
          .html((d) => `<strong>${d[0]}</strong> ${d[1]}`)
    
      sidebar_div.append('p').append('button')
        .html('Copy DNA Sequence')
        .on('click', function() {
          if (String(strand)=='+'){
            copy_sequence(this.seqs[scaffoldId].slice(begin-1, end), this);
          } else {
            copy_sequence(reverse_complement(this.seqs[scaffoldId].slice(begin-1, end)), this);
          }
          
        })
      
      if (this.aa_seqs != {}) {
        if (locusId in this.aa_seqs) {
          const aa_seq = this.aa_seqs[locusId];
          sidebar_div.append('p').append('button')
            .html('Copy AA Sequence')
            .on('click', function() {
              copy_sequence(aa_seq, this);
            })
          sidebar_div.append('p').append('a')
            .attr('href', `https://fast.genomics.lbl.gov/cgi/findHomologs.cgi?seqDesc=${locusId}&seq=${aa_seq}`)
            .attr('target', '_blank')
            .html('Find homologs with fast.genomics')
        } else {
          sidebar_div.append('p').html('No AA sequence available');
        }
      }
      this.sidebar_content.node().scrollTop = 0;
      this.show_sidebar();
    }
  }

  search_click(selection) {
    this.display_gene(selection);
    search_result.track.click_function(row);
    this.show_sidebar();
  }

  display_gene(selection) {
    const search_result = this.search_dict[selection];
    if ('callback' in search_result) {
      search_result.callback(search_result);
    }
    const row = search_result.gene_data;
    const size = row['end']-row['begin'];
    const left = row['begin'] - size;
    const right = row['end'] + size;
    this.display_region({
      'contig': row[search_result.contig_column],
      'domain': [left, right]
    });
  }

}

class baseTrack {
  /**
   * Base class for all track types in the Simple Genome Browser.
   * Provides the basic structure for a track, including a div and SVG element,
   * and handles basic region loading logic based on zoom level.
   * This class is extended by specific track implementations.
   *
   * @param {SimpleGenomeBrowser} sgb - The SimpleGenomeBrowser instance this track belongs to.
   * @param {string} name - The name of the track.
   * @param {number} h - The height of the track in pixels.
   * @param {number} top - The top position of the track in pixels, relative to the browser div.
   * 
   * @param {object} [config={}] - An optional configuration object for the track.
   * @param {number} [config.load_threshold=1000000] - The domain width (in base pairs) above which track data will not be automatically loaded,
   *                                                   and a "force load" button will be displayed.
   *
   * @customizable_methods
   * - `load_region()`: Must be overridden by subclasses to implement the specific logic
   *                    for loading and displaying data for the current genomic region.
   * - `filter_by_contig()`: Must be overridden by subclasses to implement track-specific 
   *                         filtering logic when the displayed contig changes.
   */
  constructor(sgb, name, h, top, config) {
    const self = this;
    self.sgb = sgb;
    self.h = h;
    self.top = top;
    self.name = name;
    self.config = config;
    self.load_threshold = config.load_threshold || 1000000;

    self.div = self.sgb.outer_div.append('div')
      .style('width', self.sgb.display_w)
      .style('height', self.h)
      .style('position', 'absolute')
      .style('left', -1*self.sgb.w)
      .style('top', self.top)

    self.svg = self.div.append('svg')
      .attr('width', self.sgb.display_w)
      .attr('height', self.h)
      .style('position', 'absolute')
      .style('left', 0)
      .style('top', 0)

    self.g = self.svg.append('g');

    self.force_load_on = false;
    self.currently_force_loading = false;

    self.force_load_div = self.div.append('div')
      .style('position', 'absolute')
      .style('left', 0)
      .style('top', 0)
      .style('width', self.sgb.display_w)
      .style('height', self.h)
      .style('background-color', '#CCC')
      .style('z-index', 10)
      .style('visibility', 'hidden')
      

    self.force_load_div.append('button')
      .style('position', 'absolute')
      .style('left', '50%')
      .style('top', self.h/2-10)
      .html('Click to force load')
      .on('click', () => {
        self.force_load_on = false;
        self.currently_force_loading = true;
        self.force_load_track();
      })

    if (!config.hide_title) {
      console.log('titling')
      self.show_title(self.name);
    }
  }

  show_title(title, fontsize=12) {
    const self = this;
    if (self.title_div) self.title_div.remove();
    console.log(self.div.style('width'))
    self.title_div = self.div.append('div')
      .style('position', 'absolute')
      .style('right', self.sgb.w+10)
      .style('top', 0)
      .style('background-color', '#CCC')
      .style('opacity', 0.8)
      .style('color', 'black')
      .style('padding', 2)
      .style('padding-left', 6)
      .style('padding-right', 6)
      .style('border-radius', '5px')
      .style('font-size', fontsize+'px')
      .style('text-align', 'center')
      .style('z-index', 11)
      .text(title);
  }

  hide_title() {
    self.title_div.style('visibility', 'hidden')
  }

  make_color_legend(color_map, config={}) {
    const self = this;
    const title = config.title || 'Key';
    const left = config.left || self.sgb.w+10;
    const top = config.top || 0;
    const width = config.width || 180;
    const fontsize = config.fontsize || 12;
    const height = config.height || fontsize+4;

    const legend_div = self.div.append('div')
      .attr('class', 'color_legend')
      .style('position', 'absolute')
      .style('background-color', '#CCC')
      .style('border', '1px solid black')
      .style('left', left+'px')
      .style('top', top+'px')
      .style('width', width+'px')
      .style('height', height+'px')
      .style('text-align', 'center')
      .style('z-index', 9);

    const title_element = legend_div.append('h4')
      .text(title)
      .style('font-size', fontsize+'px')
      .style('cursor', 'pointer')
      .style('margin', 2);

    let y_offset = fontsize + 5;
    const legend_items = legend_div.append('div')
      .attr('class', 'legend_items')
      .style('visibility', 'hidden')
      .style('background-color', 'white')
      .style('border', '1px solid black')
      .style('padding-top', 15)
      .style('padding-bottom', 15)
      .style('padding-left', 4)
      .style('padding-right', 4);

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
        .style('font-size', fontsize+'px');
      y_offset += fontsize + 2;
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
    // NOTE: this is a function I made to try to make it so
    // we can wait for the track to re-render before hiding the force
    // load button. I originally tried to do it right by chaining promises
    // through the loading and drawing functions, but it didn't work, and
    // I am confused about promises and canvas rendering. So for now we've
    // got this hacky delay.
    const self = this;
    self.load_region();
    await new Promise(resolve => setTimeout(resolve, 50));
    self.force_load_div.style('visibility', 'hidden');
  }

  load_region() {
    throw new Error("load_region() must be implemented by child class");
  }

  display_region() {
    const self = this;
    if ((self.sgb.domain_wid > self.load_threshold) && (!self.currently_force_loading)) {
      if (!self.force_load_on) {
        self.force_load_on = true;
        self.currently_force_loading = false;
        self.force_load_div.style('visibility', 'visible');
      }
    } else {
      self.load_region();
      if (self.force_load_on) {
        self.force_load_on = false;
        self.force_load_div.style('visibility', 'hidden');
      }
    }
  }

  filter_by_contig(chromo_column='scaffoldId') {
    const self = this;
    self.contig_filt = self.data.filter((d) => d[chromo_column] == self.sgb.contig);
  }

  filter_one_point_by_region(pos) {
    // condition for features that cross 0
    if (this.sgb.circular && this.sgb.expanded_domain_includes_zero) {
      return ((pos < this.region_end) || (pos > this.region_start))
    } else {
      return (pos < this.region_end) && (pos > this.region_start);
    }
  }

  filter_points_by_region() {
    const self = this;
    self.region_start = self.sgb.circular_coordinate(self.sgb.expanded_domain[0]);
    self.region_end = self.sgb.circular_coordinate(self.sgb.expanded_domain[1]);
    self.filt_data = self.contig_filt.filter((d) => self.filter_one_point_by_region(d.pos));
  }
}

class baseFeatureTrack extends baseTrack {
  /**
   * Extends `baseTrack` to provide a base class for tracks that display feature data.
   * Assumes feature data is an array of objects with `locusId`, `scaffoldId`, `begin`, and `end` attributes.
   * Provides methods for filtering feature data by contig and genomic region.
   * This class is intended to be further extended by specific feature track types.
   */


  hover_function(e, gene_object) {
    // use default function provided by sgb
    this.sgb.default_gene_tooltip_func(e, gene_object);
  }

  click_function(gene_object) {
    // use default function provided by sgb
    this.sgb.default_gene_sidebar_func(gene_object);
  }

  filter_one_by_region(feat_start, feat_end) {
    // condition for features that cross 0
    if (this.sgb.circular && this.sgb.expanded_domain_includes_zero) {
      return ((feat_start < this.region_end) || (feat_end > this.region_start) || (feat_end < feat_start))
    } else {
      return (feat_start < this.region_end) && (feat_end > this.region_start);
    }
  }

  filter_by_region() {
    const self = this;
    self.region_start = self.sgb.circular_coordinate(self.sgb.expanded_domain[0]);
    self.region_end = self.sgb.circular_coordinate(self.sgb.expanded_domain[1]);
    self.filt_data = self.contig_filt.filter((d) => self.filter_one_by_region(d.begin, d.end));
  }

  load_region() {
    throw new Error("load_region() must be implemented by child class");
  }
}

class geneTrack extends baseFeatureTrack {
  /**
   * Extends `baseFeatureTrack` to specifically display gene features.
   * Provides methods for drawing gene chevrons.
   * This class is extended by specific gene data source track types (e.g., GFF, Genbank).
   *
   * @customizable_methods
   * - `hover_function(e, gene_object)`: Can override to customize what happens when a gene is clicked 
   *                                     (default is to display info in a tooltip)
   * - `click_function(gene_object)`: Can override to customize what happens when a gene is clicked 
   *                                  (default is to display info in the sidebar)
   * - `load_region()`: Can override to implement the data loading and display logic for genes. The default implementation handles basic display of filtered gene data.
   * - `get_feature_stroke(d)`: Can override to customize the stroke color of gene features based on gene data (e.g., different colors for different gene types).
   * - `get_feature_fill(d)`: Can override to customize the fill color of gene features.
   * - `make_gene_display(d)`: Can override to completely customize the SVG elements used to display a gene feature.
   */

  load_region() {
    const self = this;
    self.filter_by_region();
    console.log('Filtered gene data', self.filt_data);
    // remove holder g element, then remake
    self.g.remove()
    self.g = self.svg.append('g')
    self.g.on('click', () => console.log('g clicked'))
    self.g.selectAll('.feature_blocks')
      .data(self.filt_data)
      .enter()
      .append('g')
        .attr('class', 'sgb_gene')
        .attr('opacity', 0.8)
        .style('cursor', 'default')
        .on('mouseover', (e, d) => {
          //console.log(e.x, e.y, d.name);
          self.hover_function(e, self.sgb.search_dict[d.locusId].gene_data);
        })
        .on('mousemove', (e) => self.sgb.move_tooltip(e.x, e.y))
        .on('mouseout', () => self.sgb.hide_tooltip())
        .html(function(d) { return self.make_gene_display(d); })
        .on('click', (e, d) => {
          console.log('clicked on gene', d.name);
          self.click_function(d);
          e.stopPropagation(); // DOES NOT stop drag from firing (quirk of d3 drag)
        });
  }

  get_feature_stroke(d) {
    // to be replaced in child class for custom coloring
    return 'none';
  }

  get_feature_fill(d) {
    // to be replaced in child class for custom coloring
    return '#333';
  }

  make_gene_display(d) {
    const self = this;
    const [left, right] = self.sgb.get_feature_pixel_position(d.begin, d.end);
    const width = right-left;
    const height = Math.max(Math.min(30, 1000000/self.sgb.domain_wid), 20);
    const halfHeight = height / 2;
    const chevron_size = (width < 10) ? 0 : Math.min(width/4, 20);
    const top = 20
    let points = '';
    if (d.strand) {
      if (d.strand === '-') {
        points = `${left},${top+halfHeight} ${left+chevron_size},${top+height} ${left+width},${top+height} ${left+width},${top} ${left+chevron_size},${top}`; 
      } else {
        points = `${right},${top+halfHeight} ${right-chevron_size},${top+height} ${right-width},${top+height} ${right-width},${top} ${right-chevron_size},${top}`;
      }
    } else {
      points = `${right},${top} ${right},${top+height} ${right-width},${top+height} ${right-width},${top}`;
    }

    const fontsizes = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30]
    const textBuf = 2.5
    let label = d.name
    let fontsize = fontsizes[0]
    let labelsize = measure_text(label, fontsize)
    let labelVisible = (labelsize+2*textBuf+chevron_size < right-left)
    if (labelVisible) {
      for (let f of fontsizes) {
        labelsize = measure_text(label, f)
        if (labelsize+2*textBuf+chevron_size < right-left) {
          fontsize = f
        } else {
          break
        }
      }
    }
    const x_pos = d.strand === '+' ? left+textBuf : left+textBuf+chevron_size;
    const y_pos = top+height-textBuf-2;
    const stroke = self.get_feature_stroke(d);
    const fill = self.get_feature_fill(d);
    const strokeWid = 1;
    const chev = `<polygon points="${points}" stroke=${stroke} fill=${fill} stroke-width=${strokeWid} />`
    const label_use = labelVisible ? `<text x=${x_pos} y=${y_pos} fill="#FFF">${label}</text>` : '';
    return chev+label_use;
  }
}

class gffTrack extends geneTrack {
  /**
   * Extends `geneTrack` to load and display gene features from a GFF (General Feature Format) file.
   * Parses GFF data and adds gene information to the browser's search index.
   *
   * @param {SimpleGenomeBrowser} sgb - The SimpleGenomeBrowser instance this track belongs to.
   * @param {string} name - The name of the track.
   * @param {number} h - The height of the track in pixels.
   * @param {number} top - The top position of the track in pixels.
   * @param {object} [config={}] - An optional configuration object for the track.
   * @param {string} gff_file - Path to the GFF file to load.
   * @param {string} [type_filter='CDS'] - Feature type to filter for from the GFF file (e.g., 'CDS', 'gene', 'mRNA').
   *
   * @customizable_methods
   * - Inherits customizable methods from `geneTrack`: `hover_function`, `click_function`, `get_feature_stroke`, `get_feature_fill`, `make_gene_display`, `load_region`.
   *   Can customize these methods to alter the appearance or information displayed for GFF-loaded genes.
   */

  constructor(sgb, name, h, top, config, gff_file, type_filter='CDS') {
    super(sgb, name, h, top, config)
    const self = this;
    self.gff_file = gff_file;
    self.contig_column = 'scaffoldId';
    d3.text(gff_file).then(function(tdata) {
      self.data = d3.tsvParseRows(tdata.split('\n').filter((line) => (!line.startsWith('#'))).join('\n'), self.gff_parse);
      if (type_filter) {
        self.data = self.data.filter((d) => d.type==type_filter);
      }
      for (let row of self.data) {
        row.attributes.split(';').forEach(function(pair) {
          let keyVal = pair.split('=');
          row[keyVal[0]] = keyVal[1];
        })
        // Some renaming for consistency
        row['name'] = row['gene'] || row['locus_tag'];
        row['locusId'] = row['locus_tag'];
        row['desc'] = row['product'];
        // Adding info to the search index
        self.sgb.search_dict[String(row['locusId'])] = {
          'contig_column': self.contig_column,
          'gene_data': row,
          'track': self
        }
      }
      // Updating autocomplete search bar
      self.sgb.autoCompleteEl.data = {src: Object.keys(self.sgb.search_dict).map((k) => k + ' ' + self.sgb.search_dict[k].gene_data.name + ' ' + self.sgb.search_dict[k].gene_data.desc)};
      self.filter_by_contig();
      console.log('gff data loaded:', self.data);
      self.display_region();
    })
  }

  gff_parse(r) {
    return {
      'scaffoldId': r[0], 
      'type': r[2], 
      'begin': parseInt(r[3]), 
      'end': parseInt(r[4]),
      'strand': r[6],
      'phase': r[7],
      'attributes': r[8]
    }
  }

}

class gbTrack extends geneTrack {
  /**
   * Extends `geneTrack` to load and display gene features from pre-loaded Genbank JSON data.
   * Parses Genbank JSON (output from https://github.com/cheminfo-js/genbank-parser) 
   * and adds gene information to the browser's search index.
   *
   * @param {SimpleGenomeBrowser} sgb - The SimpleGenomeBrowser instance this track belongs to.
   * @param {string} name - The name of the track.
   * @param {number} h - The height of the track in pixels.
   * @param {number} top - The top position of the track in pixels.
   * @param {object} [config={}] - An optional configuration object for the track.
   * @param {array} genbank_json - Array of Genbank JSON objects to load feature data from.
   * @param {string} [type_filter='CDS'] - Feature type to filter for from the Genbank data (e.g., 'CDS', 'gene', 'mRNA').
   *
   * @customizable_methods
   * - Inherits customizable methods from `geneTrack`: `hover_function`, `click_function`, `get_feature_stroke`, `get_feature_fill`, `make_gene_display`, `load_region`.
   *   Can customize these methods to alter the appearance or information displayed for Genbank-loaded genes.
   */
  constructor(sgb, name, h, top, config, genbank_json, type_filter='CDS') {
    super(sgb, name, h, top, config)
    const self = this;
    self.genbank_json = genbank_json;
    self.contig_column = 'scaffoldId';
    self.data = [];
    for (let rec of genbank_json) {
      const scaffoldId = rec.name;
      for (let feature of rec.features) {
        if (feature.type == type_filter) {
          let row = {
            'scaffoldId': scaffoldId,
            'locusId': feature.notes.locus_tag[0],
            'begin': feature.start,
            'end': feature.end,
            'strand': feature.strand == 1 ? '+' : '-',
            'name': feature.name,
            'desc': feature.notes.product ? feature.notes.product[0] : '',
            'pseudo': feature.notes.pseudo ? true : false,
            'gb_row': feature
          };
          self.data.push(row);
          self.sgb.search_dict[String(row['locusId'])] = {
            'contig_column': self.contig_column,
            'gene_data': row,
            'track': self
          }
        }
      }
    }

    // Updating autocomplete search bar
    self.sgb.autoCompleteEl.data = {src: Object.keys(self.sgb.search_dict).map((k) => k + ' ' + self.sgb.search_dict[k].gene_data.name + ' ' + self.sgb.search_dict[k].gene_data.desc)};
    self.filter_by_contig();
    console.log('gb data loaded:', self.data);
    self.display_region()
  }
}

class geneTableTrack extends geneTrack {
  /**
   * Extends `geneTrack` to load and display gene features from a TSV (Tab-Separated Values) gene table file.
   * Assumes the gene table has columns: `locusId`, `name`, `scaffoldId`, `begin`, `end`, `desc`.
   *
   * @param {SimpleGenomeBrowser} sgb - The SimpleGenomeBrowser instance this track belongs to.
   * @param {string} name - The name of the track.
   * @param {number} h - The height of the track in pixels.
   * @param {number} top - The top position of the track in pixels.
   * @param {object} [config={}] - An optional configuration object for the track.
   * @param {string} gene_file - Path to the TSV gene table file.
   * @param {string} [chromo_column='scaffoldId'] - The column name in the gene table that corresponds to the chromosome/contig ID.
   *
   * @customizable_methods
   * - Inherits customizable methods from `geneTrack`: `hover_function`, `click_function`, `get_feature_stroke`, `get_feature_fill`, `make_gene_display`, `load_region`.
   *   Can customize these methods to alter the appearance or information displayed for gene table-loaded genes.
   */

  constructor(sgb, name, h, top, config, gene_file, chromo_column='scaffoldId') {
    super(sgb, name, h, top, config)
    const self = this;
    self.gene_file = gene_file;
    self.contig_column = chromo_column;
    d3.tsv(gene_file, d3.autoType).then(function(tdata) {
      self.data = tdata;
      for (let row of self.data) {
        row['locusId'] = String(row['locusId']); // convert to string to avoid number-string comparison issues
        row['search_text'] = row['locusId'] + ' ' + row['name'] + ' ' + row['desc'];
        // Adding info to the search index
        self.sgb.search_dict[String(row['locusId'])] = {
          'contig_column': self.contig_column,
          'gene_data': row,
          'track': self
        }
      }
      
      // Updating autocomplete search bar
      self.sgb.autoCompleteEl.data = {src: Object.keys(self.sgb.search_dict).map((k) => k + ' ' + self.sgb.search_dict[k].gene_data.name + ' ' + self.sgb.search_dict[k].gene_data.desc)};
      self.filter_by_contig(self.contig_column);
      console.log('gene data loaded:', self.data);
      self.display_region();
    })
  }
}

class quantitativeFeatureTrack extends baseFeatureTrack {
  /**
   * Extends `baseFeatureTrack` to display quantitative data associated with genomic features, typically as a heatmap-like track.
   * Uses a canvas element for efficient rendering of a large number of features.
   * Requires data to be loaded in the constructor of extending classes.
   *
   * @param {SimpleGenomeBrowser} sgb - The SimpleGenomeBrowser instance this track belongs to.
   * @param {string} name - The name of the track.
   * @param {number} h - The height of the track in pixels.
   * @param {number} top - The top position of the track in pixels.
   * @param {object} [config={}] - An optional configuration object for the track.
   * @param {array} display_columns - An array of column names from the data to display as quantitative rows in the heatmap.
   * @param {array} display_names - An array of display names corresponding to `display_columns`, shown as row titles.
   * @param {string} contig_column - The column name in the data that specifies the contig/chromosome ID.
   *
   * @param {object} [config] - Configuration object for the quantitativeFeatureTrack.
   *  Inherits configuration options from `baseFeatureTrack` and `baseTrack`.
   *
   * @customizable_methods
   * - `set_diverging_colorscale(scale)`: Call this method to customize the color scale used for the heatmap.
   *                                     Expects a d3 diverging color scale function.
   * - `get_feature_block_fill(d, column): Provide this method to customize the color with a function that takes as input
   *                                       the feature data object and the column name for this block
   * - `get_feature_block_stroke(d, column): Provide this method to customize the stroke color with a function that takes as input
   *                                       the feature data object and the column name for this block (default is no stroke)
   * - `hover_function(event, column, d)`: Override to customize the actions when a feature block is hovered.
   *                                       Receives the mouse event, the column name being displayed, and the feature data object.
   * - `click_function(event, column, d)`: Override to implement actions when a feature block is clicked.
   *                                       Receives the mouse event, the column name being displayed, and the feature data object.   
   * - `row_name_hover_function(event, d)`: Override to implement actions when a row name (display name) is hovered.
   *                                        Receives the mouse event and the display column name (d).
   * - `row_name_click_function(event, d)`: Override to implement actions when a row name (display name) is clicked.
   *                                        Receives the mouse event and the display column name (d).
   */

  constructor(sgb, name, h, top, config, display_columns, display_names, contig_column) {
    super(sgb, name, h, top, config);
    const self = this;
    self.display_columns = display_columns;
    self.display_names = display_names;
    self.contig_column = contig_column;
    self.block_h = (self.h * 0.9 / self.display_columns.length) * 0.9;
    self.block_ys = Array.from({ length: display_columns.length }, (_, i) => self.h * 0.05 + self.block_h * (1 / 0.9) * i);
    self.row_name_click = null;

    self.divergingColorScale = d3.scaleDiverging();

    // Create canvas element outside the SVG, but in the same div
    self.canvas = self.div.append('canvas')
      .attr('width', self.sgb.display_w)
      .attr('height', self.h)
      .style('position', 'absolute')
      .style('left', 0)
      .style('top', 0)
      .style('z-index', 0); 

    self.svg.style('z-index', 1);

    // div to hold row names
    self.row_title_div = self.sgb.div.append('div')
      .style('width', '200px')
      .style('position', 'absolute')
      .style('left', '0px')
      .style('top', `${self.top}px`)
      .style('z-index', 2);

    self.ctx = self.canvas.node().getContext('2d');

    self.highlightRect = self.svg.append('rect') // single rect for highlighting
      .attr('fill', 'rgba(255, 0, 0, 0.5)')
      .style('visibility', 'hidden');

    self.svg
      .on('mousemove', (event) => self.handleMousemove(event))
      .on('mouseout', () => self.handleMouseout())
      .on('click', (event) => self.handleClick(event));

    self.pixelMap = null; // Will store our pre-calculated pixel data.
  
  }

  set_diverging_colorscale(scale) {
    this.divergingColorScale = scale;
  }

  display_column_names() {
    const self = this;
    self.row_title_div.selectAll('.heatmap_row_name')
      .data(self.display_columns)
      .join('div') // Use .join('div') for creating and updating divs
      .attr('class', 'heatmap_row_name')
      .style('position', 'absolute')
      .style('top', (d, i) => `${self.block_ys[i] - self.block_h * (0.05 / 0.9)}px`)
      .style('left', '0px')
      .style('width', '200px')
      .style('height', `${self.block_h * (1 / 0.9)}px`)
      .style('background-color', (d, i) => i % 2 == 0 ? '#DDD' : '#FFF')
      .style('display', 'flex')
      .style('align-items', 'center')
      .style('padding-left', '5px')
      .style('box-sizing', 'border-box') // Important to include padding in the element's total width and height
      .style('cursor', 'pointer')
      .html((d, i) => `<span style="font-size: ${Math.min(self.block_h, 16)}px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; width: 100%;">${self.display_names[i]}</span>`)
      .on('mouseover', function (event, d) {
        d3.select(this).style('background-color', 'lightgray'); // Example hover effect
        if (self.row_name_hover_function) self.row_name_hover_function(event, d);
      })
      .on('mouseout', function () {
        d3.select(this).style('background-color', (d) => d === self.focal_row ? "FAA" : self.display_columns.indexOf(d) % 2 == 0 ? '#DDD' : '#FFF');
        self.sgb.hide_tooltip();
      })
      .on('click', function(event, d) {
        self.focal_row = d;
        self.row_title_div.selectAll('.heatmap_row_name').style('background-color', (data, index) => {
          return data === self.focal_row ? '#FAA' : index % 2 === 0 ? '#DDD' : '#FFF';
        });
        if (self.row_name_click_function) self.row_name_click_function(event, d);
        event.stopPropagation();
      });

    self.focal_row = self.display_columns[0];
    // Set initial background color for the focused row
    self.row_title_div.selectAll('.heatmap_row_name').style('background-color', (d) =>
      d === self.focal_row ? '#FAA' : self.row_title_div.select(`.heatmap_row_name:nth-child(${self.display_columns.indexOf(d) + 1})`).style('background-color')
    );
  }

  row_name_click_function(event, row_name) {
    // default function for clicking a row name (see make_summary_sidebar below)
    this.make_summary_sidebar(row_name);
    // optional additional function to add behavior on click
    if (self.row_name_click) self.row_name_click();
  }

  make_summary_sidebar(row_name) {
    const self = this;

    const genesWithScores = self.contig_filt
      .filter(row => row[row_name] !== null && !isNaN(row[row_name]) && (row.locusId in self.sgb.search_dict)) 
      .map(row => ({
        gene: self.sgb.search_dict[row.locusId].gene_data,
        score: row[row_name]
      }))
      .sort((a, b) => b.score - a.score); // Sort by score descending

    console.log('genes with scores', genesWithScores);
  
    const topGenes = genesWithScores.slice(0, 10);
    const bottomGenes = genesWithScores.slice(-10);
    
    self.sgb.sidebar_content.selectAll('*').remove();
    const sidebar_div = self.sgb.sidebar_content.append('div').attr('class', 'gene-info')

    // Add tabs
    const tabs = sidebar_div.append('div').attr('class', 'tabs');
    tabs.append('button')
      .text('+/- Genes')
      .classed('active', true)
      .on('click', function() {
        d3.select(this.parentNode).selectAll('button').classed('active', false);
        d3.select(this).classed('active', true);
        sidebar_div.selectAll('.gene_compare_content').style('display', 'none');
        sidebar_div.selectAll('.gene_pm_content').style('display', 'block');
      });

    tabs.append('button')
      .text('Compare')
      .on('click', function() {
        d3.select(this.parentNode).selectAll('button').classed('active', false);
        d3.select(this).classed('active', true);
        sidebar_div.selectAll('.gene_pm_content').style('display', 'none');
        sidebar_div.selectAll('.gene_compare_content').style('display', 'block');
      });

    // Making plus/minus gene display
    const pm_contentDiv = sidebar_div.append('div').attr('class', 'gene_pm_content');

    pm_contentDiv.append('div')
      .attr('class', 'gene-table')
      .html(`<h3 style="font-size: 14px; margin: 8px 0;">${row_name}</h3>`)
    
    const table = pm_contentDiv.select('.gene-table').append('table')
      .style('width', '350px') 
      .style('border-collapse', 'collapse')
      .style('border', '1px solid #ddd')
      .style('table-layout', 'fixed'); 
  
    const thead = table.append('thead');
    const headerRow = thead.append('tr')
      .style('background-color', '#f5f5f5')
      .style('border-bottom', '2px solid #ddd');
  
    headerRow.selectAll('th')
      .data(['Name', 'Description', 'Score'])
      .enter()
      .append('th')
      .style('padding', '4px')
      .style('border-right', (d, i) => i < 2 ? '1px solid #ddd' : null)
      .style('font-size', '12px')
      .style('width', (d, i) => { // Set column widths
        if (d === 'Name') return '30%';
        if (d === 'Description') return '55%';
        return '15%';
      })
      .text(d => d);
  
    const tbody = table.append('tbody');
  
    // Function to create table rows
    const createRows = (data, isTop) => {
      if (data.length === 0) return;
  
      tbody.append('tr')
        .style('background-color', '#f5f5f5')
        .append('td')
        .attr('colspan', 3)
        .style('padding', '4px')
        .style('font-size', '12px')
        .style('border-bottom', '1px solid #ddd')
        .html(`<strong>${isTop ? 'Top 10 Genes' : 'Bottom 10 Genes'}</strong>`);
  
      const rows = tbody.selectAll(`.gene-row-${isTop ? 'top' : 'bottom'}`)
        .data(data)
        .enter()
        .append('tr')
        .attr('class', `gene-row-${isTop ? 'top' : 'bottom'}`)
        .style('cursor', 'pointer')
        .style('border-bottom', '1px solid #ddd')
        .attr('data-locus-id', d => d.gene.locusId)
        .on('click', function(e, d) {
          self.sgb.display_gene(d.gene.locusId);
        });

  
      rows.append('td')
        .style('padding', '4px')
        .style('border-right', '1px solid #ddd')
        .style('font-size', '12px')
        .style('width', '30%') // Match column width
        .html(d => (d.gene.name == 'NA') ? d.gene.locusId : d.gene.name || d.gene.locusId);
  
      rows.append('td')
        .style('padding', '4px')
        .style('border-right', '1px solid #ddd')
        .style('font-size', '12px')
        .style('width', '50%') // Match column width
        .text(d => `${d.gene.desc.substring(0, 50)}${d.gene.desc.length > 50 ? '...' : ''}`);
  
      rows.append('td')
        .style('padding', '4px')
        .style('font-size', '12px')
        .style('width', '20%') // Match column width
        .style('background-color', d => d3.scaleDiverging()
          .domain([-4, 0, 4])
          .range(["#2d03fc", "#CCCCCC", "#fcdb03"])(d.score))
        .text(d => d.score.toFixed(2));
    };
  
    // Create top and bottom gene rows
    createRows(topGenes, true);
    createRows(bottomGenes.reverse(), false);


    // Now making scatterplot div, which will not be displayed at first
    const compare_contentDiv = sidebar_div.append('div')
      .attr('class', 'gene_compare_content')
      .style('display', 'none');

    // Select element for y-axis
    const select = compare_contentDiv.append('select')
      .style('margin', '10px');

    select.selectAll('option')
      .data(self.display_columns)
      .enter()
      .append('option')
      .text(d => d)
      .attr('value', d => d);

    let yAxisColumn = self.display_columns[0]; // Default y-axis column

    select.on('change', function() {
      yAxisColumn = d3.select(this).property('value');
      updateScatterplot();
    });

    const svgWidth = 340;
    const svgHeight = 250;
    const margin = { top: 20, right: 20, bottom: 30, left: 40 };
    const width = svgWidth - margin.left - margin.right;
    const height = svgHeight - margin.top - margin.bottom;

    const svg = compare_contentDiv.append('svg')
      .attr('width', svgWidth)
      .attr('height', svgHeight)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    let xScale, yScale;

    function updateScatterplot() {
      // Filter data for valid scores in both columns
      const plotData = self.contig_filt.filter(row =>
        row[row_name] !== null && !isNaN(row[row_name]) &&
        row[yAxisColumn] !== null && !isNaN(row[yAxisColumn]) &&
        (row.locusId in self.sgb.search_dict)
      ).map(row => ({
        gene: self.sgb.search_dict[row.locusId].gene_data,
        x: row[row_name],
        y: row[yAxisColumn]
      }));

      // Update scales
      xScale = d3.scaleLinear()
        .domain([d3.min(plotData, d => d.x), d3.max(plotData, d => d.x)])
        .range([0, width]);

      yScale = d3.scaleLinear()
        .domain([d3.min(plotData, d => d.y), d3.max(plotData, d => d.y)])
        .range([height, 0]);

      // Remove existing elements
      svg.selectAll('*').remove();

      // Add axes
      svg.append('g')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(xScale));

      svg.append('g')
        .call(d3.axisLeft(yScale));

      // Add points
      svg.selectAll('.dot')
        .data(plotData)
        .enter().append('circle')
        .attr('class', 'dot')
        .attr('cx', d => xScale(d.x))
        .attr('cy', d => yScale(d.y))
        .attr('r', 3)
        .attr('fill', '#333')
        .on('click', (event, d) => {
          self.sgb.display_gene(d.gene.locusId);
        })
        .on('mouseover', function(event, d) {
          d3.select(this)
            .attr('fill', 'red')
            .raise();
          self.sgb.default_gene_tooltip_func(event, d.gene);
        })
        .on('mouseout', () => {
          svg.selectAll('.dot').attr('fill', '#333')
          self.sgb.hide_tooltip();
        });

        // Add axis labels
        svg.append("text")
          .attr("x", width / 2)
          .attr("y", height + margin.bottom)
          .style("text-anchor", "middle")
          .style("font-size", "10px")
          .text(row_name);

        svg.append("text")
          .attr("transform", "rotate(-90)")
          .attr("y", 0 - margin.left)
          .attr("x",0 - (height / 2))
          .attr("dy", "1em")
          .style("text-anchor", "middle")
          .style("font-size", "10px")
          .text(yAxisColumn);
    }
    updateScatterplot();

    self.sgb.sidebar_content.node().scrollTop = 0;
    self.sgb.show_sidebar(null, 380); // force a 380px sidebar
  }

  load_region() {
    const self = this;
    self.filter_by_region();
    //console.log('Filtered heatmap data', self.filt_data);
    // Clear the canvas
    self.ctx.clearRect(0, 0, self.sgb.display_w, self.h);

    // Create pixel map and render canvas in a single loop
    self.pixelMap = Array(self.sgb.display_w).fill(null).map(() => Array(self.h).fill(null));

    for (let dataIndex = 0; dataIndex < self.filt_data.length; dataIndex++) {
      const d = self.filt_data[dataIndex];
      const [left, right] = self.sgb.get_feature_pixel_position(d.begin, d.end);

      for (let colIndex = 0; colIndex < self.display_columns.length; colIndex++) {
        if (d[self.display_columns[colIndex]]) {
          const y = self.block_ys[colIndex];
          if (self.get_feature_block_fill) {
            self.ctx.fillStyle = self.get_feature_block_fill(d, self.display_columns[colIndex]);
          } else {
            self.ctx.fillStyle = self.divergingColorScale(d[self.display_columns[colIndex]]);
          }
          self.ctx.fillRect(left, y, right - left, self.block_h);
          if (self.get_feature_block_stroke) {
            self.ctx.strokeStyle = self.get_feature_block_stroke(d, self.display_columns[colIndex]);
            self.ctx.strokeRect(left, y, right - left, self.block_h);
          }
          self.ctx.fillRect(left, y, right - left, self.block_h);
          for (let x = Math.max(0, Math.floor(left)); x < Math.min(self.sgb.display_w, Math.ceil(right)); x++) {
              for (let py = Math.max(0, Math.floor(y)); py < Math.min(self.h, Math.ceil(y + self.block_h)); py++) {
                self.pixelMap[x][py] = { 'dataIndex': dataIndex, 'colIndex': colIndex };
              }
          }
        }
      }
    }

    // move the canvas with the svg
    self.canvas.style('left', 0);

  }

  handleMousemove(event) {
    const self = this;
    const mouseX = Math.floor(event.offsetX);
    const mouseY = Math.floor(event.offsetY);

    if (self.pixelMap && mouseX >= 0 && mouseX < self.pixelMap.length && mouseY >= 0 && mouseY < self.pixelMap[0].length) {
      const pixelInfo = self.pixelMap[mouseX][mouseY];

      if (pixelInfo) {
        const d = self.filt_data[pixelInfo.dataIndex];
        const [left, right] = self.sgb.get_feature_pixel_position(d.begin, d.end);
        const y = self.block_ys[pixelInfo.colIndex];

        self.highlightRect
          .attr('x', left)
          .attr('y', y)
          .attr('width', right - left)
          .attr('height', self.block_h)
          .style('visibility', 'visible');
        const column = self.display_columns[pixelInfo.colIndex];
        if (self.hover_function) self.hover_function(event, column, d);

        // keeping track of who was hovered and giving the option of a callback outside the track
        self.hoveredIndex = d.sgb_index;
        if (self.callback) self.callback('mouseover', d.sgb_index, column);

        return; // exit early as we found a hit
      }
    }
    // If no hit hide tooltip and highlight
    self.highlightRect.style('visibility', 'hidden');
    self.sgb.hide_tooltip();
  }

  handleMouseout() {
    this.highlightRect.style('visibility', 'hidden');
    this.sgb.hide_tooltip();
    if (this.callback) this.callback('mouseout', this.hoveredIndex);
  }

  handleClick(event) {
    const self = this;
    const mouseX = Math.floor(event.offsetX);
    const mouseY = Math.floor(event.offsetY);
    if (self.pixelMap && mouseX >= 0 && mouseX < self.pixelMap.length && mouseY >= 0 && mouseY < self.pixelMap[0].length) {
      const pixelInfo = self.pixelMap[mouseX][mouseY];

      if (pixelInfo) {
        const d = self.filt_data[pixelInfo.dataIndex];
        const column = self.display_columns[pixelInfo.colIndex];
        if (self.click_function) self.click_function(event, column, d);
        if (self.callback) self.callback('click', d.sgb_index, column);
      }
    }
  }

  hover_function(e, column, gene_object) {
    // default hover function
    const self = this;
    if (gene_object) {
      const { locusId, name, desc } = gene_object;
  
      let html = `
          <div class="gene_tooltip">
            <p><strong>Locus ID:</strong> ${locusId}</p>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Description:</strong> ${desc}</p>
            <p><strong>${column}:</strong> ${gene_object[column]}</p>
          </div>
        `
      
      self.sgb.tooltip.selectAll('*').remove();
      self.sgb.tooltip.html(html);
      self.sgb.show_tooltip(e.x, e.y)
    }
  }

}

class quantitativeYaxesTrack extends baseTrack {
  /**
   * Base class for tracks displaying quantitative data with multiple y axes
   * Uses a canvas for rendering and provides methods for handling mouse interactions.
   * Designed to be extended by tracks displaying points or lines representing quantitative values.
   * can be set up to use static data or to pull data from a server in load_region
   * Abstract class - `getData` and `drawData` methods must be implemented by subclasses.
   *
   * @param {SimpleGenomeBrowser} sgb - The SimpleGenomeBrowser instance this track belongs to.
   * @param {string} name - The name of the track.
   * @param {number} h - The height of the track in pixels.
   * @param {number} top - The top position of the track in pixels.
   * @param {object} [config={}] - An optional configuration object for the track.
   *
   * @param {object} [config] - Configuration object for the quantitativeYaxesTrack.
   * @param {number[]} [config.yticks=[0.1, 1, 10, 100, 1000]] - Array of y-axis tick values.
   * @param {function} [config.ytick_formatter=(d => d)] - Function to format y-axis tick labels.
   * @param {boolean} [config.clip=false] - If true, clip values to the y-axis range.
   * @param {boolean} [config.log_y=false] - If true, use a logarithmic y-axis scale.
   *  Inherits configuration options from `baseTrack`.
   *
   * @customizable_methods
   * - `getData(low, high, contig)`: **Must be overridden.**  Implement data fetching for the given genomic region (`low`, `high`, `contig`).
   *                                Should return a Promise that resolves to the data to be displayed.
   * - `drawData(data, yScales)`: **Must be overridden.** Implement the canvas drawing logic for the track, using the loaded `data` and the provided `yScales` (d3 scales for each quantitative column).
   * - `highlight_function(event, pixelInfo)`: Define to customize what to *draw* when an element is hovered
   *                                           (typically defined in child classes to show overlay svgelement)
   * - `hover_function(event, pixelInfo)`: Define to customize what to do when an element is hovered
   *                                       pixelInfo is defined in the pixelMap of the child element, but typically has
   *                                       a data attribute and some info about the element's position
   * - `click_function(event, pixelInfo)`: Define to customize what to do when an element is clicked
   *                                       pixelInfo is defined in the pixelMap of the child element, but typically has
   *                                       a data attribute and some info about the element's position
   */

  constructor(sgb, name, h, top, config) {
    super(sgb, name, h, top, config);
    const self = this;
    self.config = config;
    self.load_threshold = config.load_threshold || 1000000;
    self.yticks = config.yticks || [0.1, 1, 10, 100, 1000];
    self.ytick_formatter = config.ytick_formatter || (d => d==0.1 ? 0 : d);
    self.clip = config.clip || false;
    self.log_y = config.log_y || false;

    self.canvas_div = self.div.append('div')
      .attr('id', 'canvasdiv')
      .style('z-index', 0);

    self.svg.style('z-index', 1);

    self.canvas = self.canvas_div.append('canvas')
      .attr('width', self.sgb.display_w)
      .attr('height', self.h)
      .style('position', 'absolute')
      .style('left', 0)
      .style('top', 0);

    self.ctx = self.canvas.node().getContext('2d');

    self.pixelMap = null;

    self.svg
      .on('mousemove', (event) => self.handleMousemove(event))
      .on('mouseout', () => self.handleMouseout())
      .on('click', (event) => self.handleClick(event));
  }

  async load_region() {
    const self = this;
    const [low, high] = self.sgb.expanded_domain;
    self.region_start = self.sgb.circular_coordinate(self.sgb.expanded_domain[0]);
    self.region_end = self.sgb.circular_coordinate(self.sgb.expanded_domain[1]);
    const contig = self.sgb.contig;
    // Making a duplicate canvas to draw on and then deleting the
    // old one at the end
    const old_canvas = self.canvas;
    self.canvas = self.canvas_div.append('canvas')
      .attr('width', self.sgb.display_w)
      .attr('height', self.h)
      .style('position', 'absolute')
      .style('left', 0)
      .style('top', 0);
    self.ctx = self.canvas.node().getContext('2d');
    self.ctx.clearRect(0, 0, self.sgb.display_w, self.h);
    self.pixelMap = Array(self.sgb.display_w).fill(null).map(() => Array(self.h).fill(null));

    // Loading data
    const data = await self.getData(low, high, contig);
    if (data === undefined) {
      console.error(`Error loading data for track ${self.name}`);
      old_canvas.remove();
      return;
    }
    
    // Scales for the y-axes (log scale)
    let yScales = [];
    const fraction_buf = 0.1*self.h;
    const yrange_size = (self.h - fraction_buf*(self.columnNames.length+2)) / self.columnNames.length;
    const use_domain = [self.yticks[0], self.yticks[self.yticks.length-1]];

    self.svg.selectAll('.yline').remove();
        
    for (let i=0; i<self.columnNames.length; i++) {
      let bottom = (yrange_size+fraction_buf)*(i+1);
      let top = bottom-yrange_size;
      let tmp_scale = (self.log_y) ? d3.scaleLog() : d3.scaleLinear();
      tmp_scale = (self.clip) ? tmp_scale.range([bottom, top]).clamp(true).domain(use_domain).nice() : tmp_scale.range([bottom, top]).domain(use_domain).nice();
      
      yScales.push(tmp_scale);
      self.svg.selectAll('.yline'+String(i))
        .data(self.yticks)
        .enter()
        .append('line')
          .attr('class', 'yline yline'+String(i))
          .attr('x1', 0)
          .attr('x2', self.sgb.display_w)
          .attr('y1', d => yScales[i](d))
          .attr('y2', d => yScales[i](d))
          .attr('stroke', 'black')
          .attr('stroke-width', d => (d == self.yticks[0] || d == self.yticks[self.yticks.length-1]) ? 1 : 0.25)
    }

    if (self.axis_elements) self.axis_elements.remove();
    self.axis_elements = self.svg.append('g');
    self.axis_elements.append('rect')
      .attr('x', self.sgb.w)
      .attr('width', 45)
      .attr('y', 0)
      .attr('height', self.h)
      .attr('fill', 'white')
    
    for (let i=0; i<self.columnNames.length; i++) {
      const yAxis = d3.axisLeft(yScales[i])
        .tickValues(self.yticks)
        .tickFormat(self.ytick_formatter)
        .tickSize(0)
          
      self.axis_elements.append('g')
        .attr('class', 'yaxis yaxis'+String(i))
        .attr("transform", `translate(${self.sgb.w+45},0)`)
        .call(yAxis);
              
      self.axis_elements.append('text')
        .attr('class', 'countPlotTitle'+String(i))
        .attr("y", yScales[i](self.yticks[self.yticks.length-1])-5)
        .attr("x", self.sgb.display_w/2)
        .html(self.fullColumnNames[i]);
    }
        
    this.drawData(data, yScales);

    old_canvas.remove();    
    // move the canvas with the svg
    self.canvas.style('left', 0);

  }
    
  handleMouseout() {
    if (this.highlightElement) this.highlightElement.style('visibility', 'hidden');
    this.sgb.hide_tooltip();
  }

  handleClick(event) {
    const self = this;
    const mouseX = Math.floor(event.offsetX);
    const mouseY = Math.floor(event.offsetY);
    if (self.pixelMap && mouseX >= 0 && mouseX < self.pixelMap.length && mouseY >= 0 && mouseY < self.pixelMap[0].length) {
      const pixelInfo = self.pixelMap[mouseX][mouseY];
      if (pixelInfo) {
        console.log('Clicked on:', pixelInfo);
        if (self.click_function) self.click_function(event, pixelInfo);
      }
    }
  }

  handleMousemove(event) {
    const self = this;
    const mouseX = Math.floor(event.offsetX);
    const mouseY = Math.floor(event.offsetY);
    if (self.pixelMap && mouseX >= 0 && mouseX < self.pixelMap.length && mouseY >= 0 && mouseY < self.pixelMap[0].length) {
      const pixelInfo = self.pixelMap[mouseX][mouseY];
      if (pixelInfo) {
        const d = pixelInfo.data;
        const column = pixelInfo.column;
        if (self.hover_function) self.hover_function(event, pixelInfo);
        if (self.highlight_function) self.highlight_function(event, pixelInfo);
      } else {
        self.handleMouseout();
      }
    } else {
      self.handleMouseout();
    }
  }

  async drawData(data, yScales){
    throw new Error("drawData() must be implemented by child class");
  }

  async getData(low, high, contig){
    throw new Error("getData() must be implemented by child class");
  }

}

class quantitativePointTrack extends quantitativeYaxesTrack {
  /**
   * Extends `quantitativeYaxisTrack` to display quantitative data as points on a canvas.
   * Suitable for tracks showing scatter plot-like data along the genome.
   *
   * @param {SimpleGenomeBrowser} sgb - The SimpleGenomeBrowser instance this track belongs to.
   * @param {string} name - The name of the track.
   * @param {number} h - The height of the track in pixels.
   * @param {number} top - The top position of the track in pixels.
   * @param {object} [config={}] - An optional configuration object for the track.
   * @param {string} contig_col - The column name in the data specifying the contig/chromosome ID.
   * @param {string} pos_column - The column name in the data specifying the genomic position of the point.
   *
   * @param {object} [config] - Configuration object for the quantitativePointTrack.
   *  Inherits configuration options from `quantitativeYaxisTrack` and `baseTrack`.
   *
   * @customizable_methods
   * - `drawData(data, yScales)`: Override to customize how points are rendered on the canvas. The default implementation draws circles.
   * - `getData(low, high, contig)`: **Must be overridden.** Implement data fetching for point data.
   * - `highlight_function(event, pixelInfo)`: Override to customize what to *draw* when an element is hovered
   * - `hover_function(event, pixelInfo)`: Override to customize what to do when an element is hovered
   *                                       pixelInfo is defined in the pixelMap of the child element, but typically has
   *                                       a data attribute and some info about the element's position
   * - `click_function(event, pixelInfo)`: Define to customize what to do when an element is clicked
   *                                       pixelInfo is defined in the pixelMap of the child element, but typically has
   *                                       a data attribute and some info about the element's position
   */
  constructor(sgb, name, h, top, config, contig_col, pos_column) {
    super(sgb, name, h, top, config)
    this.contig_col = contig_col;
    this.pos_column = pos_column;
    this.pointRadius = 2;
    this.highlightElement = this.svg.append('circle')
      .attr('r', this.pointRadius * 1.5)
      .attr('fill', 'red')
      .style('visibility', 'hidden');
  }

  drawData(data, yScales) {
    const self = this;
    data.forEach(d => {
      const x = self.sgb.get_coordinate_pixel_position(d[self.pos_column]);
      if (x >= 0 && x <= self.sgb.display_w) {
        for(let i=0; i<self.columnNames.length; i++) {
          const y1 = yScales[i](d[self.columnNames[i]]);
          self.ctx.fillStyle = (self.color_func) ? self.color_func(d, self.columnNames[i], self.fullColumnNames[i]) : "black";
          self.ctx.beginPath();
          self.ctx.arc(x, y1, self.pointRadius, 0, 2 * Math.PI);
          self.ctx.fill();
          // Add to pixel map
          for (let px = Math.max(0, Math.floor(x - self.pointRadius)); px <= Math.min(self.sgb.display_w - 1, Math.ceil(x + self.pointRadius)); px++) {
            for (let py = Math.max(0, Math.floor(y1 - self.pointRadius)); py <= Math.min(self.h - 1, Math.ceil(y1 + self.pointRadius)); py++) {
              self.pixelMap[px][py] = { data: d, column: self.columnNames[i], x: x, y: y1};
            }
          }
        }
      }
    })
  }

  highlight_function(event, pixelInfo) {
    this.highlightElement
      .style('visibility', 'visible')
      .attr('cx', pixelInfo.x)
      .attr('cy', pixelInfo.y);
  }

  hover_function(event, pixelInfo) {
    const d = pixelInfo.data;
    const column = pixelInfo.column;
    this.sgb.tooltip.selectAll('*').remove();
    this.sgb.tooltip.html(`${d.pos}: ${column} = ${d[column]}`);
    this.sgb.show_tooltip(event.pageX, event.pageY);
  }

}

class quantitativeLineTrack extends quantitativeYaxesTrack {
  /**
   * Extends `quantitativeYaxisTrack` to display quantitative data as horizontal lines on a canvas.
   * Suitable for tracks showing DNA fragment scores or similar range-based quantitative data.
   *
   * @param {SimpleGenomeBrowser} sgb - The SimpleGenomeBrowser instance this track belongs to.
   * @param {string} name - The name of the track.
   * @param {number} h - The height of the track in pixels.
   * @param {number} top - The top position of the track in pixels.
   * @param {object} [config={}] - An optional configuration object for the track.
   * @param {string} contig_col - The column name in the data specifying the contig/chromosome ID.
   * @param {string} begin_column - The column name in the data specifying the start genomic position of the line.
   * @param {string} end_column - The column name in the data specifying the end genomic position of the line.
   *
   * @param {object} [config] - Configuration object for the quantitativeLineTrack.
   *  Inherits configuration options from `quantitativeYaxisTrack` and `baseTrack`.
   *
   * @customizable_methods
   * - `drawData(data, yScales)`: Override to customize how lines are rendered on the canvas. The default implementation draws horizontal lines.
   * - `getData(low, high, contig)`: **Must be overridden.** Implement data fetching for line data.
   * - `highlight_function(event, pixelInfo)`: Override to customize what to *draw* when an element is hovered
   * - `hover_function(event, pixelInfo)`: Override to customize what to do when an element is hovered
   *                                       pixelInfo is defined in the pixelMap of the child element, but typically has
   *                                       a data attribute and some info about the element's position
   * - `click_function(event, pixelInfo)`: Define to customize what to do when an element is clicked
   *                                       pixelInfo is defined in the pixelMap of the child element, but typically has
   *                                       a data attribute and some info about the element's position
   */
  constructor(sgb, name, h, top, config, contig_col, begin_column, end_column) {
    super(sgb, name, h, top, config)
    this.contig_col = contig_col;
    this.begin_column = begin_column;
    this.end_column = end_column;
    this.lineWidth = 2;
    this.highlightElement = this.svg.append('line') // single line for highlighting
      .attr('stroke', 'red')
      .attr('stroke-width', this.lineWidth * 2) // Make highlight thicker
      .style('visibility', 'hidden');
  }

  drawData(data, yScales){
    const self = this;
    data.forEach(d => {
      const [x1, x2] = self.sgb.get_feature_pixel_position(d[self.begin_column], d[self.end_column]);
      //const x2 = self.sgb.get_coordinate_pixel_position(d[self.end_column]);
      //console.log(d[self.begin_column], d[self.end_column], x1, x2, self.sgb.display_w);
      // Only draw the line if *any* part of it is visible
      if ((x1 <= self.sgb.display_w && x1 >= 0) 
            || (x2 <= self.sgb.display_w && x2 >= 0) 
            || (x1 < 0 && x2 > self.sgb.display_w)
          ){
        for(let i=0; i<self.columnNames.length; i++) {
          //console.log(x1, x2, self.sgb.display_w);
          const y = yScales[i](d[self.columnNames[i]]);
          self.ctx.strokeStyle = (self.color_func) ? self.color_func(d, self.columnNames[i], self.fullColumnNames[i]) : "black";
          self.ctx.lineWidth = self.lineWidth;
          self.ctx.beginPath();
          self.ctx.moveTo(Math.max(0, x1), y);
          self.ctx.lineTo(Math.min(self.sgb.display_w,x2), y);
          self.ctx.stroke();
          // Add to pixel map (highlight entire line segment)
          const startX = Math.max(0,Math.min(x1,x2));
          const endX = Math.min(self.sgb.display_w, Math.max(x1,x2));
          for (let px = Math.max(Math.floor(startX), 0); px <= Math.min(Math.ceil(endX), self.sgb.display_w-1); px++) {
            // Adding some padding above and below for the line
            for(let py = Math.max(0, Math.floor(y - self.lineWidth)); py <= Math.min(self.h -1, Math.ceil(y+self.lineWidth)); py++) {
              try {
                self.pixelMap[px][py] = { data: d, column: self.columnNames[i], x1: x1, x2: x2, y: y};
              } catch (error) {
                console.log('Error adding to pixel map', px, py, self.pixelMap.length, self.pixelMap[0].length);
              }    
            }
          }
        }
      }
    });
  }

  highlight_function(event, pixelInfo) {
    this.highlightElement
      .style('visibility', 'visible')
      .attr('x1', pixelInfo.x1)
      .attr('x2', pixelInfo.x2)
      .attr('y1', pixelInfo.y)
      .attr('y2', pixelInfo.y);
  }

  hover_function(event, pixelInfo) {
    const d = pixelInfo.data;
    const column = pixelInfo.column;
    this.sgb.tooltip.selectAll('*').remove();
    this.sgb.tooltip.html(`${d[self.begin_column]}-${d[self.end_column]}: ${column} = ${d[column]}`);
    this.sgb.show_tooltip(event.pageX, event.pageY);
  }

}

export { SimpleGenomeBrowser, baseFeatureTrack, geneTrack, gffTrack, gbTrack, geneTableTrack, quantitativeFeatureTrack, quantitativeYaxesTrack, quantitativePointTrack, quantitativeLineTrack };