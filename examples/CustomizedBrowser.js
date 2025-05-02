import { SimpleGenomeBrowser, gffTrack, geneTrack } from "https://cdn.jsdelivr.net/npm/simple-genome-browser@1.0.1/+esm";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

const colors = [
  '#0173b2',
  '#de8f05',
  '#029e73',
  '#d55e00',
  '#cc78bc',
  '#ca9161',
  '#fbafe4',
  '#949494',
  '#ece133',
  '#56b4e9'
]

const color_key = {
  'Mobile Element Associated': colors[1],
  'Phage associated': colors[3],
  'Looks metabolic': colors[0],
  'Transport': colors[2],
  'Regulation': colors[5],
  'Secretion system': colors[6],
  'Other': colors[7]
}

class phastestRegionTrack extends geneTrack {
  // Maybe a somewhat odd example since PHASTEST already has
  // a great genome browser, but...
  constructor(browser, name, h, top, config, phastest_file) {
    super(browser, name, h, top, config)
    const self = this;
    self.contig_column = 'scaffoldId';
    self.data = [];
    d3.json(phastest_file).then(phastest_json => {
      self.phastest_json = phastest_json;
      for (let rec of phastest_json) {
        let row = {
          'scaffoldId': rec.contig_tag.split(',')[0],
          'locusId': 'PHASTEST_region_'+String(rec.region),
          'begin': rec.start,
          'end': rec.stop,
          'name': 'Most common phage is ' + rec.most_common_phage,
          'desc': `Completeness: ${rec.completeness}, GC: ${rec.GC}`,
          'phastest_row': rec
        };
        self.data.push(row);
        self.sgb.search_dict[String(row['locusId'])] = {
          'contig_column': self.contig_column,
          'gene_data': row,
          'track': self
        }
      }

      // Updating autocomplete search bar
      self.sgb.autoCompleteEl.data = {src: Object.keys(self.sgb.search_dict).map((k) => k + ' ' + self.sgb.search_dict[k].gene_data.name + ' ' + self.sgb.search_dict[k].gene_data.desc)};
      self.filter_by_contig();
      console.log('phastest data loaded:', self.data);
      self.display_region()
    });
  }
}

class customColorsGFFtrack extends gffTrack {

  constructor(browser, name, h, top, config, gff_file, type_filter='CDS') {
    super(browser, name, h, top, config, gff_file, type_filter);
    this.make_color_legend(color_key, {'title': 'Color Key'})
  }

  get_feature_fill(d) {
    // HACKY COLORING OF GENES
    const descrip = d.desc || '';
    const go_func = d.go_function || '';
    const go_proc = d.go_process || '';
    const full_descrip = descrip + go_func + go_proc;
    if (full_descrip.indexOf('transpos')>-1 || full_descrip.indexOf('integrase')>-1 || full_descrip.indexOf('conjuga')>-1) {
      return color_key['Mobile Element Associated'];
    } else if (full_descrip.indexOf('viral')>-1 || full_descrip.indexOf('phage')>-1 || full_descrip.indexOf('capsid')>-1) {
      return color_key['Phage associated'];
    } else if (full_descrip.indexOf('synthesis')>-1 || full_descrip.indexOf('metabolic process')>-1 || full_descrip.indexOf('synthetic process')>-1 || full_descrip.indexOf('catabolic process')>-1 || full_descrip.indexOf('glycolytic process')>-1) {
      return color_key['Looks metabolic'];
    } else if (full_descrip.indexOf('transport')>-1) {
      return color_key['Transport'];
    } else if (full_descrip.indexOf('regulat')>-1) {
      return color_key['Regulation'];
    } else if (full_descrip.indexOf('secretion system')>-1) {
      return color_key['Secretion system'];
    } else {
      return color_key['Other'];
    }
  }

}

async function load_browser(strain, fasta_file, gff_file, phastest_file) {
  const b_div = d3.select('#browser_div');
  const my_browser = new SimpleGenomeBrowser(strain, true, 1400, 500, b_div,
    {'fasta_file': fasta_file}
  );
  my_browser.loadingPromise.then(sgb_instance => {
    sgb_instance.tracks.push(new customColorsGFFtrack(sgb_instance, 'GFF track', 50, 150, {}, gff_file));
    sgb_instance.tracks.push(new phastestRegionTrack(sgb_instance, 'PHASTEST annotations', 50, 200, {'load_threshold':100000000}, phastest_file));
  })
}

// Test the genbank parser once the page loads
document.addEventListener('DOMContentLoaded', () => {
  load_browser('Erwinia tracheiphila BHKY', 'example_data/BHKY.fna', 'example_data/BHKY.gff', 'example_data/BHKY_PHASTEST_predicted_phage_regions.json');
});