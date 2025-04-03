import { SimpleGenomeBrowser, gffTrack, quantitativeFeatureTrack, quantitativePointTrack } from "../src/SimpleGenomeBrowser.js";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

const use_cols = ['Minimal Media+Sucrose', 'Minimal Media+Glucose', 'Cucumber_1', 'Cucumber_2'];

const c_scale = d3.scaleDiverging()
  .domain([-4, 0, 4])
  .range(["#2d03fc", "#CCCCCC", "#d1b500"])
  .unknown('#AAA');
  

class myTnseqTrack extends quantitativeFeatureTrack {

  constructor(sgb, name, h, top, config, display_columns, display_names, contig_column, tnseq_file) {
    super(sgb, name, h, top, config, display_columns, display_names, contig_column);
    const self = this;

    self.set_diverging_colorscale(c_scale);

    self.loadingPromise = new Promise((resolve, reject) => {
      const dataPromise = (typeof tnseq_file === 'object')
        ? Promise.resolve(tnseq_file)  // Use existing object if provided
        : d3.tsv(tnseq_file, d3.autoType); // Otherwise, load from TSV
      dataPromise.then(data => {
        self.data = data;
        self.data.forEach((row, i) => {
          row.sgb_index = i;
          row.begin = row.begin || row.start; // terminology thing to fix
        });

        console.log('tnseq data loaded:', self.data);
        self.filter_by_contig(self.contig_column);
        self.display_column_names();
        self.display_region();
        resolve(self);
      }).catch(reject);
    });
  }

}

class myTnSeqPointTrack extends quantitativePointTrack {
  constructor(sgb, name, h, top, config, contig_col, pos_column, data_file) {
    super(sgb, name, h, top, config, contig_col, pos_column);
    const self = this;
    self.icols = ['barcode', 'rcbarcode', 'scaffoldId', 'strand', 'pos', 'locusId']
    this.data_file = data_file;
    d3.tsv(data_file, d3.autoType).then(function(tdata) {
      self.data = tdata;
      console.log(self.data);
      self.columnNames = Object.keys(self.data[0]).filter((k) => self.icols.indexOf(k)==-1);
      self.fullColumnNames = self.columnNames;
      self.filter_by_contig(self.contig_column);
      self.display_region();
    });
  }

  async getData(low, high, contig) {
    this.filter_points_by_region();
    console.log(this.contig_filt, this.filt_data);
    return this.filt_data;
  }

}



async function load_browser(strain, fasta_file, aa_file, gff_file, tn_file, tn_counts_file) {
  const b_div = d3.select('#browser_div');
  const my_browser = new SimpleGenomeBrowser(strain, true, 1200, 900, b_div,
    {'fasta_file': fasta_file, 'aa_file': aa_file}
  );
  my_browser.loadingPromise.then(sgb_instance => {
    sgb_instance.tracks.push(new gffTrack(sgb_instance, 'GFF track', 50, 150, {}, gff_file));
    sgb_instance.tracks.push(new myTnseqTrack(sgb_instance, 'TnSeq track', 200, 225, {}, use_cols, use_cols, 'scaffoldId', tn_file));
    sgb_instance.tracks.push(new myTnSeqPointTrack(sgb_instance, 'TnSeq counts', 400, 450, 
      {'log_y': true, 'clip': true, 'load_threshold':400000, 'yticks': [10, 100, 1000, 10000], 'ytick_formatter': (d => d ==10 ? '<=10' : d)}, 'scaffoldId', 'pos', tn_counts_file));
  })
}

// Test the genbank parser once the page loads
document.addEventListener('DOMContentLoaded', () => {
  load_browser('Erwinia tracheiphila BHKY', 'example_data/BHKY.fna', 'example_data/BHKY_aaseq.faa', 'example_data/BHKY.gff', 'example_data/BHKY_Tn_score_examples.tsv', 'example_data/BHKY_tnseq_example_counts.tsv');
});