// Now need to show we can append multiple point tracks and tie together...

//import { SimpleGenomeBrowser, gffTrack, quantitativeFeatureTrack, quantitativePointTrack } from "https://cdn.jsdelivr.net/npm/simple-genome-browser@1.0.1/+esm";
import { SimpleGenomeBrowser, staticFeatureData, staticPointData } from "../src/SimpleGenomeBrowser.js";
import { quantitativePointTrack } from "../src/SGB_tracks.js";
import { gffTrack, heatmapTrack } from "../src/data_tracks.js";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

const use_cols = ['Minimal Media+Sucrose', 'Minimal Media+Glucose', 'Cucumber_1', 'Cucumber_2'];

const c_scale = d3.scaleDiverging()
  .domain([-4, 0, 4])
  .range(["#2d03fc", "#CCCCCC", "#d1b500"])
  .unknown('#AAA');
  

class myTnSeqPointTrack extends quantitativePointTrack {
  constructor(browser, name, h, top, column, config, contig_col, pos_column, data_file) {
    super(browser, name, h, top, column, config, contig_col, pos_column);
    const self = this;
    self.icols = ['barcode', 'rcbarcode', 'scaffoldId', 'strand', 'pos', 'locusId']
    this.data_file = data_file;
    let raw_data;
    d3.tsv(data_file, d3.autoType).then(function(tdata) {
      raw_data = tdata;
      console.log(raw_data);
      self.columnNames = Object.keys(raw_data[0]).filter((k) => self.icols.indexOf(k)==-1);
      console.log(self.columnNames)
      self.fullColumnNames = self.columnNames;
      // really should make a track for each column
      self.data = new staticPointData(self.sgb, self.name+'_data', raw_data, config);
      self.data.filter_by_contig();
      self.data.update_data();
      console.log(self.data.filt_data)
      // HACKY call to display all
      self.display_region();
    });

    
  }

  /*async getData(low, high, contig) {
    this.filter_points_by_region();
    console.log(this.contig_filt, this.filt_data);
    return this.filt_data;
  }*/

}



async function load_browser(strain, fasta_file, aa_file, gff_file, tn_file, tn_counts_file) {
  const b_div = d3.select('#browser_div');
  const my_browser = new SimpleGenomeBrowser(strain, true, 1200, 900, b_div,
    {'fasta_file': fasta_file, 'aa_file': aa_file}
  );
  my_browser.loadingPromise.then(browser => {
    browser.add_track(new gffTrack(browser, 'GFF track', 50, 150, {}, gff_file));
    browser.add_track(new heatmapTrack(browser, 'TnSeq track', 200, 225, {}, use_cols, use_cols, 'scaffoldId', 'begin', 'end', 'locusId', c_scale, tn_file));
    /*browser.add_track(new myTnSeqPointTrack(browser, 'TnSeq counts', 400, 450, 'Cucumber_1',
      {'log_y': true, 'clip': true, 'load_threshold':400000, ydomain: [10, 10000], left_buf: 40, 'yticks': [10, 100, 1000, 10000], 'ytick_formatter': (d => d ==10 ? '<=10' : d)}, 'scaffoldId', 'pos', tn_counts_file));*/
    })
}

// Test the genbank parser once the page loads
document.addEventListener('DOMContentLoaded', () => {
  load_browser('Erwinia tracheiphila BHKY', 'example_data/BHKY.fna', 'example_data/BHKY_aaseq.faa', 'example_data/BHKY.gff', 'example_data/BHKY_Tn_score_examples.tsv', 'example_data/BHKY_tnseq_example_counts.tsv');
});