import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import * as autoCompleteJS from "https://cdn.jsdelivr.net/npm/@tarekraafat/autocomplete.js@10.2.7/dist/autoComplete.min.js";

const base_color = '#FCF0FC';

let tooltip;

// https://gist.github.com/tophtucker/62f93a4658387bb61e4510c37e2e97cf
function measureText(string, fontSize = 10) {
  const widths = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.2796875,0.2765625,0.3546875,0.5546875,0.5546875,0.8890625,0.665625,0.190625,0.3328125,0.3328125,0.3890625,0.5828125,0.2765625,0.3328125,0.2765625,0.3015625,0.5546875,0.5546875,0.5546875,0.5546875,0.5546875,0.5546875,0.5546875,0.5546875,0.5546875,0.5546875,0.2765625,0.2765625,0.584375,0.5828125,0.584375,0.5546875,1.0140625,0.665625,0.665625,0.721875,0.721875,0.665625,0.609375,0.7765625,0.721875,0.2765625,0.5,0.665625,0.5546875,0.8328125,0.721875,0.7765625,0.665625,0.7765625,0.721875,0.665625,0.609375,0.721875,0.665625,0.94375,0.665625,0.665625,0.609375,0.2765625,0.3546875,0.2765625,0.4765625,0.5546875,0.3328125,0.5546875,0.5546875,0.5,0.5546875,0.5546875,0.2765625,0.5546875,0.5546875,0.221875,0.240625,0.5,0.221875,0.8328125,0.5546875,0.5546875,0.5546875,0.5546875,0.3328125,0.5,0.2765625,0.5546875,0.5,0.721875,0.5,0.5,0.5,0.3546875,0.259375,0.353125,0.5890625]
  const avg = 0.5279276315789471
  return string
    .split('')
    .map(c => c.charCodeAt(0) < widths.length ? widths[c.charCodeAt(0)] : avg)
    .reduce((cur, acc) => acc + cur) * fontSize
}

class SimpleGenomeBrowser {

  constructor(fasta_file, circular, w, h, div, starting_contig=null, starting_domain=null, fastdrag=true) {
    const self = this;
    self.tracks = [];
    self.fasta_file = fasta_file;
    self.circular = circular;
    self.w = w;
    self.h = h;
    self.div = div;
    self.fastdrag = fastdrag;
    self.display_w = fastdrag ? w*3 : w;
    self.display_left = fastdrag ? -1*w : 0;
    self.midpoint = self.w/2;
    // 1) Read in fasta file
    self.seqs = {}; 
    self.seq_lens = {};
    self.loadingPromise = new Promise((resolve, reject) => {
      fetch(self.fasta_file)
        .then(response => response.text())
        .then(data => {
          let currentSeq = "";
          let currentSeqName = "";
          data.split("\n").forEach(line => {
            if (line.startsWith(">")) { 
              if (currentSeqName !== "") {
                self.seqs[currentSeqName] = currentSeq;
                self.seq_lens[currentSeqName] = currentSeq.length;
              }
              currentSeqName = line.slice(1).split(' ')[0];
              currentSeq = "";
            } else {
              currentSeq += line.trim();
            }
          });
          // Add the last sequence
          if (currentSeqName !== "") {
            self.seqs[currentSeqName] = currentSeq;
            self.seq_lens[currentSeqName] = currentSeq.length;
          }
          if (starting_contig in self.seqs) {
            self.starting_contig = starting_contig;
            self.starting_domain = starting_domain;
          } else {
            self.starting_contig = Object.keys(self.seqs)[0];
            self.starting_domain = [Math.floor(self.seq_lens[self.starting_contig]/4), Math.floor(3*self.seq_lens[self.starting_contig]/8)];
          }
          self.build_basic_browser();
          self.setup_tooltip();
          self.make_search_bar();
          resolve(this);
        });
      });
  }

  setup_tooltip() {
    this.tooltip = d3.select('body').append('div')
      .style('visibility', 'hidden') 
      .style("background-color", "rgba(255, 255, 255, 0.8)") // Use rgba() for opacity
      .style("border-radius", "5px")
      .style("padding", "5px")
      .style("width", "150px")
      .style("color", "black")
      .style('position', 'absolute')
      .style('pointer-events', 'none')
      .style('text-align', 'center')
      .html('<h2>yeah</h2><p>uhhuh</p>');
  }

  show_tooltip(x, y, text) {
    this.tooltip
      .style('left', x-75)
      .style('top', y+20)//-8-tooltip.node().offsetHeight);
      .style('visibility', 'visible')
      .html(text);
  }

  move_tooltip(x, y) {
    this.tooltip
      .style('left', x-75)
      .style('top', y+20)//-8-tooltip.node().offsetHeight);
  }
  
  hide_tooltip() {
    this.tooltip.style('visibility', 'hidden');
  }

  make_contig_picker() {
    const self = this;
    self.contig_picker = self.outer_div.append('select')
      .attr('id', "contig_picker")
      .style("position", "absolute")
      .style("top", "5px")
      .style("right", "15px")
      .style("width", "170px")
      .style("height", "15px")
      .style("outline", "none")
      .style("border", "none")
      .style("background-color", "#FFF")
      .style("color", "#333")
      .on('focus', function () { d3.select(this).style('color', '#000')})
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
      .attr('id', 'search_div');
    self.gene_search = self.search_div.append('input')
      .attr('id', "gene_searchbar")
      .attr('type', 'search')
      .attr('spellcheck', 'false')
      .attr('autocomplete', 'off')
      .style("position", "absolute")
      .style("top", "15px")
      .style("left", "15px")
      .style("width", "170px")
      .style("height", "15px")
      .style("outline", "none")
      .style("border", "none")
      .style("background-color", "#FFF")
      .style("color", "#333")
      .on('focus', function () { d3.select(this).style('color', '#000')})
      .on('blur', function() { d3.select(this).style('color', '#333')});
  
    self.search_dict = {};

    self.autoCompleteEl = new autoComplete({
        placeHolder: "Search for gene names...",
        selector: '#gene_searchbar',
        //data: {src: Object.keys(self.search_dict)},//gene_list},
        events: {
            input: {
                selection: (event) => {
                    const selection = event.detail.selection.value;
                    self.autoCompleteEl.input.value = '';
                    self.search_click(selection);
                    document.getElementById('gene_searchbar').blur(); //removes focus so the cursor leaves
                }
            }
        }
    });

    self.autoCompleteEl.data = {src: ['you know', 'maybe']};
  }

  search_click(selection) {
    const search_result = this.search_dict[selection];
    if ('callback' in search_result) {
      search_result.callback(search_result);
    }
    this.display_region({
      'contig': search_result.contig,
      'domain': [search_result.left, search_result.right]
    });
  }

  circular_coordinate = (d) => {
    // Converts a linear coordinate to a circular coordinate within the contig.
    // the this variable is the class (self) if I use an arrow function
    // (don't totally get this, but works)
    return d < 0 ? this.contig_len + (d % this.contig_len) : d % this.contig_len;
  }

  new_contig(contig_name, starting_domain=null) {
    console.log(contig_name);
    this.contig = contig_name;
    this.contig_len = this.seq_lens[this.contig];
    this.contig_picker.property('value', this.contig);
    console.log(this.contig_len)
    if (starting_domain) {
      this.set_domain(starting_domain);
    } else {
      this.set_domain([Math.floor(this.contig_len/10), Math.floor(this.contig_len/5)])
    }
    for (let track of this.tracks) {
      track.filter_by_contig(track.contig_column);
    }
    this.display_region();
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
      proposed_domain = [Math.max(proposed_domain[0], 0), Math.min(proposed_domain[1], this.contig_len)];
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
    this.first_half = (d[0] + d[1])/this.contig_len < 0.5;
    // If this expanded domain includes zero, it's important
    // to know if the original domain (which sets the scale)
    // was low (near zero) or high (near the contig len)
    this.scale_near_zero = (this.initial_domain_includes_zero || this.first_half);
  }

  make_controls() {
    const self = this;

    self.controls_svg = self.outer_div.append('svg')
      .attr('width', self.w)
      .attr('height', self.controls_h)
    self.zoom_in_g = self.controls_svg.append('g')
      .attr('class', 'zoom_thing')
      .on('click', function() {
        self.display_region(self.zoom_in());
      })
    self.zoom_out_g = self.controls_svg.append('g')
      .attr('class', 'zoom_thing')
      .on('click', function() {
        self.display_region(self.zoom_out());
      })
    self.zoom_in_g.append('circle')
      .attr('cx', self.midpoint+17)
      .attr('cy', self.top+5)
      .attr('r', 6)
      .attr('stroke', base_color)
    self.zoom_in_g.append('line')
      .attr('x1', self.midpoint+17-3)
      .attr('x2', self.midpoint+17+3)
      .attr('y1', self.top+5)
      .attr('y2', self.top+5)
      .attr('stroke', base_color)
    self.zoom_in_g.append('line')
      .attr('x1', self.midpoint+17)
      .attr('x2', self.midpoint+17)
      .attr('y1', self.top+5-3)
      .attr('y2', self.top+5+3)
      .attr('stroke', base_color)
    self.zoom_out_g.append('circle')
      .attr('cx', self.midpoint-17)
      .attr('cy', self.top+5)
      .attr('r', 6)
      .attr('stroke', base_color)
    self.zoom_out_g.append('line')
      .attr('x1', self.midpoint-17-3)
      .attr('x2', self.midpoint-17+3)
      .attr('y1', self.top+5)
      .attr('y2', self.top+5)
      .attr('stroke', base_color)

    self.x_scale = d3.scaleLinear().range(self.x_range).domain(self.domain);
    self.x_axis = d3.axisTop(self.x_scale)
      .ticks(6)
      .tickFormat(self.circular_coordinate);
    self.x_ax_element = self.controls_svg.append('g')
      .attr('class', 'axis')
      .attr('transform', 'translate(0, '+String(self.top+30)+')')
      .call(self.x_axis);
  }

  setup_drag() {
    const self = this;
    self.dragAction = d3.drag()
    .filter(function(e) {
      return !d3.select(e.target).classed('tnseq_block');
    })
    .on('start', function(e) {
      self.drag_start_domain = self.x_scale.domain();
      self.drag_start = self.x_scale.invert(e.x);
      self.drag_start_mouse = e.x;
      self.tmp_scale = d3.scaleLinear().range(self.x_range).domain(self.domain);
      self.tmp_axis = d3.axisTop(self.tmp_scale)
        .ticks(6)
        .tickFormat(self.circular_coordinate);
      self.x_ax_element.remove();
      self.x_ax_element = self.controls_svg.append('g')
        .attr('class', 'axis')
        .attr('transform', 'translate(0, '+String(self.top+30)+')')
        .call(self.tmp_axis);
    })
    .on('drag', function(e) {
      const x_pos = self.x_scale.invert(e.x);
      const x_change = x_pos-self.drag_start;
      const x_change_mouse = e.x-self.drag_start_mouse;
      self.set_domain(self.get_domain([self.drag_start_domain[0]-x_change, self.drag_start_domain[1]-x_change]))
      self.tmp_scale.domain(self.domain)
      self.x_ax_element.call(self.tmp_axis.scale(self.tmp_scale));
      for (let t of self.tracks) {
        t.g.attr('transform', 'translate('+String(x_change_mouse)+',0)');
      }
    })
    .on('end', function(e) {
      self.x_scale = self.tmp_scale;
      self.x_axis = self.tmp_axis;
      self.display_region();
    })
    self.outer_div.call(self.dragAction);
  }

  build_basic_browser() {
    const self = this;

    // layout constants
    self.top = 10;
    self.controls_h = 50;
    self.x_range = [40, self.w-40];

    self.outer_div = self.div.append('div')
      .style('width', self.w)
      .style('height', self.h)
      .style('position', 'relative')
      .style('border', '2px solid black')
      .style('overflow', 'hidden')

    self.contig = self.starting_contig;
    self.contig_len = self.seq_lens[self.contig];

    self.set_domain(self.starting_domain);
    self.make_controls();
    self.setup_drag();
    self.make_contig_picker();
    self.display_region();
  }

  zoom_in() {
    return {'domain': this.get_domain([this.domain[0]+this.domain_wid/4, this.domain[1]-this.domain_wid/4])};
  }

  zoom_out() {
    return {'domain': this.get_domain([this.domain[0]-this.domain_wid, this.domain[1]+this.domain_wid])};
  }

  display_region(new_region=null) {
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
    self.x_ax_element.attr('transform', 'translate(0, '+String(self.top+30)+')').call(self.x_axis);
    for (let t of self.tracks) {
      t.display_region();
    }
  }

}

class baseFeatureTrack {
  // this is to be extended to tracks with data stored
  // in arrays with start and end attributes
  constructor(sgb, h, top) {
    const self = this;
    self.sgb = sgb;
    self.h = h;
    self.top = top;
    self.svg = self.sgb.outer_div.append('svg')
      .attr('width', self.sgb.display_w)
      .attr('height', self.h)
      .style('position', 'absolute')
      .style('left', self.sgb.display_left)
      .style('top', self.top)
    self.g = self.svg.append('g')
  }

  get_feature_pixel_position(d, self) {
    let left = self.sgb.x_scale(d.start);
    let right = self.sgb.x_scale(d.end);
    if (self.sgb.expanded_domain_includes_zero) { // some are out of scale
      if (self.sgb.scale_near_zero) {
        // the scale is near zero (scale overflow to the left)
        if ((d.start > this.region_start) || (d.end > this.region_start)) {
          left = self.sgb.x_scale(d.start-self.sgb.contig_len);
          right = self.sgb.x_scale(d.end-self.sgb.contig_len);
          //console.log('if', d.label, left, right)
        }
      } else if ((d.start < this.region_end) || (d.end < this.region_end)) {
        // the scale is near the contig len (scale overflow to the right)
        left = self.sgb.x_scale(d.start+self.sgb.contig_len);
        right = self.sgb.x_scale(d.end+self.sgb.contig_len);
        //console.log('if2', d.label, left, right)
      }  
    }
    // shifting to make the scale right
    left += self.sgb.w;
    right += self.sgb.w;
    return [left, right];
  }

  filter_by_contig(chromo_column='chromosome') {
    const self = this;
    self.contig_filt = self.data.filter((d) => d[chromo_column] == self.sgb.contig);
  }

  filter_one_by_region(feat_start, feat_end) {
    // last condition for features that cross 0
    if (this.sgb.expanded_domain_includes_zero) {
      return ((feat_start < this.region_end) || (feat_end > this.region_start) || (feat_end < feat_start))
    } else {
      return (feat_start < this.region_end) && (feat_end > this.region_start);
    }
  }

  filter_by_region() {
    const self = this;
    self.region_start = self.sgb.circular_coordinate(self.sgb.expanded_domain[0]);
    self.region_end = self.sgb.circular_coordinate(self.sgb.expanded_domain[1]);
    self.filt_data = self.contig_filt.filter((d) => self.filter_one_by_region(d.start, d.end));
  }
}


class gffTrack extends baseFeatureTrack {

  constructor(sgb, h, top, gff_file, type_filter='gene') {
    super(sgb, h, top)
    const self = this;
    self.gff_file = gff_file;
    self.contig_column = 'chromosome';
    d3.text(gff_file).then(function(tdata) {
      self.data = d3.tsvParseRows(tdata.split('\n').filter((line) => (!line.startsWith('#'))).join('\n'), self.gff_parse);
      console.log(self.data)
      if (type_filter) {
        self.data = self.data.filter((d) => d.type==type_filter);
      }
      for (let row of self.data) {
        row.attributes.split(';').forEach(function(pair) {
          let keyVal = pair.split('=');
          row[keyVal[0]] = keyVal[1];
        })
        row['label'] = row['gene'] || row['locus_tag'];
        // Adding info to the search index
        const size = row['end']-row['start'];
        self.sgb.search_dict[row['label']] = {
          'contig': row['chromosome'],
          'left': row['start']-size/2,
          'right': row['end']+size/2
        }
      }
      // Updating autocomplete search bar
      self.sgb.autoCompleteEl.data = {src: Object.keys(self.sgb.search_dict)};
      self.filter_by_contig();
      console.log('gff data loaded:', self.data);
      self.display_region()
    })
  }

  gff_parse(r) {
    return {
      'chromosome': r[0], 
      'type': r[2], 
      'start': parseInt(r[3]), 
      'end': parseInt(r[4]),
      'strand': r[6],
      'phase': r[7],
      'attributes': r[8]
    }
  }

  display_region() {
    const self = this;
    self.filter_by_region();
    console.log('Filtered data', self.filt_data);
    // remove holder g element, then remake
    self.g.remove()
    self.g = self.svg.append('g')
    self.g.selectAll('.feature_blocks')
      .data(self.filt_data)
      .enter()
      .append('g')
        .attr('class', 'sgb_gene')
        .attr('opacity', 0.8)
        .on('mouseover', (e, d) => self.sgb.show_tooltip(e.x, e.y, d.label))
        .on('mousemove', (e) => self.sgb.move_tooltip(e.x, e.y))
        .on('mouseout', () => self.sgb.hide_tooltip())
        .html((d) => self.make_gene_display(d, self));
  }

  make_gene_display(d, self) {
    const [left, right] = self.get_feature_pixel_position(d, self);
    const width = right-left;
    const height = Math.max(Math.min(30, 1000000/self.sgb.domain_wid), 20);
    const halfHeight = height / 2;
    const chevron_size = (width < 10) ? 0 : Math.min(width/4, 20);
    const top = 20
    const points = d.strand === '-' ? `${left},${top+halfHeight} ${left+chevron_size},${top+height} ${left+width},${top+height} ${left+width},${top} ${left+chevron_size},${top}` : `${right},${top+halfHeight} ${right-chevron_size},${top+height} ${right-width},${top+height} ${right-width},${top} ${right-chevron_size},${top}`;

    const fontsizes = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30]
    const textBuf = 2.5
    let label = d.label
    let fontsize = fontsizes[0]
    let labelsize = measureText(label, fontsize)
    let labelVisible = (labelsize+2*textBuf+chevron_size < right-left)
    if (labelVisible) {
      for (let f of fontsizes) {
        labelsize = measureText(label, f)
        if (labelsize+2*textBuf+chevron_size < right-left) {
          fontsize = f
        } else {
          break
        }
      }
    }
    const x_pos = d.strand === '+' ? left+textBuf : left+textBuf+chevron_size;
    const y_pos = top+height-textBuf-2;
    const stroke = base_color;
    const strokeWid = 1;
    const chev = `<polygon points="${points}" stroke=${stroke} fill="#333" stroke-width=${strokeWid} />`
    const label_use = labelVisible ? `<text x=${x_pos} y=${y_pos} fill="#FFF">${label}</text>` : '';
    return chev+label_use;
  }
}

/// CURRENT STATUS
// Interactivity
// Gene search
// Linked scatterplots
// Make one for BHKY, HP22, SCR3

// on click, pull up tnseq data?
// or make example tnseq tracks

class myTnseqTrack extends baseFeatureTrack {

  constructor(sgb, h, top, tnseq_file, display_columns, display_names, contig_column) {
    super(sgb, h, top);
    const self = this;
    self.tnseq_file = tnseq_file;
    self.display_columns = display_columns;
    self.display_names = display_names;
    self.contig_column = contig_column
    self.block_h = (self.h*0.8/self.display_columns.length)*0.9
    self.block_ys = Array.from({ length: display_columns.length}, (_, i) => self.h*0.1+self.block_h*(1/0.9)*i);


    self.divergingColorScale = d3.scaleDiverging()
      .domain([-4, 0, 4]) 
      .range(["red", "white", "blue"]); 
    self.loadingPromise = new Promise((resolve, reject) => {
      d3.tsv(tnseq_file, d3.autoType).then(function(tdata) {
        self.data = tdata;
        let i = 0
        for (let row of self.data) {
          row['sgb_index'] = i;
          i += 1;
        }
        console.log('tnseq data loaded:', self.data);      
        self.filter_by_contig(self.contig_column);
        console.log('filtered', self.contig_filt);
        self.display_column_names();
        self.display_region();
        resolve(self);
      });
    });
  }

  register_callback_on_row_name_click(func) {
    this.row_name_click = func;
  }

  display_column_names() {
    const self = this;
    self.row_backgrounds = self.svg.append('g')
    self.key_g = self.svg.selectAll('.tnseq_key_row')
      .data(self.display_columns)
      .enter()
      .append('g')
        .attr('class', 'tnseq_key_row')
        .on('click', (e, d) => this.row_name_click(d))

    self.svg.selectAll('.tnseq_key_row').append('rect')
        .attr('x', self.sgb.w+10)
        .attr('y', (d, i) => self.block_ys[i]-self.block_h*(0.05/0.9))
        .attr('width', 200)
        .attr('height', self.block_h*(1/0.9))
        .attr('fill', (d, i) => i % 2 == 0 ? '#DDD' : '#FFF')

    self.svg.selectAll('.tnseq_key_row').append('text')
      .attr('x', self.sgb.w+10)
      .attr('y', (d, i) => self.block_ys[i]+self.block_h*0.8)
      .attr('fill', 'black')
      .attr('font-size', Math.min(self.block_h, 16))
      .html((d, i) => self.display_names[i])

  }

  display_region() {
    const self = this;
    self.filter_by_region();
    console.log('Filtered data', self.filt_data);
    // remove holder g element, then remake
    self.g.remove();
    self.g = self.svg.append('g');
    self.g.lower(); // lowers behind key
    const featureBlocks = self.g.selectAll('.feature_blocks')
      .data(self.filt_data)
      .enter()
      .append('g');

    // For each feature block, append a rectangle for
    // each column in self.display_columns, with height
    // self.block_h-2, positioned on top of each other
    // and colored like divergingColorScale(val, -4, 4, 0)
    // ...
    featureBlocks.each(function(d) { 
      const block = d3.select(this); // Select the current feature block group
      const [left, right] = self.get_feature_pixel_position(d, self);
      self.display_columns.forEach((column, i) => {
        block.append('rect')
          .datum(d) // Bind the data to each rectangle
          .attr('class', 'tnseq_block')
          .attr('x', left)
          .attr('y', self.block_ys[i]) // Position based on column index
          .attr('width', right-left) 
          .attr('height', self.block_h)// - 2) 
          .attr('fill', self.divergingColorScale(d[column]))
          .style('pointer-events', 'auto')
          .on('mouseover', function(e, d) {
            self.sgb.show_tooltip(e.x, e.y, [d.locus_tag, d.gene, d.product, column, d[column]].join('\n'));
            if (self.callback) {
              self.callback('mouseover', d.sgb_index, column);
            }
          })
          .on('mousemove', (e) => self.sgb.move_tooltip(e.x, e.y))
          .on('mouseout', function(e, d) {
            self.sgb.hide_tooltip();
            if (self.callback) {
              self.callback('mouseout', d.sgb_index);
            }
          })
          .on('click', function(e, d) {
            if (self.callback) {
              self.callback('click', d.sgb_index, column);
            }
          }); 
      });
    }); 
  }

}

export { SimpleGenomeBrowser, baseFeatureTrack, gffTrack, myTnseqTrack }
