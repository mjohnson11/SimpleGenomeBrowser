import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import * as sgb from "../../SimpleGenomeBrowser.js";
import { make_graphs } from "../bottom_plots.js";

const x1 = 'FT_CucumberPetiole2_inoc_s';
const y1 = 'FT_CucXylem_s';

const tnseq_cols = [
  'FT_MJM9_s',
  'FT_MM_Glucose_s',
  'FT_MM_Sucrose_s',
  'FT_MediaAndCucXylem_s',
  'FT_CucXylem_s',
  'FT_MelonXylem_s',
  'FT_MelonPetiole2_inoc_s',
  //'FT_CucumberDilution1_s',
  //'FT_CucumberDilution2_s',
  //'FT_MelonPetiole1_down1_s',
  'TE2_MelonPetiole1_inoc_s',
  'TE2_MelonPetiole2_up1_s',
  //'TE2_MelonMainStem_down_s',  
  //'TE_MelonMainStemXylem_s',
  'TE_MelonPetiole2_inoc_s',
  'TE_MelonMainStem_down_s',
  'TE_MelonPetiole3_up1_s',
  'FT_CucumberPetiole2_inoc_s',
  //'FT_CucumberPetiole1_down1_s',
  'TE2_CucumberPetiole1_inoc_s',
  'TE2_CucumberPetiole2_up1_s',
  'TE2_CucumberMainStem_down_s',
  //'TE_CucumberMainStemXylem_s',
  //'TE_CucumberMainStem_down_s',
  'TE_CucumberPetiole2_inoc_s',
  'TE_CucumberPetiole3_up1_s',
  //'FT_SquashPetiole2_inoc_s',
  'FT_MelonPiece_s',
  'FT_CucumberPiece_s',
  'FT_SquashPiece_s',
  //'TE_SquashPetiole2_inoc_s'
];


function try_it() {
  const b_div = d3.select('#browser_div');
  const my_browser = new sgb.SimpleGenomeBrowser('../../example_data/SCR3.fna', true, 1000, 900, b_div, 'CP089934.1', [1, 10000]);
  my_browser.loadingPromise.then(sgb_instance => {
    sgb_instance.tracks.push(new sgb.gffTrack(sgb_instance, 50, 50, '../../example_data/SCR3.gff', 'gene'));
    sgb_instance.tracks.push(new sgb.myTnseqTrack(sgb_instance, 500, 100, '../../example_data/SCR3_tnseq_data.tsv', tnseq_cols, tnseq_cols.map((c) => c.split('_s')[0]), 'contig'));
    sgb_instance.tracks[1].loadingPromise.then(tnseq_track => {
      make_graphs(my_browser.outer_div, tnseq_track.data, my_browser, x1, y1);
    })
    

  });
  
}


document.addEventListener('DOMContentLoaded', () => {
  // Your code to run after the DOM is ready goes here!
  console.log("DOM is fully loaded!");
  try_it();
  // ... your module initialization, D3 code, etc. ... 
});