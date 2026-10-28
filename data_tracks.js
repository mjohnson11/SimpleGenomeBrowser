// Convenience tracks that load or wrap a single dataset along with the track
// They define `data_name` synchronously in the constructor so `sgb.add_track(track)` can register them immediately.

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import * as aq from 'https://cdn.jsdelivr.net/npm/arquero@8.0.3/+esm';

import { geneTrack, quantitativeFeatureTrack } from "./SGB_tracks.js";
import { staticFeatureData, staticPointData } from "./SGB_data.js";
import { load_gff, parse_genbank, load_gene_table } from "./util.js";
import { open_column_selector, data_shaper } from "./helper_functions.js";

class gffTrack extends geneTrack {
  /**
   * Extends `geneTrack` to load and display gene features from a GFF file or pre-parsed GFF features array.
   */
  constructor(sgb, name, config, gff_file_or_features, type_filter = 'CDS') {
    super(sgb, name, config, 'scaffoldId', 'begin', 'end', 'locusId');
    const self = this;
    self.gff_file = gff_file_or_features;
    self.data_name = self.name + '_data';

    if (Array.isArray(gff_file_or_features)) {
      const raw_data = type_filter ? gff_file_or_features.filter(d => d.type === type_filter) : gff_file_or_features;
      self.set_feature_data(raw_data, true);
      self.display_region();
    } else {
      load_gff(gff_file_or_features, type_filter).then((raw_data) => {
        self.set_feature_data(raw_data, true);
        self.display_region();
      });
    }
  }
}

class gbTrack extends geneTrack {
  /**
   * Extends `geneTrack` to load and display gene features from GenBank features (returned by `load_genbank`)
   * or pre-loaded Genbank JSON data.
   */
  constructor(sgb, name, config, genbank_features_or_json, type_filter = 'CDS') {
    super(sgb, name, config, 'scaffoldId', 'begin', 'end', 'locusId');
    const self = this;
    self.genbank_json = genbank_features_or_json;
    self.data_name = self.name + '_data';

    let features = [];
    if (Array.isArray(genbank_features_or_json) && (genbank_features_or_json.length === 0 || 'scaffoldId' in genbank_features_or_json[0])) {
      features = genbank_features_or_json;
    } else if (genbank_features_or_json) {
      features = parse_genbank(genbank_features_or_json).features;
    }

    const raw_data = type_filter
      ? features.filter(f => f.type === type_filter)
      : features.slice();

    self.set_feature_data(raw_data, true);
    self.display_region();
  }
}

class geneTableTrack extends geneTrack {
  /**
   * Extends `geneTrack` to load and display gene features from a TSV gene table file or Arquero table.
   * Assumes the gene table has columns: `locusId`, `name`, `scaffoldId`, `begin`, `end`, `desc`.
   */
  constructor(sgb, name, config, gene_file_or_table) {
    super(sgb, name, config, 'scaffoldId', 'begin', 'end', 'locusId');
    const self = this;
    self.gene_file = gene_file_or_table;
    self.data_name = self.name + '_data';

    const init_table = (raw_data) => {
      self.set_feature_data(raw_data, true);
      self.display_region();
    };

    if (typeof gene_file_or_table === 'string') {
      load_gene_table(gene_file_or_table).then(init_table);
    } else {
      init_table(gene_file_or_table);
    }
  }
}

class heatmapTrack extends quantitativeFeatureTrack {

  constructor(browser, name, config, full_column_config, contig_column, start_column, end_column, id_column, c_scale, data_file_or_object) {
    super(browser, name, config, full_column_config, contig_column, start_column, end_column, id_column);
    const self = this;
    self.data_name = self.name + '_data';
    if (self.sgb.saved_state) self.sgb.saved_state.phages = self.column_config.map(c => c.name);
    self.set_diverging_colorscale(c_scale);
    self.suffixes = config.suffixes ?? [''];
    self.include_halfs = self.suffixes.includes('_half1') && self.suffixes.includes('_half2');
    self.icols = config.icols ?? ['locusId', 'sysName', 'scaffoldId', 'begin', 'end', 'strand', 'name', 'desc'];
    self.sidebar_onload = config.sidebar_onload ?? true;

    self.loadingPromise = new Promise((resolve, reject) => {
      const dataPromise = (typeof data_file_or_object === 'object')
        ? Promise.resolve(data_file_or_object)
        : aq.loadCSV(data_file_or_object, { delimiter: '\t' });
      dataPromise.then(raw_data => {
        self.og_data = raw_data;
        self.data = new staticFeatureData(self.sgb, self.data_name, null, config);
        self.update_data_by_column_config();
        self.display_region();
        const full_focal_col = self.column_config.filter((c) => c.name == self.focal_col)[0];
        if (self.sidebar_onload) self.make_summary_sidebar(full_focal_col);
        resolve(self);
      }).catch(reject);
    });

    self.settings_btn = self.add_controls_button('Select columns to display',
      () => {
        open_column_selector({
          column_config: self.column_config,
          unused_config: self.inactive_config,
          title: `Select columns for ${self.name} (select and drag columns)`,
          onSave: (new_current, new_unused) => {
            self.column_config = new_current;
            self.inactive_config = new_unused;
            if (self.sgb.saved_state) self.sgb.saved_state.phages = new_current.map(c => c.name);
            self.update_data_by_column_config();
            self.reset_display();
            self.display_region();
          }
        });
      });
  }

  update_data_by_column_config() {
    const self = this;
    self.data.data = data_shaper(self.og_data, self.column_config, self.icols, self.suffixes);
    self.data.filter_by_contig();
    self.data.update_data();
  }
}

export { gffTrack, gbTrack, geneTableTrack, heatmapTrack };