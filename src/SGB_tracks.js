// Need to refine data_map smartly - needs to be updated when things load... etc. I think I just need to make an "add_track" function
// LOTS OF BUG SQUASHING
// ADDING IN NICE FORGOTTEN FEATURES

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { SimpleGenomeBrowser, baseData, staticPointData, staticFeatureData, serverPointData, serverFeatureData } from "./SimpleGenomeBrowser.js";
import { measure_text } from "./util.js";

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
    self.name = name;
    self.h = h;
    self.top = top;
    
    self.config = config;
    self.load_threshold = config.load_threshold || 1000000;
    self.expanded = true;

    // holding div just has the clickable title to expand / hide tracks
    self.holding_div = self.sgb.outer_div.append('div')
      .style('width', self.sgb.display_w)
      .style('height', self.h)
      .style('position', 'relative')
      .style('left', -1*self.sgb.w)

    
    self.div = self.holding_div.append('div')

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
    self.title_div = self.holding_div.append('div')
      .attr('class', 'track_title')
      .style('position', 'absolute')
      .style('right', self.sgb.w+10)
      .style('top', 0)
      .style('background-color', '#CCC')
      .style('color', 'black')
      .style('padding', 2)
      .style('padding-left', 6)
      .style('padding-right', 6)
      .style('border-radius', '5px')
      .style('font-size', fontsize+'px')
      .style('text-align', 'center')
      .style('z-index', 11)
      .text(title)
      .on('click', () => {
        if (self.expanded) {
          self.div.style('display', 'none');
          self.holding_div.style('height', fontsize*2);
          self.expanded = false;
        } else {
          self.div.style('display', 'block');
          self.holding_div.style('height', self.h);
          self.expanded = true;
          self.display_region();
        }
      })
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
    console.log('Filtered gene data', self.data.filt_data);
    // remove holder g element, then remake
    self.g.remove()
    self.g = self.svg.append('g')
    self.g.on('click', () => console.log('g clicked'))
    self.g.selectAll('.feature_blocks')
      .data(self.data.filt_data)
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
    let label = String(d.name);
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
    self.contig_col = config.contig_col ?? 'scaffoldId';
    d3.text(gff_file).then(function(tdata) {
      let raw_data = d3.tsvParseRows(tdata.split('\n').filter((line) => (!line.startsWith('#'))).join('\n'), self.gff_parse);
      if (type_filter) {
        raw_data = raw_data.filter((d) => d.type==type_filter);
      }
      for (let row of raw_data) {
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
          'contig_col': self.contig_col,
          'gene_data': row,
          'track': self
        }
      }
      self.data = new staticFeatureData(self.sgb, self.name+'_data', raw_data, config);
      console.log('gff data loaded:', self.data);
      // Updating autocomplete search bar
      self.sgb.autoCompleteEl.data = {src: Object.keys(self.sgb.search_dict).map((k) => k + ' ' + self.sgb.search_dict[k].gene_data.name + ' ' + self.sgb.search_dict[k].gene_data.desc)};
      self.data.filter_by_contig();
      self.data.update_data();
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
    self.contig_col = config.contig_col ?? 'scaffoldId';
    let raw_data = [];
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
          raw_data.push(row);
          self.sgb.search_dict[String(row['locusId'])] = {
            'contig_col': self.contig_col,
            'gene_data': row,
            'track': self
          }
        }
      }
    }
    self.data = new staticFeatureData(self.sgb, self.name+'_data', raw_data, config);
    console.log('gb data loaded:', self.data);
    // Updating autocomplete search bar
    self.sgb.autoCompleteEl.data = {src: Object.keys(self.sgb.search_dict).map((k) => k + ' ' + self.sgb.search_dict[k].gene_data.name + ' ' + self.sgb.search_dict[k].gene_data.desc)};
    self.data.filter_by_contig();
    self.display_region();
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

  constructor(sgb, name, h, top, config, gene_file) {
    super(sgb, name, h, top, config)
    const self = this;
    self.gene_file = gene_file;
    self.contig_col = config.contig_col ?? 'scaffoldId';
    d3.tsv(gene_file, d3.autoType).then(function(tdata) {
      let raw_data  = tdata;
      for (let row of raw_data) {
        row['locusId'] = String(row['locusId']); // convert to string to avoid number-string comparison issues
        row['search_text'] = row['locusId'] + ' ' + row['name'] + ' ' + row['desc'];
        // Adding info to the search index
        self.sgb.search_dict[String(row['locusId'])] = {
          'contig_col': self.contig_col,
          'gene_data': row,
          'track': self
        }
      }
      self.data = new staticFeatureData(self.sgb, self.name+'_data', raw_data, config);
      console.log('gene data loaded:', self.data);
      // Updating autocomplete search bar
      self.sgb.autoCompleteEl.data = {src: Object.keys(self.sgb.search_dict).map((k) => k + ' ' + self.sgb.search_dict[k].gene_data.name + ' ' + self.sgb.search_dict[k].gene_data.desc)};
      self.data.filter_by_contig();
      self.data.update_data();
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
    self.row_title_div = self.div.append('div')
      .style('width', '200px')
      .style('position', 'absolute')
      .style('left', self.sgb.w)
      .style('top', 0)
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
    if (this.row_name_click) this.row_name_click();
  }

  make_summary_sidebar(row_name) {
    const self = this;

    const genesWithScores = self.data
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
        .text(function(d) {
          if (d.gene.desc) {
            return `${d.gene.desc.substring(0, 50)}${d.gene.desc.length > 50 ? '...' : ''}`;
          } else {
            return ''
          }
        });
  
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
      // Set nulls to 0 in both columns
      const plotData = self.data.contig_filt.filter(row =>
        //row[row_name] !== null && !isNaN(row[row_name]) &&
        //row[yAxisColumn] !== null && !isNaN(row[yAxisColumn]) &&
        (row.locusId in self.sgb.search_dict)
      ).map(row => ({
        gene: self.sgb.search_dict[row.locusId].gene_data,
        x: row[row_name] || 0,
        y: row[yAxisColumn] || 0
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
    //console.log('Filtered heatmap data', self.data.filt_data);
    // Clear the canvas
    self.ctx.clearRect(0, 0, self.sgb.display_w, self.h);

    // Create pixel map and render canvas in a single loop
    self.pixelMap = Array(self.sgb.display_w).fill(null).map(() => Array(self.h).fill(null));

    for (let dataIndex = 0; dataIndex < self.data.filt_data.length; dataIndex++) {
      const d = self.data.filt_data[dataIndex];
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
        const d = self.data.filt_data[pixelInfo.dataIndex];
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
        const d = self.data.filt_data[pixelInfo.dataIndex];
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
   * Base class for tracks displaying quantitative data a single y axis
   * Meant to be defined with a data class already loaded
   * Uses a canvas for rendering and provides methods for handling mouse interactions.
   * Designed to be extended by tracks displaying points or lines representing quantitative values.
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

  constructor(sgb, name, h, top, column, config) {
    super(sgb, name, h, top, config);
    const self = this;
    self.column = column;
    self.config = config;
    self.title = config.title ?? self.column;
    self.load_threshold = config.load_threshold ?? 1000000;
    self.yticks = config.yticks ?? 'infer';
    self.ydomain = config.ydomain ?? 'infer';
    if (self.ydomain != 'infer') self.use_domain = self.ydomain;
    if (self.yticks != 'infer') self.use_yticks = self.yticks;
    self.ytick_formatter = config.ytick_formatter ?? null;
    self.clip = config.clip ?? false;
    self.log_y = config.log_y ?? false;
    self.h_buf = config.h_buf ?? 0.1;
    self.left_buf = config.left_buf ?? 60;

    const fraction_buf = self.h_buf*self.h;
    self.yrange = [self.h - fraction_buf, fraction_buf];
    self.base_scale = (self.log_y) ? d3.scaleLog() : d3.scaleLinear();
    if (self.ydomain != 'infer') {
      self.yscale = (self.clip) ? self.base_scale.range(self.yrange).clamp(true).domain(self.use_domain) : self.base_scale.range(self.yrange).domain(self.use_domain).nice();
      self.svg.selectAll('.yline')
        .data(self.yticks)
        .enter()
        .append('line')
          .attr('class', 'yline')
          .attr('x1', 0)
          .attr('x2', self.sgb.display_w)
          .attr('y1', d => self.yscale(d))
          .attr('y2', d => self.yscale(d))
          .attr('stroke', 'black')
          .attr('stroke-width', d => (d == self.yticks[0] || d == self.yticks[self.yticks.length-1]) ? 1 : 0.25)
    }

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
    
    old_canvas.remove();
    
    if (self.ydomain == 'infer') {
      self.use_domain = d3.extent(self.data.filt_data.map((r)=>r[self.column]));
      self.yscale = (self.clip) ? self.base_scale.range(self.yrange).clamp(true).domain(self.use_domain) : self.base_scale.range(self.yrange).domain(self.use_domain).nice();
      self.yticks = self.use_domain;
      self.svg.selectAll('.yline').remove();
      self.svg.selectAll('.yline')
        .data(self.yticks)
        .enter()
        .append('line')
          .attr('class', 'yline')
          .attr('x1', 0)
          .attr('x2', self.sgb.display_w)
          .attr('y1', d => self.yscale(d))
          .attr('y2', d => self.yscale(d))
          .attr('stroke', 'black')
          .attr('stroke-width', d => (d == self.yticks[0] || d == self.yticks[self.yticks.length-1]) ? 1 : 0.25);

      if (self.axis_elements) self.axis_elements.remove();
      self.axis_elements = self.svg.append('g');
      self.axis_elements.append('rect')
        .attr('x', self.sgb.w)
        .attr('width', self.left_buf)
        .attr('y', 0)
        .attr('height', self.h)
        .attr('fill', 'white')
      
      const yAxis = d3.axisLeft(self.yscale)
        .tickValues(self.yticks)
        .tickSize(0)
        
      if (self.tick_formatter) yAxis.tickFormat(self.tick_formatter);
  
      self.axis_elements.append('g')
        .attr('class', 'yaxis')
        .attr("transform", `translate(${self.sgb.w+self.left_buf},0)`)
        .call(yAxis);
              
      self.axis_elements.append('text')
        .attr('class', 'countPlotTitle')
        .attr("y", self.yscale(self.yticks[self.yticks.length-1])-5)
        .attr("x", self.sgb.display_w/2)
        .html(self.title);
    }

    self.drawData();

  }
    
  handleMouseout() {
    if (this.mouseout_function) this.mouseout_function();
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
        if (self.hover_function) self.hover_function(event, pixelInfo);
        if (self.highlight_function) self.highlight_function(event, pixelInfo);
      } else {
        self.handleMouseout();
      }
    } else {
      self.handleMouseout();
    }
  }

  async drawData(data){
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
  constructor(sgb, name, h, top, column, config, contig_col, pos_column) {
    super(sgb, name, h, top, column, config)
    this.contig_col = contig_col;
    this.pos_column = pos_column;
    this.pointRadius = config.pointRadius || 2;
    this.highlight_element = this.svg.append('circle')
      .attr('r', this.pointRadius * 1.5)
      .attr('fill', 'red')
      .style('visibility', 'hidden');

  }

  drawData() {
    const self = this;
    self.data.filt_data.forEach(d => {
      const x = self.sgb.get_coordinate_pixel_position(d[self.pos_column]);
      if (x >= 0 && x <= self.sgb.display_w) {
        const y = self.yscale(d[self.column]);
        self.ctx.fillStyle = (self.color_func) ? self.color_func(d, self.column, self.title) : "black";
        self.ctx.beginPath();
        self.ctx.arc(x, y, self.pointRadius, 0, 2 * Math.PI);
        self.ctx.fill();
        // Add to pixel map
        for (let px = Math.max(0, Math.floor(x - self.pointRadius)); px <= Math.min(self.sgb.display_w - 1, Math.ceil(x + self.pointRadius)); px++) {
          for (let py = Math.max(0, Math.floor(y - self.pointRadius)); py <= Math.min(self.h - 1, Math.ceil(y + self.pointRadius)); py++) {
            self.pixelMap[px][py] = { data: d, column: self.column};
          }
        }
      }
    })
  }

  highlight_function(event, pixelInfo) {
    const self = this;
    const d = pixelInfo.data;
    for (let track of self.sgb.data_map[self.data.name]) {
      track.highlight_datum(d);
    }
  }

  highlight_datum(d) {
    const self = this;
    this.highlight_element
      .style('visibility', 'visible')
      .attr('cx', self.sgb.get_coordinate_pixel_position(d[self.pos_column]))
      .attr('cy', self.yscale(d[self.column]));
  }

  mouseout_function() {
    this.sgb.hide_tooltip();
    for (let track of this.sgb.data_map[this.data.name]) {
      track.highlight_element.style('visibility', 'hidden');
    }
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
   * - `drawData(data)`: Override to customize how lines are rendered on the canvas. The default implementation draws horizontal lines.
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
    this.lineWidth = config.lineWidth ?? 2;

    this.highlight_element = this.svg.append('line') // single line for highlighting
      .attr('stroke', 'red')
      .attr('stroke-width', this.lineWidth * 2) 
      .style('visibility', 'hidden');
  }

  drawData(){
    const self = this;
    self.data.filt_data.forEach((d) => {
      const [x1, x2] = self.sgb.get_feature_pixel_position(d[self.begin_column], d[self.end_column]);
      //const x2 = self.sgb.get_coordinate_pixel_position(d[self.end_column]);
      //console.log(d[self.begin_column], d[self.end_column], x1, x2, self.sgb.display_w);
      // Only draw the line if *any* part of it is visible
      if ((x1 <= self.sgb.display_w && x1 >= 0) 
            || (x2 <= self.sgb.display_w && x2 >= 0) 
            || (x1 < 0 && x2 > self.sgb.display_w)
          ){
        //console.log(x1, x2, self.sgb.display_w);
        const y = self.yscale(d[self.column]);
        self.ctx.strokeStyle = (self.color_func) ? self.color_func(d, self.column, self.title) : "black";
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
              self.pixelMap[px][py] = { data: d, column: self.column};
            } catch (error) {
              console.log('Error adding to pixel map', px, py, self.pixelMap.length, self.pixelMap[0].length);
            }    
          }
        }
      }
    });
  }

  highlight_function(event, pixelInfo) {
    const self = this;
    const d = pixelInfo.data;
    for (let track of self.sgb.data_map[self.data.name]) {
      track.highlight_datum(d);
    }
  }

  highlight_datum(d) {
    const self = this;
    const [x1, x2] = self.sgb.get_feature_pixel_position(d[self.begin_column], d[self.end_column]);
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
    for (let track of this.sgb.data_map[this.data.name]) {
      track.highlight_element.style('visibility', 'hidden');
    }
  }

  hover_function(event, pixelInfo) {
    const d = pixelInfo.data;
    const column = pixelInfo.column;
    this.sgb.tooltip.selectAll('*').remove();
    this.sgb.tooltip.html(`${d[this.begin_column]}-${d[this.end_column]}: ${column} = ${d[column]}`);
    this.sgb.show_tooltip(event.pageX, event.pageY);
  }

}

export { baseFeatureTrack, geneTrack, gffTrack, gbTrack, geneTableTrack, quantitativeFeatureTrack, quantitativeYaxesTrack, quantitativePointTrack, quantitativeLineTrack };