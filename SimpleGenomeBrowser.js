const base_color = '#FCF0FC';

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
                console.log(currentSeqName);
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
          console.log(starting_contig in self.seqs)
          if (starting_contig in self.seqs) {
            console.log('yeah')
            self.starting_contig = starting_contig;
            self.starting_domain = starting_domain;
          } else {
            self.starting_contig = Object.keys(self.seqs)[0];
            self.starting_domain = [Math.floor(self.seq_lens[self.starting_contig]/4), Math.floor(3*self.seq_lens[self.starting_contig]/8)];
          }
          self.build_basic_browser();
          resolve(this);
        });
      });
  }

  circular_coordinate = (d) => {
    // Converts a linear coordinate to a circular coordinate within the contig.
    // the this variable is the class (self) if I use an arrow function
    // (don't totally get this, but works)
    return d < 0 ? this.contig_len + (d % this.contig_len) : d % this.contig_len;
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
        proposed_domain = [proposed_domain[0]+offset, proposed_domain[1]-offset]
      }
      // map to positive circular coordinates
      proposed_domain = proposed_domain.map(this.circular_coordinate)
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
  }

  make_controls() {

    self.outer_div = self.div.append('div')
      .style('width', self.w)
      .style('height', self.h)
      .style('position', 'relative')
      .style('border', '2px solid black')
      .style('overflow', 'hidden')

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
      .attr('cy', self.top+7)
      .attr('r', 6)
      .attr('stroke', base_color)
    self.zoom_in_g.append('line')
      .attr('x1', self.midpoint+17-3)
      .attr('x2', self.midpoint+17+3)
      .attr('y1', self.top+7)
      .attr('y2', self.top+7)
      .attr('stroke', base_color)
    self.zoom_in_g.append('line')
      .attr('x1', self.midpoint+17)
      .attr('x2', self.midpoint+17)
      .attr('y1', self.top+7-3)
      .attr('y2', self.top+7+3)
      .attr('stroke', base_color)
    self.zoom_out_g.append('circle')
      .attr('cx', self.midpoint-17)
      .attr('cy', self.top+7)
      .attr('r', 6)
      .attr('stroke', base_color)
    self.zoom_out_g.append('line')
      .attr('x1', self.midpoint-17-3)
      .attr('x2', self.midpoint-17+3)
      .attr('y1', self.top+7)
      .attr('y2', self.top+7)
      .attr('stroke', base_color)

    self.x_scale = d3.scaleLinear().range(self.x_range).domain(self.domain);
    console.log(self.domain[0])
    self.x_axis = d3.axisTop(self.x_scale)
      .ticks(6)
      .tickFormat(self.circular_coordinate);
    self.x_ax_element = self.controls_svg.append('g')
      .attr('class', 'axis')
      .attr('transform', 'translate(0, '+String(self.top)+')')
      .call(self.x_axis);
  }

  setup_drag() {
    self.dragAction = d3.drag()
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
        .attr('transform', 'translate(0, 33)')
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
    self.top = 0;
    self.controls_h = 50;
    self.x_range = [40, self.w-40];
    self.set_domain(self.starting_domain);
    self.contig = self.starting_contig;
    self.contig_len = self.seq_lens[self.contig];

    self.make_controls();
    self.setup_drag();
    
    self.display_region();
  }

  zoom_in() {
    return this.get_domain([this.domain[0]+this.domain_wid/4, this.domain[1]-this.domain_wid/4]);
  }

  zoom_out() {
    return this.get_domain([this.domain[0]-this.domain_wid, this.domain[1]+this.domain_wid]);
  }

  display_region(new_region=null) {
    const self = this;
    if (new_region) self.set_domain(new_region);
    self.x_scale.domain(self.domain);
    self.x_ax_element.attr('transform', 'translate(0, 33)').call(self.x_axis);
    console.log('display')
    for (let t of self.tracks) {
      t.display_region();
    }
  }

}


function gff_parse(r) {
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


class gffTrack {

  constructor(sgb, gff_file, h, top, type_filter='gene') {
    const self = this;
    self.sgb = sgb;
    console.log(self.sgb, self.sgb.outer_div)
    self.gff_file = gff_file;
    self.h = h;
    self.top = top;
    self.svg = self.sgb.outer_div.append('svg')
      .attr('width', self.sgb.display_w)
      .attr('height', self.h)
      .style('position', 'absolute')
      .style('left', self.sgb.display_left)
      .style('top', self.top)
      //.style('background-color', 'pink')

    self.g = self.svg.append('g')
    
    d3.text(gff_file).then(function(tdata) {
      self.data = d3.tsvParseRows(tdata.split('\n').filter((line) => (!line.startsWith('#'))).join('\n'), gff_parse);
      if (type_filter) {
        self.data = self.data.filter((d) => d.type==type_filter);
      }
      for (let row of self.data) {
        //let ats = {}
        row.attributes.split(';').forEach(function(pair) {
          let keyVal = pair.split('=');
          row[keyVal[0]] = keyVal[1];
        })
        row['label'] = row['gene'] || row['locus_tag'];
      }
      self.contig_filt = self.data.filter((d) => d.chromosome == self.sgb.contig);
      console.log(self.data);
    })
  }

  filter_by_region(start, end, domain_includes_zero, feat_start, feat_end) {
    // last condition for features that cross 0
    if (domain_includes_zero) {
      return ((feat_start < end) || (feat_end > start) || (feat_end < feat_start))
    } else {
      return (feat_start < end) && (feat_end > start);
    }
  }

  get_relative_scale(start, end, domain_includes_zero, feat_start, feat_end) {
    // last condition for features that cross 0
    if (domain_includes_zero) {
      reindex = this.sgb.contig_len - start;
      if (feat_start < end) { // right side of zero
        return [feat_start+reindex, feat_end+reindex];
      } else if (feat_end > start) {
        return [feat_start-start, feat_end-start];
      } else if (feat_end < feat_start) {
        return [feat_end+reindex, feat_start-start];
      }
    } else {
      return [feat_start-start, feat_end-start]
    }
  }

  display_region() {
    console.log('displaying genes')
    const self = this;
    const d1 = self.sgb.domain[0];
    const d2 = self.sgb.domain[1];
    const initial_domain_includes_zero = d1 > d2;
    const domain_size = initial_domain_includes_zero ? d2 + self.sgb.contig_len - d1 : d2-d1;
    // expanding on either side for fast dragging
    const use_domain = self.sgb.get_domain([d1-domain_size, d2+domain_size])

    const start = self.sgb.circular ? self.sgb.circular_coordinate(use_domain[0]) : use_domain[0];
    const end = self.sgb.circular ? self.sgb.circular_coordinate(use_domain[1]) : use_domain[1];
    const domain_includes_zero = start > end;
    const first_half = (d1 + d2)/self.sgb.contig_len < 0.5;

    console.log(d1, d2, domain_size, domain_includes_zero, start, end);
    self.g.remove()
    self.g = self.svg.append('g')
    const filt_data = self.contig_filt.filter((d) => self.filter_by_region(start, end, domain_includes_zero, d.start, d.end));
    console.log(filt_data.length);
    console.log(self.sgb.x_scale.domain()[1], self.sgb.x_scale.domain()[0])
    self.g.selectAll('.feature_blocks')
      .data(filt_data)
      .enter()
      .append('g')
        .attr('class', 'sgb_gene')
        .attr('opacity', 0.8)
        .on('mouseover', (e, d) => console.log(d))
        .html((d) => self.make_gene_display(d, self, start, end, initial_domain_includes_zero, domain_includes_zero, first_half));
  }

  make_gene_display(d, self, start, end, initial_domain_includes_zero, domain_includes_zero, first_half) {
    const region_bp = self.sgb.x_scale.domain()[1]-self.sgb.x_scale.domain()[0];
    let left = self.sgb.x_scale(d.start);
    let right = self.sgb.x_scale(d.end);
    if (domain_includes_zero) { // some are out of scale
      if (initial_domain_includes_zero || first_half) {
        // the scale is near zero (scale overflow to the left)
        if ((d.start > start) || (d.end > start)) {
          left = self.sgb.x_scale(d.start-self.sgb.contig_len);
          right = self.sgb.x_scale(d.end-self.sgb.contig_len);
          console.log('if', d.label, left, right)
        }
      } else if ((d.start < end) || (d.end < end)) {
        // the scale is near the contig len (scale overflow to the right)
        left = self.sgb.x_scale(d.start+self.sgb.contig_len);
        right = self.sgb.x_scale(d.end+self.sgb.contig_len);
        console.log('if2', d.label, left, right)
      }  
    }
    // shifting to make the scale right
    left += self.sgb.w;
    right += self.sgb.w;
    
    const width = right-left;
    const height = Math.max(Math.min(30, 1000000/region_bp), 20);
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

function try_it() {
  const sgb = new SimpleGenomeBrowser('./example_data/SCR3.fna', true, 800, 200, d3.select('#browser_div'), starting_contig='CP089934.1', starting_domain=[1, 10000]);
  sgb.loadingPromise.then(sgb_instance => {
    sgb_instance.tracks.push(new gffTrack(sgb_instance, './example_data/SCR3.gff', 200, 100, 'gene'));
    console.log('gffTrack created!');
  });
  
}
