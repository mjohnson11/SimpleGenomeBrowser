import { SimpleGenomeBrowser, gbTrack } from "https://cdn.jsdelivr.net/npm/simple-genome-browser@1.0.1/+esm";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import genbankParser from 'https://cdn.jsdelivr.net/npm/genbank-parser@1.2.4/+esm'


async function load_browser(genbank_json) {
  const b_div = d3.select('#browser_div');
  const strain = genbank_json[0].source;
  console.log(strain);
  const my_browser = new SimpleGenomeBrowser(strain, true, 1400, 500, b_div,
    {'genbank_json': genbank_json}
  );
  my_browser.loadingPromise.then(browser => {
    browser.tracks.push(new gbTrack(browser, 'gene_track', 50, 150, {}, genbank_json));
  })
}

// Test the genbank parser once the page loads
document.addEventListener('DOMContentLoaded', () => {
  
  fetch('../examples/example_data/BHKY.gbff')
    .then(response => response.text())
    .then(data => {
      const json = genbankParser(data);
      console.log('Parsed Genbank file:', json);
      load_browser(json);
    })
    .catch(error => {
      console.error('Error loading Genbank file:', error);
    });

});